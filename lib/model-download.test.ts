import { describe, expect, it, vi } from "vitest";
import { readResponseBytes } from "./model-download";

describe("readResponseBytes", () => {
  it("reports streamed download progress and returns the complete response", async () => {
    const progress = vi.fn();
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3, 4]));
        controller.close();
      },
    }), { headers: { "content-length": "4" } });

    await expect(readResponseBytes(response, progress)).resolves.toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(progress).toHaveBeenLastCalledWith(4, 4);
  });

  it("rejects incomplete downloads", async () => {
    const response = new Response(new Uint8Array([1, 2]), { headers: { "content-length": "4" } });
    await expect(readResponseBytes(response, vi.fn())).rejects.toThrow("model-size-mismatch");
  });
});
