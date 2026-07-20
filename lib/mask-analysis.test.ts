import { describe, expect, it } from "vitest";
import { analyzeConnectedMask } from "./mask-analysis";

describe("connected mask analysis", () => {
  it("counts regions and the largest region", () => {
    const mask = new Uint8Array([
      1, 1, 0, 0,
      1, 0, 0, 1,
      0, 0, 0, 1,
    ]);
    expect(analyzeConnectedMask(mask, 4, 3)).toEqual({ regions: 2, largestRegionPixels: 3 });
  });
});
