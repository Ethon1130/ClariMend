export const LAMA_SIZE = 512;

export type Crop = { x: number; y: number; width: number; height: number };

export function lamaCrop(
  bounds: { x: number; y: number; width: number; height: number },
  imageWidth: number,
  imageHeight: number,
): Crop {
  const longest = Math.max(bounds.width, bounds.height);
  if (longest > 1536) throw new Error("lama-selection-too-large");
  const context = Math.min(384, Math.max(96, Math.round(longest * 0.6)));
  const size = Math.min(2048, Math.max(256, longest + context * 2));
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const width = Math.min(imageWidth, size);
  const height = Math.min(imageHeight, size);
  return {
    x: Math.max(0, Math.min(imageWidth - width, Math.round(centerX - width / 2))),
    y: Math.max(0, Math.min(imageHeight - height, Math.round(centerY - height / 2))),
    width,
    height,
  };
}

function bilinear(value: Uint8ClampedArray, width: number, height: number, x: number, y: number, channel: number) {
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(y)));
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const top = value[(y0 * width + x0) * 4 + channel] * (1 - tx) + value[(y0 * width + x1) * 4 + channel] * tx;
  const bottom = value[(y1 * width + x0) * 4 + channel] * (1 - tx) + value[(y1 * width + x1) * 4 + channel] * tx;
  return top * (1 - ty) + bottom * ty;
}

export function createLamaImageInput(rgba: Uint8ClampedArray, width: number, height: number) {
  const plane = LAMA_SIZE * LAMA_SIZE;
  const output = new Float32Array(plane * 3);
  for (let y = 0; y < LAMA_SIZE; y += 1) {
    const sourceY = ((y + 0.5) * height) / LAMA_SIZE - 0.5;
    for (let x = 0; x < LAMA_SIZE; x += 1) {
      const sourceX = ((x + 0.5) * width) / LAMA_SIZE - 0.5;
      const target = y * LAMA_SIZE + x;
      for (let channel = 0; channel < 3; channel += 1) {
        output[channel * plane + target] = bilinear(rgba, width, height, sourceX, sourceY, channel) / 255;
      }
    }
  }
  return output;
}

export function createLamaMaskInput(mask: Uint8Array, width: number, height: number) {
  const output = new Float32Array(LAMA_SIZE * LAMA_SIZE);
  for (let y = 0; y < LAMA_SIZE; y += 1) {
    const sourceY = Math.min(height - 1, Math.floor((y * height) / LAMA_SIZE));
    for (let x = 0; x < LAMA_SIZE; x += 1) {
      const sourceX = Math.min(width - 1, Math.floor((x * width) / LAMA_SIZE));
      output[y * LAMA_SIZE + x] = mask[sourceY * width + sourceX] ? 1 : 0;
    }
  }
  return output;
}

export function resizeLamaOutput(output: Float32Array, width: number, height: number) {
  const result = new Uint8Array(width * height * 3);
  const plane = LAMA_SIZE * LAMA_SIZE;
  let maximum = 0;
  for (let index = 0; index < output.length; index += 1) maximum = Math.max(maximum, output[index]);
  const scale = maximum <= 2 ? 255 : 1;
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(LAMA_SIZE - 1, Math.round(((y + 0.5) * LAMA_SIZE) / height - 0.5));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(LAMA_SIZE - 1, Math.round(((x + 0.5) * LAMA_SIZE) / width - 0.5));
      const source = sourceY * LAMA_SIZE + sourceX;
      const target = (y * width + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        result[target + channel] = Math.max(0, Math.min(255, Math.round(output[channel * plane + source] * scale)));
      }
    }
  }
  return result;
}

export function featherMask(mask: Uint8Array, width: number, height: number, radius = 3) {
  const dilated = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let active = false;
      for (let dy = -radius; dy <= radius && !active; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const sampleX = x + dx;
          const sampleY = y + dy;
          if (sampleX >= 0 && sampleX < width && sampleY >= 0 && sampleY < height && mask[sampleY * width + sampleX]) {
            active = true;
            break;
          }
        }
      }
      dilated[y * width + x] = active ? 255 : 0;
    }
  }
  const output = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const sampleX = x + dx;
          const sampleY = y + dy;
          if (sampleX < 0 || sampleX >= width || sampleY < 0 || sampleY >= height) continue;
          sum += dilated[sampleY * width + sampleX];
          count += 1;
        }
      }
      output[y * width + x] = dilated[y * width + x] ? Math.round(sum / count) : 0;
    }
  }
  return output;
}
