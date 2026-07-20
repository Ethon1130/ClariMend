import { detectCandidates } from "@/lib/detection";
import { compositeCrop } from "@/lib/inpaint-composite";
import { analyzeConnectedMask } from "@/lib/mask-analysis";
import type { WorkerRequest, WorkerResponse } from "@/lib/worker-messages";

type Cv = typeof import("@techstark/opencv-js");

declare function importScripts(...urls: string[]): void;

let cvPromise: Promise<Cv> | null = null;
const cancelled = new Set<string>();

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

async function repair(message: Extract<WorkerRequest, { type: "repair" }>) {
  const { taskId, width, height } = message;
  const original = new Uint8ClampedArray(message.rgba);
  const mask = new Uint8Array(message.mask);
  analyzeConnectedMask(mask, width, height);
  const bounds = maskBounds(mask, width, height);
  if (!bounds) throw new Error("empty-mask");
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

  const cropRgba = new Uint8ClampedArray(crop.width * crop.height * 4);
  const cropMask = new Uint8Array(crop.width * crop.height);
  for (let y = 0; y < crop.height; y += 1) {
    const imageOffset = ((crop.y + y) * width + crop.x) * 4;
    cropRgba.set(original.subarray(imageOffset, imageOffset + crop.width * 4), y * crop.width * 4);
    cropMask.set(mask.subarray((crop.y + y) * width + crop.x, (crop.y + y) * width + crop.x + crop.width), y * crop.width);
  }

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
    rgbaMat.data.set(cropRgba);
    maskMat.data.set(cropMask);
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
