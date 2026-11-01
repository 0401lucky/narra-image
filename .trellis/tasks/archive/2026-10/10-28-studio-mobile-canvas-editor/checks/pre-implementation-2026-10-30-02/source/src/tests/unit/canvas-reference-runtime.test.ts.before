// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { CanvasContractError } from "@/lib/canvas/contracts";
import { CanvasTransportError } from "@/components/create/canvas/client-api";
import type { CanvasDraftBlobV1 } from "@/components/create/canvas/draft-types";
import { createCanvasReferenceRuntime, validateCanvasOriginal, type CanvasReferenceCapture } from "@/components/create/canvas/reference-runtime";

import { canvasAsset, canvasDigest, canvasUuid, createFakeCanvasApi, deferred } from "./helpers/canvas-controller-fixtures";

function fixture() {
  const api = createFakeCanvasApi();
  const original: CanvasDraftBlobV1 = { blobId: canvasUuid(1), uploadId: canvasUuid(2), blob: new Blob(["png"], { type: "image/png" }), fileName: "original.png", lastModified: 1, sha256: null, assetId: null };
  const originals = new Map([[original.blobId, original]]);
  const capture: CanvasReferenceCapture = { source: { kind: "local", blobId: original.blobId, uploadId: original.uploadId }, original };
  const onAsset = vi.fn();
  const onOriginal = vi.fn((item: CanvasDraftBlobV1) => originals.set(item.blobId, item));
  const runtime = createCanvasReferenceRuntime({ api: api.port, signal: new AbortController().signal, uuid: () => canvasUuid(90), readOriginal: (id) => originals.get(id), onOriginal, onAsset, alive: () => true });
  return { api, original, originals, capture, onAsset, onOriginal, runtime };
}

describe("canvas original runtime", () => {
  it("shares one promise/identity and computes a real SHA-256 outside storage transactions", async () => {
    const f = fixture();
    const gate = deferred<void>();
    const upload = vi.mocked(f.api.port.upload).getMockImplementation()!;
    vi.mocked(f.api.port.upload).mockImplementationOnce(async (...args) => { await gate.promise; return upload(...args); });
    const first = f.runtime.resolve(f.capture);
    const second = f.runtime.resolve(f.capture);
    expect(first).toBe(second);
    await vi.waitFor(() => expect(f.api.port.upload).toHaveBeenCalled());
    gate.resolve();
    const [a, b] = await Promise.all([first, second]);
    expect(a.id).toBe(b.id);
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await f.original.blob.arrayBuffer())), (byte) => byte.toString(16).padStart(2, "0")).join("");
    expect(vi.mocked(f.api.port.upload).mock.calls[0][0]).toMatchObject({ uploadId: f.original.uploadId, sha256: digest });
    expect(f.originals.get(f.original.blobId)).toMatchObject({ assetId: a.id, sha256: digest });
    expect(await f.runtime.resolve(f.capture)).toMatchObject({ id: a.id });
    expect(f.api.port.upload).toHaveBeenCalledTimes(1);
  });

  it("recovers a lost upload ACK through status before considering another same-ID POST", async () => {
    const f = fixture();
    const upload = vi.mocked(f.api.port.upload).getMockImplementation()!;
    vi.mocked(f.api.port.upload).mockImplementationOnce(async (...args) => { await upload(...args); throw new CanvasTransportError(); });
    await expect(f.runtime.resolve(f.capture)).rejects.toBeInstanceOf(CanvasTransportError);
    expect(f.originals.get(f.original.blobId)?.assetId).toBeNull();
    const recovered = await f.runtime.resolve(f.capture);
    expect(recovered.state).toBe("READY");
    expect(f.api.port.uploadStatus).toHaveBeenCalledWith(f.original.uploadId, expect.any(AbortSignal));
    expect(f.api.port.upload).toHaveBeenCalledTimes(1);
  });

  it.each(["DELETING", "DELETED"] as const)("a fresh resolve replaces an expired %s upload identity even if its READY ACK was lost", async (state) => {
    const f = fixture();
    const upload = vi.mocked(f.api.port.upload).getMockImplementation()!;
    vi.mocked(f.api.port.upload).mockImplementationOnce(async (...args) => { await upload(...args); throw new CanvasTransportError(); });
    await expect(f.runtime.resolve(f.capture)).rejects.toBeInstanceOf(CanvasTransportError);
    const expired = [...f.api.assets.values()][0];
    f.api.assets.set(expired.id, { ...expired, state, url: null });
    const original = f.originals.get(f.original.blobId)!;
    expect(original.assetId).toBeNull();
    const replacement = await f.runtime.resolve(f.capture);
    expect(replacement).toMatchObject({ state: "READY", uploadId: canvasUuid(90), sha256: original.sha256 });
    expect(replacement.id).not.toBe(expired.id);
    expect(f.api.port.uploadStatus).toHaveBeenCalledWith(expired.uploadId, expect.any(AbortSignal));
    const request = vi.mocked(f.api.port.upload).mock.calls[1][0];
    expect(request).toMatchObject({ uploadId: canvasUuid(90), blob: original.blob, sha256: original.sha256 });
    expect(f.originals.get(f.original.blobId)).toMatchObject({ blobId: original.blobId, blob: original.blob, assetId: replacement.id });
    expect(f.api.port.upload).toHaveBeenCalledTimes(2);
    expect(f.api.port.submit).not.toHaveBeenCalled();
  });

  it("returns an actionable pending state for 202 and only explicit retry reads readiness", async () => {
    const f = fixture();
    const upload = vi.mocked(f.api.port.upload).getMockImplementation()!;
    vi.mocked(f.api.port.upload).mockImplementationOnce(async (...args) => {
      const asset = await upload(...args);
      const pending = { ...asset, state: "UPLOADING" as const, url: null, readyAt: null };
      f.api.assets.set(asset.id, pending);
      return pending;
    });
    await expect(f.runtime.resolve(f.capture)).rejects.toMatchObject({ code: "CANVAS_UPLOAD_PENDING" });
    expect(f.api.port.uploadStatus).not.toHaveBeenCalled();
    const pending = [...f.api.assets.values()][0];
    f.api.assets.set(pending.id, { ...pending, state: "READY", url: "https://images.invalid/ready.png", readyAt: new Date().toISOString() });
    expect((await f.runtime.resolve(f.capture)).id).toBe(pending.id);
    expect(f.api.port.upload).toHaveBeenCalledTimes(1);
  });

  it("quarantined uploads never silently get a new identity/PUT", async () => {
    const f = fixture();
    const upload = vi.mocked(f.api.port.upload).getMockImplementation()!;
    vi.mocked(f.api.port.upload).mockImplementationOnce(async (...args) => {
      const asset = await upload(...args);
      const quarantined = { ...asset, state: "QUARANTINED" as const, url: null };
      f.api.assets.set(asset.id, quarantined);
      return quarantined;
    });
    await expect(f.runtime.resolve(f.capture)).rejects.toMatchObject({ code: "CANVAS_UPLOAD_QUARANTINED" });
    await expect(f.runtime.resolve(f.capture)).rejects.toMatchObject({ code: "CANVAS_UPLOAD_QUARANTINED" });
    expect(f.api.port.upload).toHaveBeenCalledTimes(1);
    expect(f.originals.get(f.original.blobId)?.uploadId).toBe(f.original.uploadId);
  });

  it("missing registered inputs without originals fail while preserving their source identity", async () => {
    const f = fixture();
    const capture: CanvasReferenceCapture = { source: { kind: "imported", assetId: "expired-owned-asset" }, original: null };
    await expect(f.runtime.resolve(capture)).rejects.toMatchObject({ code: "CANVAS_INPUT_UNAVAILABLE" });
    expect(capture.source).toEqual({ kind: "imported", assetId: "expired-owned-asset" });
    expect(f.api.port.upload).not.toHaveBeenCalled();
  });

  it("rejects a server upload identity/digest mismatch without accepting its mapping", async () => {
    const f = fixture();
    vi.mocked(f.api.port.upload).mockResolvedValueOnce(canvasAsset("wrong-asset", canvasUuid(88), { sha256: canvasDigest }));
    await expect(f.runtime.resolve(f.capture)).rejects.toMatchObject({ code: "CANVAS_UPLOAD_CONFLICT" });
    expect(f.originals.get(f.original.blobId)?.assetId).toBeNull();
  });

  it("disposal invalidates slow upload callbacks without removing original bytes", async () => {
    const f = fixture();
    const gate = deferred<void>();
    const upload = vi.mocked(f.api.port.upload).getMockImplementation()!;
    vi.mocked(f.api.port.upload).mockImplementationOnce(async (...args) => { await gate.promise; return upload(...args); });
    const pending = f.runtime.resolve(f.capture);
    const failure = expect(pending).rejects.toMatchObject({ code: "CANVAS_DELETED" });
    await vi.waitFor(() => expect(f.api.port.upload).toHaveBeenCalled());
    f.runtime.dispose();
    const writes = f.onOriginal.mock.calls.length;
    gate.resolve();
    await failure;
    expect(f.onOriginal).toHaveBeenCalledTimes(writes);
    expect(f.onAsset).not.toHaveBeenCalled();
    expect(f.originals.get(f.original.blobId)?.blob).toBe(f.original.blob);
  });

  it("checks local type and byte limits before a request", () => {
    expect(() => validateCanvasOriginal(new Blob([], { type: "image/png" }))).toThrow(CanvasContractError);
    expect(() => validateCanvasOriginal(new Blob(["x"], { type: "text/plain" }))).toThrow(expect.objectContaining({ code: "CANVAS_INVALID_INPUT" }));
    expect(() => validateCanvasOriginal(new Blob([new Uint8Array(8 * 1024 * 1024 + 1)], { type: "image/png" }))).toThrow(expect.objectContaining({ code: "CANVAS_LIMIT_EXCEEDED" }));
  });
});
