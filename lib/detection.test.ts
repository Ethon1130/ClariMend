import { describe, expect, it } from "vitest";
import { detectCandidates } from "./detection";

describe("candidate detection", () => {
  it("finds grouped high-contrast text-like marks", () => {
    const width = 120;
    const height = 80;
    const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
    for (let glyph = 0; glyph < 4; glyph += 1) {
      const left = 18 + glyph * 17;
      for (let y = 32; y < 48; y += 1) {
        for (let x = left; x < left + 9; x += 1) {
          const offset = (y * width + x) * 4;
          rgba[offset] = 0;
          rgba[offset + 1] = 0;
          rgba[offset + 2] = 0;
        }
      }
    }
    const candidates = detectCandidates(rgba, width, height, width * 2, height * 2);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].width).toBeGreaterThan(40);
  });
});
