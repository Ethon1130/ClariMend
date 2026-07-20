export const DESKTOP_WORK_PIXELS = 8_000_000;
export const LOW_MEMORY_WORK_PIXELS = 4_000_000;
export const PREVIEW_LONG_EDGE = 2048;
export const DETECTION_LONG_EDGE = 1024;

export type ImageSize = { width: number; height: number };

export function fitToPixelLimit(size: ImageSize, maxPixels: number): ImageSize {
  const pixels = size.width * size.height;
  if (pixels <= maxPixels) return { ...size };
  const scale = Math.sqrt(maxPixels / pixels);
  return {
    width: Math.max(1, Math.floor(size.width * scale)),
    height: Math.max(1, Math.floor(size.height * scale)),
  };
}

export function fitToLongEdge(size: ImageSize, maxEdge: number): ImageSize {
  const longest = Math.max(size.width, size.height);
  if (longest <= maxEdge) return { ...size };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

export function chooseWorkPixelLimit(options: {
  deviceMemory?: number;
  touchPoints: number;
  narrowViewport: boolean;
}) {
  if (options.deviceMemory !== undefined) {
    return options.deviceMemory <= 4 ? LOW_MEMORY_WORK_PIXELS : DESKTOP_WORK_PIXELS;
  }
  return options.touchPoints > 0 && options.narrowViewport ? LOW_MEMORY_WORK_PIXELS : DESKTOP_WORK_PIXELS;
}

export function calculateImageSizes(source: ImageSize, workPixelLimit: number) {
  const work = fitToPixelLimit(source, workPixelLimit);
  return {
    source,
    work,
    preview: fitToLongEdge(work, PREVIEW_LONG_EDGE),
    detection: fitToLongEdge(work, DETECTION_LONG_EDGE),
    downsampled: work.width !== source.width || work.height !== source.height,
  };
}
