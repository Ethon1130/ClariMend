import { describe, expect, it } from "vitest";
import { imageToScreen, screenToImage, zoomAroundPoint } from "./coordinates";

describe("coordinate transforms", () => {
  it.each([0.25, 1, 4, 8])("round trips at %sx zoom", (scale) => {
    const transform = { x: 137, y: -28, scale };
    const point = { x: 513.25, y: 274.75 };
    const roundTrip = screenToImage(imageToScreen(point, transform), transform);
    expect(roundTrip.x).toBeCloseTo(point.x, 8);
    expect(roundTrip.y).toBeCloseTo(point.y, 8);
  });

  it("keeps the image point under the cursor while zooming", () => {
    const cursor = { x: 320, y: 240 };
    const before = { x: 10, y: 20, scale: 1 };
    const imagePoint = screenToImage(cursor, before);
    const after = zoomAroundPoint(before, cursor, 4);
    expect(imageToScreen(imagePoint, after)).toEqual(cursor);
  });
});
