export type Point = { x: number; y: number };
export type ViewTransform = { x: number; y: number; scale: number };

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 8;

export function clampScale(scale: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function screenToImage(point: Point, transform: ViewTransform): Point {
  return {
    x: (point.x - transform.x) / transform.scale,
    y: (point.y - transform.y) / transform.scale,
  };
}

export function imageToScreen(point: Point, transform: ViewTransform): Point {
  return {
    x: point.x * transform.scale + transform.x,
    y: point.y * transform.scale + transform.y,
  };
}

export function zoomAroundPoint(transform: ViewTransform, screenPoint: Point, nextScale: number): ViewTransform {
  const scale = clampScale(nextScale);
  const imagePoint = screenToImage(screenPoint, transform);
  return {
    scale,
    x: screenPoint.x - imagePoint.x * scale,
    y: screenPoint.y - imagePoint.y * scale,
  };
}

export function fitImageToViewport(image: { width: number; height: number }, viewport: { width: number; height: number }): ViewTransform {
  const scale = clampScale(Math.min(viewport.width / image.width, viewport.height / image.height) * 0.92);
  return {
    scale,
    x: (viewport.width - image.width * scale) / 2,
    y: (viewport.height - image.height * scale) / 2,
  };
}
