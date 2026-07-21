import { describe, expect, it } from "vitest";
import { LAMA_SIZE, createLamaMaskInput, lamaCrop, resizeLamaOutput } from "./lama";

describe("LaMa preprocessing", () => {
  it("creates a bounded local crop", () => {
    expect(lamaCrop({ x: 900, y: 700, width: 100, height: 80 }, 1000, 800)).toEqual({
      x: 708,
      y: 508,
      width: 292,
      height: 292,
    });
  });

  it("converts the mask to a binary 512 square", () => {
    const input = createLamaMaskInput(new Uint8Array([0, 255, 0, 0]), 2, 2);
    expect(input).toHaveLength(LAMA_SIZE * LAMA_SIZE);
    expect(input[0]).toBe(0);
    expect(input[LAMA_SIZE - 1]).toBe(1);
  });

  it("maps normalized model output back to RGB bytes", () => {
    const plane = LAMA_SIZE * LAMA_SIZE;
    const input = new Float32Array(plane * 3);
    input.fill(0.5, 0, plane);
    input.fill(0.25, plane, plane * 2);
    input.fill(1, plane * 2);
    expect(Array.from(resizeLamaOutput(input, 1, 1))).toEqual([128, 64, 255]);
  });
});
