import { describe, expect, it } from "vitest";
import { cloneStrokeBounds } from "./clone-stamp";

describe("clone stamp", () => {
  it("bounds a stroke and clamps it to the image", () => {
    expect(cloneStrokeBounds({ points: [2, 3, 12, 13], size: 8 }, 100, 80)).toEqual({
      x: 0,
      y: 0,
      width: 18,
      height: 19,
    });
  });
});
