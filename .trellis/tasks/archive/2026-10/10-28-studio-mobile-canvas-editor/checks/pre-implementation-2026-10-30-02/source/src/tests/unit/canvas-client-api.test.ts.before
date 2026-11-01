import { afterEach, describe, expect, it, vi } from "vitest";

import { CANVAS_LIMITS, CANVAS_RUN_REQUEST_HEADERS, encodeCanvasRunRequestV1, type CanvasRunLookupDtoV1, type CanvasRunProjectionV1 } from "@/lib/canvas/contracts";
import { createCanvasClientApi, CanvasTransportError } from "@/components/create/canvas/client-api";
import { canvasRuntimeRequests, emptyCanvasScene } from "@/components/create/canvas/commands";

import { canvasAsset, canvasDate, canvasDefaults, canvasDigest, canvasJob, canvasUuid, deferred, metadata } from "./helpers/canvas-controller-fixtures";

const signal = new AbortController().signal;
const id = canvasUuid(1);
const origin = { canvasId: id, nodeId: canvasUuid(2), runId: canvasUuid(3) };
const projection: CanvasRunProjectionV1 = { ...origin, prompt: { sourceNodeId: canvasUuid(4), text: "frozen prompt" }, params: canvasDefaults, references: [] };
function response(data: unknown, status = 200) { return Response.json({ data }, { status }); }
function fixture() {
  const fetcher = vi.fn<typeof fetch>();
  return { fetcher, api: createCanvasClientApi(fetcher) };
}
afterEach(() => { vi.useRealTimers(); });

describe("canvas client transport", () => {
  it("unwraps actual metadata CRUD wrappers and sends revisioned explicit commands", async () => {
    const { api, fetcher } = fixture();
    const cloud = metadata(id);
    fetcher.mockResolvedValueOnce(response({ canvases: [cloud], nextCursor: null }))
      .mockResolvedValueOnce(response({ canvas: cloud, scene: null }))
      .mockResolvedValueOnce(response({ canvas: cloud }))
      .mockResolvedValueOnce(response({ canvas: { ...cloud, title: "Renamed", revision: 1 } }))
      .mockResolvedValueOnce(response({ id, deleted: true, revision: 2 }));
    expect(await api.list(null, signal)).toMatchObject({ canvases: [cloud] });
    expect(await api.read(id, signal)).toEqual({ canvas: cloud, scene: null });
    expect(await api.create(id, "Canvas", signal)).toEqual(cloud);
    expect(await api.rename(id, "Renamed", 0, signal)).toMatchObject({ title: "Renamed", revision: 1 });
    expect(await api.delete(id, 1, signal)).toEqual({ id, deleted: true, revision: 2 });
    expect(fetcher.mock.calls.map(([path]) => path)).toEqual(["/api/me/canvases", `/api/me/canvases/${id}`, "/api/me/canvases", `/api/me/canvases/${id}`, `/api/me/canvases/${id}`]);
    expect(JSON.parse(String(fetcher.mock.calls[3][1]?.body))).toEqual({ title: "Renamed", expectedRevision: 0 });
    expect(JSON.parse(String(fetcher.mock.calls[4][1]?.body))).toEqual({ expectedRevision: 1 });
    for (const [, options] of fetcher.mock.calls) expect(options).toMatchObject({ cache: "no-store", credentials: "same-origin", signal: expect.any(AbortSignal) });
  });

  it("consumes the direct snapshot receipt, not an invented nested receipt wrapper", async () => {
    const { api, fetcher } = fixture();
    const input = { expectedRevision: 0, saveId: canvasUuid(9), scene: { ...emptyCanvasScene(), nodes: [] } };
    const receipt = { canvas: metadata(id, { revision: 1, hasSavedSnapshot: true, lastSavedAt: canvasDate }), saveId: input.saveId, acknowledgedRevision: 1, sceneHash: canvasDigest };
    fetcher.mockResolvedValueOnce(response(receipt)).mockResolvedValueOnce(response({ receipt }));
    expect(await api.save(id, input, signal)).toEqual(receipt);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual(input);
    await expect(api.save(id, input, signal)).rejects.toBeInstanceOf(CanvasTransportError);
  });

  it("uses the exact multipart upload contract and recognizes active 202/upload lookup", async () => {
    const { api, fetcher } = fixture();
    const uploadId = canvasUuid(10);
    const asset = canvasAsset("asset-one", uploadId, { state: "UPLOADING", url: null, readyAt: null });
    fetcher.mockResolvedValueOnce(response({ asset }, 202)).mockResolvedValueOnce(response({ asset: { ...asset, state: "READY", url: "https://images.invalid/a.png", readyAt: canvasDate } }));
    const blob = new Blob(["png"], { type: "image/png" });
    expect(await api.upload({ uploadId, blob, fileName: "input.png", sha256: canvasDigest }, signal)).toEqual(asset);
    const body = fetcher.mock.calls[0][1]?.body as FormData;
    expect([...body.keys()].sort()).toEqual(["byteLength", "file", "mimeType", "sha256", "uploadId"]);
    expect(body.get("byteLength")).toBe("3");
    expect(body.get("mimeType")).toBe("image/png");
    expect(body.get("sha256")).toBe(canvasDigest);
    expect((body.get("file") as File).name).toBe("input.png");
    expect(fetcher.mock.calls[0][1]?.headers).toBeUndefined();
    expect(await api.uploadStatus(uploadId, signal)).toMatchObject({ state: "READY" });
    expect(fetcher.mock.calls[1][0]).toBe(`/api/me/canvas-assets/uploads/${uploadId}`);
  });

  it("uses the sole shared encoder and opt-in headers, without chat or draft transport fields", async () => {
    const { api, fetcher } = fixture();
    const job = canvasJob("job-one");
    const accepted = { generation: job, canvasRun: { ...origin, jobId: job.id } };
    fetcher.mockResolvedValueOnce(response(accepted));
    const fields = { turnstileToken: "request-only-value" };
    expect(await api.submit(projection, fields, signal)).toEqual(accepted);
    expect(fetcher.mock.calls[0][0]).toBe("/api/generate");
    const init = fetcher.mock.calls[0][1]!;
    expect(init.headers).toEqual(CANVAS_RUN_REQUEST_HEADERS);
    const body = JSON.parse(String(init.body));
    expect(body).toEqual(encodeCanvasRunRequestV1(projection, fields));
    expect(body).not.toHaveProperty("prompt");
    expect(body).not.toHaveProperty("conversationId");
    expect(body).not.toHaveProperty("replaceGenerationId");
    expect(body.canvasRun).not.toHaveProperty("params");
  });

  it.each([
    [202, { state: "PREPARING", origin, retryAfterMs: 1000 }],
    [409, { state: "REJECTED", origin, code: "CANVAS_RUN_REJECTED" }],
    [410, { state: "COMMITTED", origin, jobId: "removed-job", generation: null, unavailable: "CANVAS_JOB_UNAVAILABLE" }],
  ] as const)("preserves lookup semantics for generate status %s", async (status, lookup) => {
    const { api, fetcher } = fixture();
    fetcher.mockResolvedValueOnce(response(lookup, status));
    expect(await api.submit(projection, {}, signal)).toEqual(lookup);
  });

  it("reads a direct run lookup without triggering generation transport", async () => {
    const { api, fetcher } = fixture();
    const lookup: CanvasRunLookupDtoV1 = { state: "COMMITTED", origin, jobId: "job-one", generation: canvasJob("job-one"), unavailable: null };
    fetcher.mockResolvedValueOnce(response(lookup));
    expect(await api.lookup(origin.runId, signal)).toEqual(lookup);
    expect(fetcher.mock.calls).toHaveLength(1);
    expect(fetcher.mock.calls[0][0]).toBe(`/api/me/canvas-runs/${origin.runId}`);
    expect(fetcher.mock.calls[0][1]?.method).toBeUndefined();
  });

  it.each([
    { error: "private provider details should never reach UI", code: "unrecognized" },
    { data: { generation: { ...canvasJob("job-one"), images: [null] }, canvasRun: { ...origin, jobId: "job-one" } } },
    { data: { state: "COMMITTED", origin, jobId: "other-job", generation: canvasJob("job-one"), unavailable: null } },
  ])("rejects malformed/unknown replies using a safe public message", async (body) => {
    const { api, fetcher } = fixture();
    fetcher.mockResolvedValueOnce(Response.json(body, { status: "error" in body ? 500 : 200 }));
    await expect(api.submit(projection, {}, signal)).rejects.toBeInstanceOf(CanvasTransportError);
    fetcher.mockResolvedValueOnce(new Response("<html>private upstream trace</html>", { status: 502 }));
    await expect(api.lookup(origin.runId, signal)).rejects.toMatchObject({ message: new CanvasTransportError().message });
  });

  it("uses fixture-owned safe errors rather than the server's raw error body", async () => {
    const { api, fetcher } = fixture();
    fetcher.mockResolvedValueOnce(Response.json({ code: "CANVAS_REVISION_CONFLICT", error: "private database details" }, { status: 409 }));
    await expect(api.rename(id, "test", 0, signal)).rejects.toMatchObject({ code: "CANVAS_REVISION_CONFLICT" });
    fetcher.mockRejectedValueOnce(new Error("secret network details"));
    await expect(api.read(id, signal)).rejects.toMatchObject({ message: new CanvasTransportError().message });
  });

  it.each(["fetch", "json"] as const)("bounds an abort-ignoring %s read and ignores its late completion", async (phase) => {
    vi.useFakeTimers();
    const { api, fetcher } = fixture();
    const lateFetch = deferred<Response>();
    const lateJson = deferred<unknown>();
    const body = { data: { canvas: metadata(id), scene: null } };
    const reply = Response.json(body);
    if (phase === "fetch") fetcher.mockReturnValueOnce(lateFetch.promise);
    else {
      vi.spyOn(reply, "json").mockReturnValueOnce(lateJson.promise);
      fetcher.mockResolvedValueOnce(reply);
    }
    const settled = vi.fn();
    void api.read(id, signal).then(settled, settled);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(settled).toHaveBeenCalledWith(expect.any(CanvasTransportError));
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(signal.aborted).toBe(false);
    lateFetch.resolve(reply);
    lateJson.resolve(body);
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["fetch", "json"] as const)("owner abort releases a pending %s read without waiting for its timeout", async (phase) => {
    vi.useFakeTimers();
    const { api, fetcher } = fixture();
    const owner = new AbortController();
    const lateFetch = deferred<Response>();
    const lateJson = deferred<unknown>();
    const body = { data: { canvas: metadata(id), scene: null } };
    const reply = Response.json(body);
    if (phase === "fetch") fetcher.mockReturnValueOnce(lateFetch.promise);
    else {
      vi.spyOn(reply, "json").mockReturnValueOnce(lateJson.promise);
      fetcher.mockResolvedValueOnce(reply);
    }
    const settled = vi.fn();
    void api.read(id, owner.signal).then(settled, settled);
    await vi.advanceTimersByTimeAsync(0);
    owner.abort(new Error("private owner context"));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toHaveBeenCalledWith(expect.any(CanvasTransportError));
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    lateFetch.resolve(reply);
    lateJson.resolve(body);
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toHaveBeenCalledTimes(1);
    await expect(api.read(id, owner.signal)).rejects.toBeInstanceOf(CanvasTransportError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(["upload", "submit"] as const)("gives %s its longer bounded deadline without retrying it", async (operation) => {
    vi.useFakeTimers();
    const { api, fetcher } = fixture();
    fetcher.mockReturnValueOnce(new Promise(() => {}));
    const settled = vi.fn();
    const request = operation === "upload"
      ? api.upload({ uploadId: canvasUuid(10), blob: new Blob(["png"], { type: "image/png" }), fileName: "input.png", sha256: canvasDigest }, signal)
      : api.submit(projection, {}, signal);
    void request.then(settled, settled);
    const timeoutMs = operation === "upload" ? 90_000 : 120_000;
    await vi.advanceTimersByTimeAsync(timeoutMs - 1);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toHaveBeenCalledWith(expect.any(CanvasTransportError));
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("removes successful request timers and owner listeners before returning its DTO", async () => {
    vi.useFakeTimers();
    const { api, fetcher } = fixture();
    const owner = new AbortController();
    fetcher.mockResolvedValueOnce(response({ canvas: metadata(id), scene: null }));
    expect(await api.read(id, owner.signal)).toEqual({ canvas: metadata(id), scene: null });
    const requestSignal = fetcher.mock.calls[0][1]!.signal!;
    owner.abort();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(requestSignal.aborted).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("chunks only scene-bound canonical IDs into <=200-slot runtime requests", () => {
    const scene = emptyCanvasScene();
    for (let index = 1; index <= 199; index += 1) scene.nodes.push({ kind: "result", id: `result:image-${index}`, imageId: `image-${index}`, jobId: `job-${index}`, runId: canvasUuid(1000 + index), position: { x: index, y: 0 } });
    const requests = canvasRuntimeRequests(id, scene);
    expect(requests).toHaveLength(3);
    for (const request of requests) expect(request.runBindings.length + request.runIds.length + request.imageIds.length + request.jobIds.length + request.assetIds.length).toBeLessThanOrEqual(CANVAS_LIMITS.runtimeIdSlots);
    expect(requests.flatMap((request) => request.imageIds)).toEqual(scene.nodes.flatMap((node) => node.kind === "result" ? [node.imageId] : []));
    expect(requests.flatMap((request) => request.jobIds)).toHaveLength(199);
    expect(requests.flatMap((request) => request.runIds)).toHaveLength(199);
  });

  it("decodes explicit runtime maps and validates the requested slot budget before sending", async () => {
    const { api, fetcher } = fixture();
    const request = { canvasId: id, runBindings: [], runIds: [], jobIds: [], imageIds: [], assetIds: ["asset-one"] };
    const result = { canvasId: id, assets: { "asset-one": canvasAsset("asset-one", canvasUuid(40)) }, images: {}, runs: {}, generations: {}, missing: [] };
    fetcher.mockResolvedValueOnce(response(result));
    expect(await api.resolve(request, signal)).toEqual(result);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual(request);
    await expect(api.resolve({ ...request, assetIds: Array.from({ length: 201 }, (_, index) => `asset-${index}`) }, signal)).rejects.toBeInstanceOf(CanvasTransportError);
    expect(fetcher.mock.calls).toHaveLength(1);
  });

  it("rejects malformed runtime image geometry rather than claiming a ready image", async () => {
    const { api, fetcher } = fixture();
    fetcher.mockResolvedValueOnce(response({ canvasId: id, assets: {}, runs: {}, generations: {}, missing: [], images: {
      image: { id: "image", jobId: "job-one", url: "https://images.invalid/a.png", actualWidth: "bad", actualHeight: null, actualSize: null },
    } }));
    await expect(api.resolve({ canvasId: id, runBindings: [], runIds: [], jobIds: [], imageIds: ["image"], assetIds: [] }, signal)).rejects.toBeInstanceOf(CanvasTransportError);
  });
});
