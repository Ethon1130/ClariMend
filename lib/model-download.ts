export async function readResponseBytes(
  response: Response,
  onProgress: (received: number, total: number) => void,
) {
  const total = Number(response.headers.get("content-length"));
  if (!response.body || !Number.isSafeInteger(total) || total <= 0) {
    return new Uint8Array(await response.arrayBuffer());
  }

  const bytes = new Uint8Array(total);
  const reader = response.body.getReader();
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (received + value.length > total) throw new Error("model-size-mismatch");
    bytes.set(value, received);
    received += value.length;
    onProgress(received, total);
  }
  if (received !== total) throw new Error("model-size-mismatch");
  return bytes;
}
