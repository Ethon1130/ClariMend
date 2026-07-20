import type { Candidate } from "./worker-messages";

type Component = { x: number; y: number; width: number; height: number; pixels: number };

function grayscale(rgba: Uint8ClampedArray, width: number, height: number) {
  const gray = new Uint8Array(width * height);
  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * 4;
    gray[index] = Math.round(rgba[offset] * 0.299 + rgba[offset + 1] * 0.587 + rgba[offset + 2] * 0.114);
  }
  return gray;
}

function boxBlur(gray: Uint8Array, width: number, height: number) {
  const blurred = new Uint8Array(gray.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) sum += gray[(y + dy) * width + x + dx];
      }
      blurred[y * width + x] = Math.round(sum / 9);
    }
  }
  return blurred;
}

function sobelEdges(gray: Uint8Array, width: number, height: number) {
  const magnitude = new Uint8Array(width * height);
  const contrast = new Uint8Array(width * height);
  let sum = 0;
  let squareSum = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const top = (y - 1) * width + x;
      const middle = y * width + x;
      const bottom = (y + 1) * width + x;
      const gx =
        -gray[top - 1] + gray[top + 1] - 2 * gray[middle - 1] + 2 * gray[middle + 1] - gray[bottom - 1] + gray[bottom + 1];
      const gy =
        -gray[top - 1] - 2 * gray[top] - gray[top + 1] + gray[bottom - 1] + 2 * gray[bottom] + gray[bottom + 1];
      const value = Math.min(255, Math.hypot(gx, gy));
      magnitude[middle] = value;
      let localMin = 255;
      let localMax = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const sample = gray[(y + dy) * width + x + dx];
          localMin = Math.min(localMin, sample);
          localMax = Math.max(localMax, sample);
        }
      }
      contrast[middle] = localMax - localMin;
      sum += value;
      squareSum += value * value;
      count += 1;
    }
  }
  const mean = sum / Math.max(1, count);
  const deviation = Math.sqrt(Math.max(0, squareSum / Math.max(1, count) - mean * mean));
  return { magnitude, contrast, threshold: Math.min(180, Math.max(42, mean + deviation * 1.15)) };
}

function closeEdges(edges: Uint8Array, contrast: Uint8Array, width: number, height: number, threshold: number) {
  const dilated = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 2; x < width - 2; x += 1) {
      let active = false;
      for (let dy = -1; dy <= 1 && !active; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const index = (y + dy) * width + x + dx;
          const adaptiveThreshold = Math.max(32, threshold - contrast[index] * 0.18);
          if (edges[index] >= adaptiveThreshold && contrast[index] >= 18) {
            active = true;
            break;
          }
        }
      }
      dilated[y * width + x] = active ? 1 : 0;
    }
  }
  const closed = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 2; x < width - 2; x += 1) {
      let neighbors = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) neighbors += dilated[(y + dy) * width + x + dx];
      }
      closed[y * width + x] = neighbors >= 5 ? 1 : 0;
    }
  }
  return closed;
}

function components(binary: Uint8Array, width: number, height: number) {
  const visited = new Uint8Array(binary.length);
  const queue = new Int32Array(binary.length);
  const found: Component[] = [];
  for (let start = 0; start < binary.length; start += 1) {
    if (!binary[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let pixels = 0;
    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      pixels += 1;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
          const next = nextY * width + nextX;
          if (binary[next] && !visited[next]) {
            visited[next] = 1;
            queue[tail++] = next;
          }
        }
      }
    }
    found.push({ x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, pixels });
  }
  return found;
}

function groupTextLike(input: Component[]) {
  const groups: Component[] = [];
  for (const component of input.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const match = groups.find((group) => {
      const verticalOverlap = Math.min(group.y + group.height, component.y + component.height) - Math.max(group.y, component.y);
      const gap = component.x - (group.x + group.width);
      return verticalOverlap >= Math.min(group.height, component.height) * 0.45 && gap >= -4 && gap <= Math.max(group.height, component.height) * 1.8;
    });
    if (!match) {
      groups.push({ ...component });
      continue;
    }
    const right = Math.max(match.x + match.width, component.x + component.width);
    const bottom = Math.max(match.y + match.height, component.y + component.height);
    match.x = Math.min(match.x, component.x);
    match.y = Math.min(match.y, component.y);
    match.width = right - match.x;
    match.height = bottom - match.y;
    match.pixels += component.pixels;
  }
  return groups;
}

export function detectCandidates(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  workWidth: number,
  workHeight: number,
): Candidate[] {
  const gray = boxBlur(grayscale(rgba, width, height), width, height);
  const { magnitude, contrast, threshold } = sobelEdges(gray, width, height);
  const closed = closeEdges(magnitude, contrast, width, height, threshold);
  const filtered = components(closed, width, height).filter((component) => {
    const area = component.width * component.height;
    const ratio = component.width / component.height;
    return component.width >= 5 && component.height >= 4 && area < width * height * 0.18 && ratio >= 0.18 && ratio <= 35;
  });
  const scaleX = workWidth / width;
  const scaleY = workHeight / height;
  return groupTextLike(filtered)
    .filter((component) => component.width >= 10 && component.height <= height * 0.4)
    .sort((a, b) => b.width * b.height - a.width * a.height)
    .slice(0, 40)
    .map((component, index) => ({
      id: `candidate-${index}`,
      type: "text-like",
      confidence: Math.min(0.95, 0.5 + component.pixels / (component.width * component.height) * 0.35),
      source: "heuristic",
      x: Math.round(component.x * scaleX),
      y: Math.round(component.y * scaleY),
      width: Math.max(2, Math.round(component.width * scaleX)),
      height: Math.max(2, Math.round(component.height * scaleY)),
    }));
}
