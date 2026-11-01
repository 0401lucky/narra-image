import "server-only";

import { CanvasContractError } from "./contracts";

const BODY_TIMEOUT_MS = 30_000;

export async function readCanvasBody(request: Request, maximumBytes: number): Promise<Buffer> {
  const encoding = request.headers.get("content-encoding");
  if (encoding && encoding.toLowerCase() !== "identity") throw new CanvasContractError("CANVAS_INVALID_INPUT");
  const declared = request.headers.get("content-length");
  if (declared !== null && !/^\d+$/.test(declared)) throw new CanvasContractError("CANVAS_INVALID_INPUT");
  if (declared !== null && Number(declared) > maximumBytes) throw new CanvasContractError("CANVAS_LIMIT_EXCEEDED");
  if (!request.body) throw new CanvasContractError("CANVAS_INVALID_INPUT");

  const reader = request.body.getReader();
  let buffer = Buffer.allocUnsafe(Math.min(maximumBytes, 64 * 1024));
  let bytes = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CanvasContractError("CANVAS_INVALID_INPUT")), BODY_TIMEOUT_MS);
  });
  try {
    for (;;) {
      const part = await Promise.race([reader.read(), deadline]);
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maximumBytes) throw new CanvasContractError("CANVAS_LIMIT_EXCEEDED");
      if (bytes > buffer.length) {
        const next = Buffer.allocUnsafe(Math.min(maximumBytes, Math.max(bytes, buffer.length * 2)));
        buffer.copy(next, 0, 0, bytes - part.value.byteLength);
        buffer = next;
      }
      buffer.set(part.value, bytes - part.value.byteLength);
    }
    if (declared !== null && Number(declared) !== bytes) throw new CanvasContractError("CANVAS_INVALID_INPUT");
    return buffer.subarray(0, bytes);
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error instanceof CanvasContractError ? error : new CanvasContractError("CANVAS_INVALID_INPUT");
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}

export async function readCanvasJson(request: Request, maximumBytes: number): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new CanvasContractError("CANVAS_INVALID_INPUT");
  const body = await readCanvasBody(request, maximumBytes);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown;
  } catch {
    throw new CanvasContractError("CANVAS_INVALID_INPUT");
  }
}
