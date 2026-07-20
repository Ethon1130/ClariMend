export type ConnectedMaskStats = {
  regions: number;
  largestRegionPixels: number;
};

const DIRECTIONS = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;

export function analyzeConnectedMask(mask: Uint8Array, width: number, height: number): ConnectedMaskStats {
  const visited = new Uint8Array(mask.length);
  const queue: number[] = [];
  let regions = 0;
  let largestRegionPixels = 0;

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    regions += 1;
    let head = 0;
    let regionPixels = 0;
    queue.length = 0;
    queue.push(start);
    visited[start] = 1;
    while (head < queue.length) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      regionPixels += 1;
      for (const [dx, dy] of DIRECTIONS) {
        const nextX = x + dx;
        const nextY = y + dy;
        if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
        const next = nextY * width + nextX;
        if (mask[next] && !visited[next]) {
          visited[next] = 1;
          queue.push(next);
        }
      }
    }
    largestRegionPixels = Math.max(largestRegionPixels, regionPixels);
  }
  return { regions, largestRegionPixels };
}
