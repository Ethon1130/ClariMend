import { describe, expect, it } from "vitest";
import {
  LOW_MEMORY_WORK_PIXELS,
  calculateImageSizes,
  chooseWorkPixelLimit,
  fitToLongEdge,
  fitToPixelLimit,
} from "./image-sizes";

describe("image size limits", () => {
  it("preserves an image already within the pixel limit", () => {
    expect(fitToPixelLimit({ width: 2000, height: 1000 }, 4_000_000)).toEqual({ width: 2000, height: 1000 });
  });

  it("keeps aspect ratio while reducing pixels", () => {
    expect(fitToPixelLimit({ width: 4000, height: 3000 }, 4_000_000)).toEqual({ width: 2309, height: 1732 });
  });

  it("limits the longest edge", () => {
    expect(fitToLongEdge({ width: 4000, height: 2000 }, 1024)).toEqual({ width: 1024, height: 512 });
  });

  it("uses the low-memory limit for constrained and fallback mobile devices", () => {
    expect(chooseWorkPixelLimit({ deviceMemory: 4, touchPoints: 0, narrowViewport: false })).toBe(
      LOW_MEMORY_WORK_PIXELS,
    );
    expect(chooseWorkPixelLimit({ touchPoints: 5, narrowViewport: true })).toBe(LOW_MEMORY_WORK_PIXELS);
  });

  it("calculates work, preview and detection sizes", () => {
    const sizes = calculateImageSizes({ width: 4000, height: 3000 }, 4_000_000);
    expect(sizes.work).toEqual({ width: 2309, height: 1732 });
    expect(Math.max(sizes.preview.width, sizes.preview.height)).toBe(2048);
    expect(Math.max(sizes.detection.width, sizes.detection.height)).toBe(1024);
    expect(sizes.downsampled).toBe(true);
  });
});
