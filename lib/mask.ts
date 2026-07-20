export type MaskRectangle = {
  id: string;
  kind: "rectangle";
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MaskStroke = {
  id: string;
  kind: "stroke";
  mode: "add" | "erase";
  points: number[];
  size: number;
};

export type MaskShape = MaskRectangle | MaskStroke;

export type MaskStats = {
  pixels: number;
  coverage: number;
  bounds: { x: number; y: number; width: number; height: number } | null;
};

export function normalizeRectangle(rectangle: Omit<MaskRectangle, "id" | "kind">) {
  return {
    x: rectangle.width < 0 ? rectangle.x + rectangle.width : rectangle.x,
    y: rectangle.height < 0 ? rectangle.y + rectangle.height : rectangle.y,
    width: Math.abs(rectangle.width),
    height: Math.abs(rectangle.height),
  };
}

export function rasterizeMask(width: number, height: number, shapes: MaskShape[]) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("canvas-unavailable");

  for (const shape of shapes) {
    if (shape.kind === "rectangle") {
      context.globalCompositeOperation = "source-over";
      context.fillStyle = "white";
      context.fillRect(shape.x, shape.y, shape.width, shape.height);
      continue;
    }

    context.globalCompositeOperation = shape.mode === "erase" ? "destination-out" : "source-over";
    context.strokeStyle = "white";
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = shape.size;
    context.beginPath();
    for (let index = 0; index < shape.points.length; index += 2) {
      const x = shape.points[index];
      const y = shape.points[index + 1];
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    if (shape.points.length === 2) {
      context.lineTo(shape.points[0] + 0.01, shape.points[1] + 0.01);
    }
    context.stroke();
  }
  context.globalCompositeOperation = "source-over";
  return canvas;
}

export function getMaskStats(canvas: HTMLCanvasElement): MaskStats {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("canvas-unavailable");
  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
  let pixels = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] === 0) continue;
      pixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  return {
    pixels,
    coverage: pixels / (width * height),
    bounds: pixels === 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
  };
}
