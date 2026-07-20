import { afterEach, describe, expect, it, vi } from "vitest";
import { getMaskStats, normalizeRectangle } from "./mask";

describe("mask helpers", () => {
  afterEach(() => vi.restoreAllMocks());

  it("normalizes rectangles drawn in any direction", () => {
    expect(normalizeRectangle({ x: 10, y: 20, width: -4, height: -8 })).toEqual({
      x: 6,
      y: 12,
      width: 4,
      height: 8,
    });
  });

  it("calculates coverage and bounds from alpha", () => {
    const pixels = new Uint8ClampedArray(4 * 4 * 4);
    pixels[(1 * 4 + 1) * 4 + 3] = 255;
    pixels[(2 * 4 + 2) * 4 + 3] = 255;
    const context = { getImageData: vi.fn(() => ({ data: pixels, width: 4, height: 4 })) };
    const canvas = { width: 4, height: 4, getContext: vi.fn(() => context) } as unknown as HTMLCanvasElement;
    expect(getMaskStats(canvas)).toEqual({
      pixels: 2,
      coverage: 0.125,
      bounds: { x: 1, y: 1, width: 2, height: 2 },
    });
  });
});
