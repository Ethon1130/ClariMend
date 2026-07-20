import { describe, expect, it } from "vitest";
import { compositeCrop } from "./inpaint-composite";

describe("inpaint compositing", () => {
  it("keeps every pixel outside the blend mask byte-identical", () => {
    const original = new Uint8ClampedArray([
      1, 2, 3, 4, 10, 20, 30, 40,
      5, 6, 7, 8, 50, 60, 70, 80,
    ]);
    const repaired = new Uint8Array([100, 100, 100, 200, 200, 200]);
    const result = compositeCrop(original, repaired, new Uint8Array([0, 255]), { x: 0, y: 0, width: 2, height: 1 }, 2);
    expect(Array.from(result.slice(0, 4))).toEqual([1, 2, 3, 4]);
    expect(Array.from(result.slice(4, 8))).toEqual([200, 200, 200, 40]);
    expect(Array.from(result.slice(8))).toEqual(Array.from(original.slice(8)));
  });
});
