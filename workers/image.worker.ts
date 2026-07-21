import { detectCandidates } from "@/lib/detection";
import { compositeCrop } from "@/lib/inpaint-composite";
import { createLamaImageInput, createLamaMaskInput, featherMask, lamaCrop, LAMA_SIZE, resizeLamaOutput } from "@/lib/lama";
import { analyzeConnectedMask } from "@/lib/mask-analysis";
import { readResponseBytes } from "@/lib/model-download";
import type { WorkerRequest, WorkerResponse } from "@/lib/worker-messages";
import type { InferenceSession } from "onnxruntime-web";

type Cv = typeof import("@techstark/opencv-js");

declare function importScripts(...urls: string[]): void;

let cvPromise: Promise<Cv> | null = null;
type LamaRuntime = {
  ort: typeof import("onnxruntime-web/wasm");
  session: InferenceSession;
};
let lamaPromise: Promise<LamaRuntime> | null = null;
const cancelled = new Set<string>();
const LAMA_MODEL_URL = process.env.NEXT_PUBLIC_LAMA_MODEL_URL
  ?? "https://huggingface.co/Carve/LaMa-ONNX/resolve/c3c0c9e468934d62e79c329e35d82dd09ff8c444/lama_fp32.onnx";
const MODEL_STALL_TIMEOUT = 30_000;

function respond(message: WorkerResponse, transfer?: Transferable[]) {
  self.postMessage(message, { transfer: transfer ?? [] });
}

async function loadOpenCv(taskId: string) {
  if (!cvPromise) {
    respond({ type: "progress", taskId, stage: "loading", progress: 0.15 });
    cvPromise = new Promise<Cv>((resolve, reject) => {
      try {
        importScripts("/vendor/opencv/opencv.js");
        const ready = (self as unknown as { cv: Promise<Cv> }).cv;
        ready.then(resolve, reject);
      } catch (error) {
        reject(error);
      }
    });
  }
  respond({ type: "progress", taskId, stage: "initializing", progress: 0.4 });
  return cvPromise;
}

async function loadLama(taskId: string) {
  if (!lamaPromise) {
    lamaPromise = (async () => {
      respond({ type: "progress", taskId, stage: "downloading", progress: 0.12 });
      const ort = await import("onnxruntime-web/wasm");
      ort.env.logLevel = "fatal";
      ort.env.wasm.wasmPaths = "/vendor/onnxruntime/";
      ort.env.wasm.numThreads = 1;
      const controller = new AbortController();
      let stallTimer = setTimeout(() => controller.abort(), MODEL_STALL_TIMEOUT);
      const resetStallTimer = () => {
        clearTimeout(stallTimer);
        stallTimer = setTimeout(() => controller.abort(), MODEL_STALL_TIMEOUT);
      };
      let lastProgress = 0.12;
      let model: Uint8Array;
      try {
        const response = await fetch(LAMA_MODEL_URL, { signal: controller.signal });
        if (!response.ok) throw new Error(`lama-model-http-${response.status}`);
        resetStallTimer();
        model = await readResponseBytes(response, (received, total) => {
          resetStallTimer();
          const progress = 0.12 + (received / total) * 0.4;
          if (progress - lastProgress >= 0.005 || received === total) {
            lastProgress = progress;
            respond({ type: "progress", taskId, stage: "downloading", progress });
          }
        });
      } catch (error) {
        if (controller.signal.aborted) throw new Error("lama-model-download-stalled");
        throw error;
      } finally {
        clearTimeout(stallTimer);
      }
      respond({ type: "progress", taskId, stage: "initializing", progress: 0.56 });
      const session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"] });
      return { ort, session };
    })().catch((error) => {
      lamaPromise = null;
      throw error;
    });
  }
  return lamaPromise;
}

function maskBounds(mask: Uint8Array, width: number, height: number) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function extractCrop(
  original: Uint8ClampedArray,
  mask: Uint8Array,
  imageWidth: number,
  crop: { x: number; y: number; width: number; height: number },
) {
  const rgba = new Uint8ClampedArray(crop.width * crop.height * 4);
  const cropMask = new Uint8Array(crop.width * crop.height);
  for (let y = 0; y < crop.height; y += 1) {
    const imageOffset = ((crop.y + y) * imageWidth + crop.x) * 4;
    rgba.set(original.subarray(imageOffset, imageOffset + crop.width * 4), y * crop.width * 4);
    cropMask.set(mask.subarray((crop.y + y) * imageWidth + crop.x, (crop.y + y) * imageWidth + crop.x + crop.width), y * crop.width);
  }
  return { rgba, mask: cropMask };
}

async function repairTraditional(
  message: Extract<WorkerRequest, { type: "repair" }>,
  original: Uint8ClampedArray,
  mask: Uint8Array,
  bounds: { x: number; y: number; width: number; height: number },
) {
  const { taskId, width, height } = message;
  const context = Math.min(256, Math.max(64, Math.round(Math.max(bounds.width, bounds.height) * 0.5)));
  const crop = {
    x: Math.max(0, bounds.x - context),
    y: Math.max(0, bounds.y - context),
    width: 0,
    height: 0,
  };
  crop.width = Math.min(width, bounds.x + bounds.width + context) - crop.x;
  crop.height = Math.min(height, bounds.y + bounds.height + context) - crop.y;

  const cv = await loadOpenCv(taskId);
  if (cancelled.has(taskId)) return respond({ type: "cancelled", taskId });
  respond({ type: "progress", taskId, stage: "processing", progress: 0.6 });

  const cropped = extractCrop(original, mask, width, crop);

  const rgbaMat = new cv.Mat(crop.height, crop.width, cv.CV_8UC4);
  const rgbMat = new cv.Mat();
  const maskMat = new cv.Mat(crop.height, crop.width, cv.CV_8UC1);
  const dilated = new cv.Mat();
  const feather = new cv.Mat();
  const repaired = new cv.Mat();
  const kernelSize = Math.min(8, Math.max(2, Math.round(Math.min(bounds.width, bounds.height) / 40)));
  const kernel = cv.Mat.ones(kernelSize, kernelSize, cv.CV_8U);
  let method: "telea" | "ns" = "telea";
  try {
    rgbaMat.data.set(cropped.rgba);
    maskMat.data.set(cropped.mask);
    cv.cvtColor(rgbaMat, rgbMat, cv.COLOR_RGBA2RGB);
    cv.dilate(maskMat, dilated, kernel);
    cv.GaussianBlur(dilated, feather, new cv.Size(7, 7), 0, 0, cv.BORDER_DEFAULT);
    for (let index = 0; index < feather.data.length; index += 1) {
      if (!dilated.data[index]) feather.data[index] = 0;
    }
    const radius = Math.min(5, Math.max(3, Math.round(Math.max(width, height) / 1600) + 2));
    try {
      cv.inpaint(rgbMat, dilated, repaired, radius, cv.INPAINT_TELEA);
    } catch {
      method = "ns";
      cv.inpaint(rgbMat, dilated, repaired, radius, cv.INPAINT_NS);
    }
    const result = compositeCrop(original, new Uint8Array(repaired.data), new Uint8Array(feather.data), crop, width);
    if (cancelled.has(taskId)) return respond({ type: "cancelled", taskId });
    respond({ type: "repaired", taskId, width, height, rgba: result.buffer, method }, [result.buffer]);
  } finally {
    rgbaMat.delete();
    rgbMat.delete();
    maskMat.delete();
    dilated.delete();
    feather.delete();
    repaired.delete();
    kernel.delete();
  }
}

async function repairLama(
  message: Extract<WorkerRequest, { type: "repair" }>,
  original: Uint8ClampedArray,
  mask: Uint8Array,
  bounds: { x: number; y: number; width: number; height: number },
) {
  const { taskId, width, height } = message;
  const crop = lamaCrop(bounds, width, height);
  const cropped = extractCrop(original, mask, width, crop);
  const runtime = await loadLama(taskId);
  if (cancelled.has(taskId)) return respond({ type: "cancelled", taskId });
  respond({ type: "progress", taskId, stage: "processing", progress: 0.62 });
  const imageTensor = new runtime.ort.Tensor(
    "float32",
    createLamaImageInput(cropped.rgba, crop.width, crop.height),
    [1, 3, LAMA_SIZE, LAMA_SIZE],
  );
  const maskTensor = new runtime.ort.Tensor(
    "float32",
    createLamaMaskInput(cropped.mask, crop.width, crop.height),
    [1, 1, LAMA_SIZE, LAMA_SIZE],
  );
  const feeds = { image: imageTensor, mask: maskTensor };
  const output = await runtime.session.run(feeds);
  const tensor = output[runtime.session.outputNames[0]];
  if (!tensor || !(tensor.data instanceof Float32Array)) throw new Error("lama-output-invalid");
  const repaired = resizeLamaOutput(tensor.data, crop.width, crop.height);
  const blendMask = featherMask(cropped.mask, crop.width, crop.height);
  const result = compositeCrop(original, repaired, blendMask, crop, width);
  if (cancelled.has(taskId)) return respond({ type: "cancelled", taskId });
  respond({ type: "repaired", taskId, width, height, rgba: result.buffer, method: "lama" }, [result.buffer]);
}

async function repair(message: Extract<WorkerRequest, { type: "repair" }>) {
  const { width, height } = message;
  const original = new Uint8ClampedArray(message.rgba);
  const mask = new Uint8Array(message.mask);
  analyzeConnectedMask(mask, width, height);
  const bounds = maskBounds(mask, width, height);
  if (!bounds) throw new Error("empty-mask");
  if (message.method === "lama") return repairLama(message, original, mask, bounds);
  return repairTraditional(message, original, mask, bounds);
}

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === "init") return respond({ type: "ready" });
  if (message.type === "cancel") {
    cancelled.add(message.taskId);
    return;
  }
  if (message.type === "release") {
    cancelled.clear();
    cvPromise = null;
    void lamaPromise?.then(({ session }) => session.release()).catch(() => undefined);
    lamaPromise = null;
    return respond({ type: "released" });
  }
  if (message.type === "detect") {
    try {
      const candidates = detectCandidates(
        new Uint8ClampedArray(message.rgba),
        message.width,
        message.height,
        message.workWidth,
        message.workHeight,
      );
      if (cancelled.has(message.taskId)) respond({ type: "cancelled", taskId: message.taskId });
      else respond({ type: "detected", taskId: message.taskId, candidates });
    } catch (error) {
      respond({ type: "error", taskId: message.taskId, code: "detect-failed", message: error instanceof Error ? error.message : "detect-failed" });
    }
    return;
  }
  void repair(message).catch((error) => {
    respond({ type: "error", taskId: message.taskId, code: "repair-failed", message: error instanceof Error ? error.message : "repair-failed" });
  });
});
