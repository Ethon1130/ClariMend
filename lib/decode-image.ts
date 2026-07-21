import type { ImageHeader } from "./image-validation";
import { calculateImageSizes } from "./image-sizes";

export type DecodedImage = {
  fileName: string;
  format: ImageHeader["format"];
  hasAlpha: boolean;
  canvas: HTMLCanvasElement;
  source: { width: number; height: number };
  work: { width: number; height: number };
  preview: { width: number; height: number };
  detection: { width: number; height: number };
  downsampled: boolean;
};

type DecodedSource = {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
};

async function decodeSource(file: File): Promise<DecodedSource> {
  if ("createImageBitmap" in window) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Safari and older browsers can reject the options object; the image fallback remains local.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function createCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function drawScaled(source: CanvasImageSource, width: number, height: number) {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("canvas-unavailable");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, width, height);
  return canvas;
}

function stagedDownsample(decoded: DecodedSource, target: { width: number; height: number }) {
  let source = decoded.source;
  let width = decoded.width;
  let height = decoded.height;
  let temporary: HTMLCanvasElement | null = null;

  try {
    while (width > target.width * 2 || height > target.height * 2) {
      const ratio = Math.max(target.width / width, target.height / height, 0.5);
      const nextWidth = Math.max(target.width, Math.round(width * ratio));
      const nextHeight = Math.max(target.height, Math.round(height * ratio));
      const next = drawScaled(source, nextWidth, nextHeight);
      if (temporary) {
        temporary.width = 0;
        temporary.height = 0;
      } else {
        decoded.close();
      }
      temporary = next;
      source = next;
      width = nextWidth;
      height = nextHeight;
    }

    const result = width === target.width && height === target.height ? temporary ?? drawScaled(source, width, height) : drawScaled(source, target.width, target.height);
    if (temporary && temporary !== result) {
      temporary.width = 0;
      temporary.height = 0;
    }
    return result;
  } finally {
    if (!temporary) decoded.close();
  }
}

export async function decodeImageFile(
  file: File,
  header: ImageHeader,
  workPixelLimit: number,
): Promise<DecodedImage> {
  const decoded = await decodeSource(file);
  const sizes = calculateImageSizes({ width: decoded.width, height: decoded.height }, workPixelLimit);
  const canvas = stagedDownsample(decoded, sizes.work);
  return {
    fileName: file.name,
    format: header.format,
    hasAlpha: header.hasAlpha,
    canvas,
    ...sizes,
  };
}
