export function compositeCrop(
  original: Uint8ClampedArray,
  repairedRgb: Uint8Array,
  blendMask: Uint8Array,
  crop: { x: number; y: number; width: number; height: number },
  imageWidth: number,
) {
  const result = new Uint8ClampedArray(original);
  for (let y = 0; y < crop.height; y += 1) {
    for (let x = 0; x < crop.width; x += 1) {
      const cropIndex = y * crop.width + x;
      const weight = blendMask[cropIndex] / 255;
      if (weight === 0) continue;
      const imageIndex = ((crop.y + y) * imageWidth + crop.x + x) * 4;
      const repairedIndex = cropIndex * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        result[imageIndex + channel] = Math.round(
          original[imageIndex + channel] * (1 - weight) + repairedRgb[repairedIndex + channel] * weight,
        );
      }
      result[imageIndex + 3] = original[imageIndex + 3];
    }
  }
  return result;
}
