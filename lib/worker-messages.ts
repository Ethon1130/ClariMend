export type Candidate = {
  id: string;
  type: "text-like";
  confidence: number;
  source: "heuristic";
  x: number;
  y: number;
  width: number;
  height: number;
};

export type RepairMethod = "traditional" | "lama";

export type WorkerRequest =
  | { type: "init" }
  | {
      type: "detect";
      taskId: string;
      width: number;
      height: number;
      workWidth: number;
      workHeight: number;
      rgba: ArrayBuffer;
    }
  | {
      type: "repair";
      taskId: string;
      width: number;
      height: number;
      rgba: ArrayBuffer;
      mask: ArrayBuffer;
      method: RepairMethod;
    }
  | { type: "cancel"; taskId: string }
  | { type: "release" };

export type WorkerResponse =
  | { type: "ready" }
  | { type: "progress"; taskId: string; stage: "loading" | "downloading" | "initializing" | "processing"; progress: number }
  | { type: "detected"; taskId: string; candidates: Candidate[] }
  | { type: "repaired"; taskId: string; width: number; height: number; rgba: ArrayBuffer; method: "telea" | "ns" | "lama" }
  | { type: "cancelled"; taskId: string }
  | { type: "released" }
  | { type: "error"; taskId?: string; code: string; message: string };
