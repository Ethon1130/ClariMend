export type CloneStroke = {
  id: string;
  kind: "clone";
  points: number[];
  size: number;
  offsetX: number;
  offsetY: number;
};

export function cloneStrokeBounds(
  stroke: Pick<CloneStroke, "points" | "size">,
  width: number,
  height: number,
) {
  const radius = stroke.size / 2 + 2;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (let index = 0; index < stroke.points.length; index += 2) {
    minX = Math.min(minX, stroke.points[index]);
    minY = Math.min(minY, stroke.points[index + 1]);
    maxX = Math.max(maxX, stroke.points[index]);
    maxY = Math.max(maxY, stroke.points[index + 1]);
  }
  const x = Math.max(0, Math.floor(minX - radius));
  const y = Math.max(0, Math.floor(minY - radius));
  const right = Math.min(width, Math.ceil(maxX + radius));
  const bottom = Math.min(height, Math.ceil(maxY + radius));
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

function drawStrokeMask(context: CanvasRenderingContext2D, stroke: CloneStroke, originX: number, originY: number) {
  context.strokeStyle = "white";
  context.fillStyle = "white";
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = stroke.size;
  context.beginPath();
  for (let index = 0; index < stroke.points.length; index += 2) {
    const x = stroke.points[index] - originX;
    const y = stroke.points[index + 1] - originY;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  if (stroke.points.length === 2) {
    context.arc(stroke.points[0] - originX, stroke.points[1] - originY, stroke.size / 2, 0, Math.PI * 2);
    context.fill();
  } else {
    context.stroke();
  }
}

export function renderCloneStrokes(source: HTMLCanvasElement, strokes: CloneStroke[]) {
  const output = document.createElement("canvas");
  output.width = source.width;
  output.height = source.height;
  const outputContext = output.getContext("2d");
  if (!outputContext) throw new Error("canvas-unavailable");
  outputContext.drawImage(source, 0, 0);

  for (const stroke of strokes) {
    const bounds = cloneStrokeBounds(stroke, output.width, output.height);
    if (!bounds.width || !bounds.height) continue;
    const patch = document.createElement("canvas");
    patch.width = bounds.width;
    patch.height = bounds.height;
    const patchContext = patch.getContext("2d");
    if (!patchContext) throw new Error("canvas-unavailable");

    patchContext.drawImage(
      output,
      -bounds.x - stroke.offsetX,
      -bounds.y - stroke.offsetY,
    );
    patchContext.globalCompositeOperation = "destination-in";
    drawStrokeMask(patchContext, stroke, bounds.x, bounds.y);
    patchContext.globalCompositeOperation = "source-over";
    outputContext.drawImage(patch, bounds.x, bounds.y);
    patch.width = 0;
    patch.height = 0;
  }

  return output;
}
