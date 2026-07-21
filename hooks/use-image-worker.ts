"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DecodedImage } from "@/lib/decode-image";
import type { Candidate, RepairMethod, WorkerRequest, WorkerResponse } from "@/lib/worker-messages";

type Status = "idle" | "detecting" | "loading" | "downloading" | "initializing" | "processing" | "error";
type PendingTask = {
  resolve: (value: Candidate[] | HTMLCanvasElement) => void;
  reject: (reason: Error) => void;
};

function canvasContext(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("canvas-unavailable");
  return context;
}

export function useImageWorker() {
  const workerRef = useRef<Worker | null>(null);
  const activeTask = useRef<string | null>(null);
  const pending = useRef(new Map<string, PendingTask>());
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const destroyWorker = useCallback((reason?: Error) => {
    workerRef.current?.terminate();
    workerRef.current = null;
    if (reason) {
      for (const task of pending.current.values()) task.reject(reason);
      pending.current.clear();
    }
    activeTask.current = null;
  }, []);

  const ensureWorker = useCallback(() => {
    if (workerRef.current) return workerRef.current;
    const worker = new Worker(new URL("../workers/image.worker.ts", import.meta.url));
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === "progress") {
        if (message.taskId !== activeTask.current) return;
        setStatus(message.stage);
        setProgress(message.progress);
        return;
      }
      if (!("taskId" in message) || !message.taskId) return;
      const task = pending.current.get(message.taskId);
      if (!task || message.taskId !== activeTask.current) return;
      if (message.type === "detected") task.resolve(message.candidates);
      else if (message.type === "repaired") {
        const canvas = document.createElement("canvas");
        canvas.width = message.width;
        canvas.height = message.height;
        canvasContext(canvas).putImageData(
          new ImageData(new Uint8ClampedArray(message.rgba), message.width, message.height),
          0,
          0,
        );
        task.resolve(canvas);
      } else if (message.type === "cancelled") task.reject(new Error("cancelled"));
      else if (message.type === "error") task.reject(new Error(message.message));
      else return;
      pending.current.delete(message.taskId);
      activeTask.current = null;
      setStatus("idle");
      setProgress(0);
    };
    worker.onerror = () => {
      const reason = new Error("图像 Worker 已停止，可重试恢复。");
      setError(reason.message);
      setStatus("error");
      destroyWorker(reason);
    };
    worker.postMessage({ type: "init" } satisfies WorkerRequest);
    workerRef.current = worker;
    return worker;
  }, [destroyWorker]);

  useEffect(() => () => destroyWorker(new Error("released")), [destroyWorker]);

  const run = useCallback(<T extends Candidate[] | HTMLCanvasElement>(request: WorkerRequest, transfer: Transferable[]) => {
    const taskId = "taskId" in request ? request.taskId : null;
    if (!taskId) return Promise.reject(new Error("missing-task-id"));
    if (activeTask.current) return Promise.reject(new Error("已有图像任务正在处理。"));
    setError(null);
    activeTask.current = taskId;
    return new Promise<T>((resolve, reject) => {
      pending.current.set(taskId, {
        resolve: resolve as PendingTask["resolve"],
        reject,
      });
      ensureWorker().postMessage(request, transfer);
    }).catch((reason) => {
      if (reason instanceof Error && reason.message !== "cancelled") {
        const detail = process.env.NODE_ENV === "development" ? ` 错误：${reason.message}` : "";
        setError(`处理失败，图片和遮罩已保留，可重试或继续编辑。${detail}`);
        setStatus("error");
      }
      throw reason;
    });
  }, [ensureWorker]);

  const detect = useCallback((image: DecodedImage) => {
    const canvas = document.createElement("canvas");
    canvas.width = image.detection.width;
    canvas.height = image.detection.height;
    const context = canvasContext(canvas);
    context.drawImage(image.canvas, 0, 0, canvas.width, canvas.height);
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    canvas.width = 0;
    canvas.height = 0;
    const taskId = crypto.randomUUID();
    setStatus("detecting");
    setProgress(0.2);
    return run<Candidate[]>(
      {
        type: "detect",
        taskId,
        width: image.detection.width,
        height: image.detection.height,
        workWidth: image.work.width,
        workHeight: image.work.height,
        rgba: rgba.buffer,
      },
      [rgba.buffer],
    );
  }, [run]);

  const repair = useCallback((image: DecodedImage, sourceCanvas: HTMLCanvasElement, maskCanvas: HTMLCanvasElement, method: RepairMethod) => {
    const imageData = canvasContext(sourceCanvas).getImageData(0, 0, image.work.width, image.work.height);
    const maskData = canvasContext(maskCanvas).getImageData(0, 0, image.work.width, image.work.height).data;
    const mask = new Uint8Array(image.work.width * image.work.height);
    for (let index = 0; index < mask.length; index += 1) mask[index] = maskData[index * 4 + 3];
    const taskId = crypto.randomUUID();
    setStatus("loading");
    setProgress(0.05);
    return run<HTMLCanvasElement>(
      {
        type: "repair",
        taskId,
        width: image.work.width,
        height: image.work.height,
        rgba: imageData.data.buffer,
        mask: mask.buffer,
        method,
      },
      [imageData.data.buffer, mask.buffer],
    );
  }, [run]);

  const cancel = useCallback(() => {
    const taskId = activeTask.current;
    if (!taskId) return;
    workerRef.current?.postMessage({ type: "cancel", taskId } satisfies WorkerRequest);
    const task = pending.current.get(taskId);
    task?.reject(new Error("cancelled"));
    pending.current.delete(taskId);
    destroyWorker();
    setStatus("idle");
    setProgress(0);
  }, [destroyWorker]);

  const recover = useCallback(() => {
    destroyWorker();
    setError(null);
    setStatus("idle");
    setProgress(0);
  }, [destroyWorker]);

  return { status, progress, error, detect, repair, cancel, recover };
}
