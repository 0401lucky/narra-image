// @vitest-environment node

import type { CanvasImportAsset } from "@prisma/client";
import { S3Client } from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  canvas: vi.fn(), runs: vi.fn(), jobs: vi.fn(), images: vi.fn(), assets: vi.fn(), transaction: vi.fn(),
  getUser: vi.fn(), getEnv: vi.fn(), write: vi.fn(), refund: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    canvas: { findFirst: mocks.canvas, update: mocks.write },
    canvasRun: { findMany: mocks.runs, create: mocks.write, update: mocks.write },
    generationJob: { findMany: mocks.jobs, create: mocks.write, update: mocks.write, updateMany: mocks.write },
    generationImage: { findMany: mocks.images, delete: mocks.write },
    canvasImportAsset: { findMany: mocks.assets, create: mocks.write, update: mocks.write },
    $transaction: mocks.transaction,
    $executeRaw: mocks.write,
  },
}));
vi.mock("@/lib/server/current-user", () => ({ getCurrentUserRecord: mocks.getUser }));
vi.mock("@/lib/env", () => ({ getEnv: mocks.getEnv }));
vi.mock("@/lib/generation/job-refund", () => ({ failGenerationJobAndRefund: mocks.refund, failStalePendingGenerationJobs: mocks.refund }));

import { POST } from "@/app/api/me/canvas-runtime/resolve/route";
import { CANVAS_ERRORS, CANVAS_LIMITS, type AcceptedCanvasRunBindingV1, type CanvasRuntimeResolveDtoV1 } from "@/lib/canvas/contracts";
import type { CanvasRunLookupRecord } from "@/lib/canvas/runs";
import { resolveCanvasRuntime } from "@/lib/canvas/runtime";
import { canvasStorageLocation } from "@/lib/canvas/storage";
import { canvasRuntimeResolveSchema } from "@/lib/validators";

const ownerId = "owner_test";
const canvasId = "aaaaaaaa-0000-4000-8000-000000000001";
const nodeId = "aaaaaaaa-0000-4000-8000-000000000002";
const runId = "aaaaaaaa-0000-4000-8000-000000000003";
const otherRunId = "aaaaaaaa-0000-4000-8000-000000000004";
const otherCanvasId = "aaaaaaaa-0000-4000-8000-000000000005";
const at = new Date("2026-10-29T00:00:00.000Z");
const storage = canvasStorageLocation({ endpoint: "https://storage.unit.invalid", region: "auto", bucket: "canvas-unit" });
const environment = {
  CANVAS_ENABLED: true, S3_ENDPOINT: storage.endpoint, S3_REGION: storage.region, S3_BUCKET: storage.bucket,
  S3_ACCESS_KEY_ID: "unit-test-key", S3_SECRET_ACCESS_KEY: "unit-test-secret", S3_PUBLIC_BASE_URL: "https://media.unit.invalid",
};

const tx = {
  canvas: { findFirst: mocks.canvas, update: mocks.write },
  canvasRun: { findMany: mocks.runs, create: mocks.write, update: mocks.write },
  generationJob: { findMany: mocks.jobs, create: mocks.write, update: mocks.write, updateMany: mocks.write },
  generationImage: { findMany: mocks.images, delete: mocks.write },
  canvasImportAsset: { findMany: mocks.assets, update: mocks.write, updateMany: mocks.write },
  user: { update: mocks.write, updateMany: mocks.write },
  $executeRaw: mocks.write,
  $queryRaw: mocks.write,
};

function run(overrides: Partial<CanvasRunLookupRecord> = {}): CanvasRunLookupRecord {
  return { ownerId, userId: ownerId, canvasId, nodeId, runId, state: "COMMITTED", originalJobId: "job_run", liveJobId: "job_run", rejectionCode: null, ...overrides };
}

function binding(overrides: Partial<AcceptedCanvasRunBindingV1> = {}): AcceptedCanvasRunBindingV1 {
  return { runId, nodeId, jobId: "job_run", outputsHandled: false, ...overrides };
}

function job(id = "job_run", overrides: Record<string, unknown> = {}) {
  return {
    id, userId: ownerId, status: "SUCCEEDED", generationType: "TEXT_TO_IMAGE", providerMode: "BUILT_IN",
    providerApiKeyEncrypted: "encrypted-private-provider", providerBaseUrl: "https://private-provider.invalid", providerChannelId: "channel_test",
    contractVersion: 1, handoffState: "RESOLVED", conversationId: null, cancelRequestedAt: null,
    prompt: "A quiet landscape", negativePrompt: null, model: "gpt-image-2", size: "1024x1024", count: 1,
    quality: "auto", moderation: "auto", outputFormat: "png", outputCompression: null,
    creditsSpent: 5, errorCode: null, errorMessage: null, featuredAt: null, sourceImageUrls: [],
    aspectRatio: null, durationSeconds: null, createdAt: at, updatedAt: at, startedAt: at, completedAt: at,
    images: [{ id: `output_${id}`, jobId: id, url: "https://media.invalid/canonical.png", width: 512, height: 768, storageKey: "private-result-key", createdAt: at }],
    videos: [],
    ...overrides,
  };
}

function image(id = "image_requested", overrides: Record<string, unknown> = {}) {
  return { id, jobId: "job_image_actual", url: "https://media.invalid/requested.png", width: 640, height: 480,
    job: { id: "job_image_actual", userId: ownerId, status: "SUCCEEDED" }, ...overrides };
}

function asset(id = "asset_requested", overrides: Partial<CanvasImportAsset> = {}): CanvasImportAsset {
  return {
    id, ownerId, userId: ownerId, uploadId: "aaaaaaaa-0000-4000-8000-000000000006", kind: "IMPORT",
    sha256: "a".repeat(64), byteLength: 100, mimeType: "image/png", state: "READY",
    storageLocation: storage.id, storageEndpoint: storage.endpoint, storageRegion: storage.region, storageBucket: storage.bucket,
    storageKey: "canvas-imports/registered.png", storageVersionId: null,
    uploadToken: "aaaaaaaa-0000-4000-8000-000000000007", uploadExpiresAt: at, preparationExpiresAt: null, readyAt: at,
    detachedAt: at, putOutcome: "CONFIRMED", deleteOutcome: "NOT_STARTED", deleteToken: null, deleteExpiresAt: null,
    deleteAttempts: 0, nextDeleteAt: null, deletedAt: null, lastStorageErrorCode: null,
    physicalBytesAccounted: true, needsReconciliation: false, createdAt: at, updatedAt: at,
    ...overrides,
  };
}

function request(input: unknown, headers: HeadersInit = {}) {
  return new Request("https://app.invalid/api/me/canvas-runtime/resolve", {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(input),
  });
}

async function resolve(input: Record<string, unknown> = {}) {
  return POST(request({ canvasId, ...input }));
}

async function payload(response: Response): Promise<CanvasRuntimeResolveDtoV1> {
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  return (await response.json() as { data: CanvasRuntimeResolveDtoV1 }).data;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({ id: ownerId });
  mocks.getEnv.mockReturnValue(environment);
  mocks.canvas.mockResolvedValue({ id: canvasId, deletedAt: null });
  for (const query of [mocks.runs, mocks.jobs, mocks.images, mocks.assets]) query.mockResolvedValue([]);
  mocks.transaction.mockImplementation(async (operation: (reader: typeof tx) => Promise<unknown>) => operation(tx));
  mocks.write.mockImplementation(() => { throw new Error("Runtime hydration must not write"); });
  mocks.refund.mockImplementation(() => { throw new Error("Runtime hydration must not refund"); });
  vi.spyOn(S3Client.prototype, "send").mockImplementation(() => { throw new Error("Runtime hydration must not call storage"); });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Runtime hydration must not fetch URLs"); }));
});

afterEach(() => {
  expect(mocks.write).not.toHaveBeenCalled();
  expect(mocks.refund).not.toHaveBeenCalled();
  expect(S3Client.prototype.send).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("explicit-ID canvas runtime hydration", () => {
  it("resolves only requested maps and accepted run jobs, never all canvas runs or a saved scene", async () => {
    mocks.canvas.mockResolvedValue({ id: canvasId, deletedAt: null, scene: { nodes: [{ id: "old-saved-node" }], runBindings: [] } });
    mocks.runs.mockResolvedValue([run(), run({ runId: otherRunId, originalJobId: "job_unrequested", liveJobId: "job_unrequested" })]);
    mocks.jobs.mockResolvedValue([job(), job("job_explicit"), job("job_unrequested")]);
    mocks.images.mockResolvedValue([image(), image("image_unrequested")]);
    mocks.assets.mockResolvedValue([asset(), asset("asset_unrequested")]);
    const result = await payload(await resolve({
      runBindings: [binding()], jobIds: ["job_explicit"], imageIds: ["image_requested"], assetIds: ["asset_requested"],
    }));
    expect(result.canvasId).toBe(canvasId);
    expect(Object.keys(result.runs)).toEqual([runId]);
    expect(Object.keys(result.generations).sort()).toEqual(["job_explicit", "job_run"]);
    expect(Object.keys(result.images)).toEqual(["image_requested"]);
    expect(Object.keys(result.assets)).toEqual(["asset_requested"]);
    expect(result.runs[runId]).toMatchObject({ state: "COMMITTED", origin: { canvasId, nodeId, runId }, jobId: "job_run", generation: { id: "job_run" }, unavailable: null });
    expect(result.images.image_requested).toEqual({ id: "image_requested", jobId: "job_image_actual", url: "https://media.invalid/requested.png", actualWidth: 640, actualHeight: 480, actualSize: "640x480" });
    expect(result.assets.asset_requested).toMatchObject({ state: "READY", url: "https://media.unit.invalid/canvas-imports/registered.png", readyAt: at.toISOString() });
    expect(result.missing).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/unrequested|old-saved-node|encrypted-private|private-provider|private-result|storageKey|uploadToken|ownerId|userId/);
    expect(mocks.canvas).toHaveBeenCalledWith({ where: { id: canvasId, ownerId, userId: ownerId }, select: { id: true, deletedAt: true } });
    expect(mocks.runs).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerId, userId: ownerId, canvasId, runId: { in: [runId] } } }));
    expect(mocks.jobs).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: ownerId, id: { in: ["job_explicit", "job_run"] } } }));
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead", maxWait: 3_000, timeout: 8_000 });
  });

  it("an empty selection does not query any jobs, runs, images or imports", async () => {
    expect(await payload(await resolve())).toEqual({ canvasId, generations: {}, images: {}, assets: {}, runs: {}, missing: [] });
    for (const query of [mocks.runs, mocks.jobs, mocks.images, mocks.assets]) expect(query).not.toHaveBeenCalled();
  });

  it("deduplicates bounded identities and repeated accepted bindings into one batch per model", async () => {
    mocks.runs.mockResolvedValue([run()]);
    mocks.jobs.mockResolvedValue([job()]);
    mocks.images.mockResolvedValue([image()]);
    mocks.assets.mockResolvedValue([asset()]);
    const result = await payload(await resolve({
      runIds: [runId, runId.toUpperCase()], runBindings: [binding(), binding({ outputsHandled: true })],
      jobIds: ["job_run", "job_run"], imageIds: ["image_requested", "image_requested"], assetIds: ["asset_requested", "asset_requested"],
    }));
    expect(result.missing).toEqual([]);
    expect(Object.keys(result.runs)).toEqual([runId]);
    expect(Object.keys(result.generations)).toEqual(["job_run"]);
    for (const query of [mocks.runs, mocks.jobs, mocks.images, mocks.assets]) expect(query).toHaveBeenCalledTimes(1);
    expect(mocks.images).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["image_requested"] }, job: { userId: ownerId } } }));
    expect(mocks.assets).toHaveBeenCalledWith({ where: { id: { in: ["asset_requested"] }, ownerId, userId: ownerId, kind: "IMPORT" } });
  });

  it.each([
    { nodeId: "aaaaaaaa-0000-4000-8000-000000000009" },
    { jobId: "job_fabricated" },
  ])("rejects a mismatched accepted run origin without hydrating its job or poisoning independent IDs", async (changed) => {
    mocks.runs.mockResolvedValue([run()]);
    mocks.jobs.mockResolvedValue([job("job_independent"), job()]);
    const result = await payload(await resolve({ runIds: [runId], runBindings: [binding(changed)], jobIds: ["job_independent"] }));
    expect(result.runs).toEqual({});
    expect(Object.keys(result.generations)).toEqual(["job_independent"]);
    expect(result.missing).toEqual([{ kind: "run", id: runId, code: "CANVAS_ORIGIN_MISMATCH" }]);
    expect(mocks.jobs).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: ownerId, id: { in: ["job_independent"] } } }));
  });

  it("does not let a valid duplicate binding mask a contradictory one", async () => {
    mocks.runs.mockResolvedValue([run()]);
    const result = await payload(await resolve({ runBindings: [binding(), binding({ jobId: "job_fabricated" })] }));
    expect(result.runs).toEqual({});
    expect(result.generations).toEqual({});
    expect(result.missing).toEqual([{ kind: "run", id: runId, code: "CANVAS_ORIGIN_MISMATCH" }]);
    expect(mocks.jobs).not.toHaveBeenCalled();
  });

  it.each([run({ canvasId: otherCanvasId }), run({ ownerId: "other_owner", userId: "other_owner" }), run({ userId: null })])("treats another canvas, foreign owner and detached run as missing without exposing its origin", async (row) => {
    mocks.runs.mockResolvedValue([row]);
    const result = await payload(await resolve({ runIds: [runId] }));
    expect(result.runs).toEqual({});
    expect(result.generations).toEqual({});
    expect(result.missing).toEqual([{ kind: "run", id: runId, code: "CANVAS_RUN_NOT_FOUND" }]);
    expect(mocks.jobs).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(otherCanvasId);
  });

  it("never treats PREPARING as an accepted binding but supports explicit outbox run-ID reads", async () => {
    mocks.runs.mockResolvedValue([run({ state: "PREPARING", originalJobId: null, liveJobId: null })]);
    const accepted = await payload(await resolve({ runBindings: [binding()] }));
    expect(accepted.runs).toEqual({});
    expect(accepted.missing).toEqual([{ kind: "run", id: runId, code: "CANVAS_ORIGIN_MISMATCH" }]);
    const outbox = await payload(await resolve({ runIds: [runId] }));
    expect(outbox.runs[runId]).toMatchObject({ state: "PREPARING", origin: { canvasId, nodeId, runId }, retryAfterMs: expect.any(Number) });
    expect(outbox.missing).toEqual([]);
    expect(mocks.jobs).not.toHaveBeenCalled();
  });

  it("retains committed original identity when an administrator has removed the live job", async () => {
    mocks.runs.mockResolvedValue([run({ liveJobId: null })]);
    const result = await payload(await resolve({ runBindings: [binding()], jobIds: ["job_run"] }));
    expect(result.generations).toEqual({});
    expect(result.runs[runId]).toEqual({ state: "COMMITTED", origin: { canvasId, nodeId, runId }, jobId: "job_run", generation: null, unavailable: "CANVAS_JOB_UNAVAILABLE" });
    expect(result.missing).toEqual(expect.arrayContaining([
      { kind: "job", id: "job_run", code: "CANVAS_JOB_UNAVAILABLE" },
      { kind: "run", id: runId, code: "CANVAS_JOB_UNAVAILABLE" },
    ]));
  });

  it("reports foreign and unknown identities alike while preserving independent available maps", async () => {
    mocks.jobs.mockResolvedValue([job("job_foreign", { userId: "other_owner" }), job("job_good")]);
    mocks.images.mockResolvedValue([image("image_foreign", { job: { id: "job_image_actual", userId: "other_owner", status: "SUCCEEDED" } }), image("image_good")]);
    mocks.assets.mockResolvedValue([asset("asset_foreign", { ownerId: "other_owner", userId: "other_owner" }), asset("asset_good")]);
    const result = await payload(await resolve({
      jobIds: ["job_foreign", "job_unknown", "job_good"], imageIds: ["image_foreign", "image_unknown", "image_good"],
      assetIds: ["asset_foreign", "asset_unknown", "asset_good"], runIds: [otherRunId],
    }));
    expect(Object.keys(result.generations)).toEqual(["job_good"]);
    expect(Object.keys(result.images)).toEqual(["image_good"]);
    expect(Object.keys(result.assets)).toEqual(["asset_good"]);
    expect(result.runs).toEqual({});
    expect(result.missing).toHaveLength(7);
    for (const suffix of ["foreign", "unknown"]) {
      expect(result.missing).toContainEqual({ kind: "job", id: `job_${suffix}`, code: "CANVAS_JOB_UNAVAILABLE" });
      expect(result.missing).toContainEqual({ kind: "image", id: `image_${suffix}`, code: "CANVAS_INPUT_UNAVAILABLE" });
      expect(result.missing).toContainEqual({ kind: "asset", id: `asset_${suffix}`, code: "CANVAS_INPUT_UNAVAILABLE" });
    }
  });

  it.each(["PENDING", "PROCESSING", "FAILED"])("does not make images from %s jobs ready just because a URL exists", async (status) => {
    mocks.images.mockResolvedValue([image("image_requested", { job: { id: "job_image_actual", userId: ownerId, status } })]);
    const result = await payload(await resolve({ imageIds: ["image_requested"] }));
    expect(result.images).toEqual({});
    expect(result.missing).toEqual([{ kind: "image", id: "image_requested", code: "CANVAS_INPUT_UNAVAILABLE" }]);
  });

  it("resolves the image's actual owned job and preserves canonical legacy data URLs without fetching them", async () => {
    const url = "data:image/png;base64,iVBORw0KGgo=";
    mocks.images.mockResolvedValue([image("legacy_image", { url, width: null, height: null })]);
    const result = await payload(await resolve({ imageIds: ["legacy_image"] }));
    expect(result.images.legacy_image).toEqual({ id: "legacy_image", jobId: "job_image_actual", url, actualWidth: null, actualHeight: null, actualSize: null });
    expect(result.generations).toEqual({});
    expect(mocks.jobs).not.toHaveBeenCalled();
  });

  it.each([
    { jobId: "job_fabricated" },
    { url: "" },
  ])("marks inconsistent or unavailable canonical images missing", async (changed) => {
    mocks.images.mockResolvedValue([image("image_requested", changed)]);
    expect((await payload(await resolve({ imageIds: ["image_requested"] }))).images).toEqual({});
  });

  it.each(["UPLOADING", "QUARANTINED", "DELETING", "DELETED"] as const)("returns persisted %s import state with explicit unavailability and no cleanup", async (state) => {
    mocks.assets.mockResolvedValue([asset("asset_requested", { state, uploadExpiresAt: new Date(0) })]);
    const result = await payload(await resolve({ assetIds: ["asset_requested"] }));
    expect(result.assets.asset_requested).toMatchObject({ state, url: null });
    expect(result.missing).toEqual([{ kind: "asset", id: "asset_requested", code: "CANVAS_INPUT_UNAVAILABLE" }]);
  });

  it("fails closed for a READY import at a different trusted location without falsifying its persisted state", async () => {
    mocks.getEnv.mockReturnValue({ ...environment, S3_BUCKET: "different-bucket" });
    mocks.assets.mockResolvedValue([asset()]);
    const result = await payload(await resolve({ assetIds: ["asset_requested"] }));
    expect(result.assets.asset_requested).toMatchObject({ state: "READY", url: null });
    expect(result.missing).toEqual([{ kind: "asset", id: "asset_requested", code: "CANVAS_INPUT_UNAVAILABLE" }]);
  });

  it("does not expire a still-READY import merely because its rootless grace has elapsed", async () => {
    mocks.assets.mockResolvedValue([asset("asset_requested", { detachedAt: new Date(0) })]);
    const result = await payload(await resolve({ assetIds: ["asset_requested"] }));
    expect(result.assets.asset_requested.url).toBe("https://media.unit.invalid/canvas-imports/registered.png");
    expect(result.missing).toEqual([]);
  });

  it.each([asset("asset_requested", { userId: null }), asset("asset_requested", { kind: "GENERATED" })])("does not expose detached-principal or non-import asset rows", async (row) => {
    mocks.assets.mockResolvedValue([row]);
    const result = await payload(await resolve({ assetIds: ["asset_requested"] }));
    expect(result.assets).toEqual({});
    expect(result.missing).toEqual([{ kind: "asset", id: "asset_requested", code: "CANVAS_INPUT_UNAVAILABLE" }]);
  });

  it("accepts 200 distinct typed slots and rejects a 201st before opening a transaction", async () => {
    const jobIds = Array.from({ length: CANVAS_LIMITS.runtimeIdSlots }, (_, index) => `job_${index}`);
    expect((await payload(await resolve({ jobIds }))).missing).toHaveLength(200);
    expect(mocks.jobs).toHaveBeenCalledTimes(1);
    mocks.transaction.mockClear();
    const oversized = await resolve({ jobIds, imageIds: ["job_0"] });
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toMatchObject({ code: "CANVAS_LIMIT_EXCEEDED" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each([
    { runIds: ["job_not_uuid"] },
    { canvasId: "not_uuid" },
    { jobIds: ["../foreign"] },
    { imageIds: ["https://untrusted.invalid/image.png"] },
    { assetIds: ["data:image/png;base64,invalid"] },
    { ownerId: "other_owner" },
    { imageUrls: ["https://untrusted.invalid/image.png"] },
    { runBindings: [{ ...binding(), jobId: null }] },
  ])("rejects malformed identities, null accepted jobs and URL/owner shortcuts", async (input) => {
    const response = await resolve(input);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "CANVAS_INVALID_INPUT" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("bounds canonical ID lengths with the central schema", async () => {
    const response = await resolve({ jobIds: ["a".repeat(CANVAS_LIMITS.canonicalIdCharacters + 1)] });
    expect(response.status).toBe(413);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("counts streamed body bytes without trusting absent or dishonest Content-Length", async () => {
    for (const headers of [{}, { "Content-Length": "1" }]) {
      const cancel = vi.fn();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(CANVAS_LIMITS.resolveBodyBytes));
          controller.enqueue(new Uint8Array(1));
        },
        cancel,
      });
      const response = await POST(new Request("https://app.invalid/api/me/canvas-runtime/resolve", {
        method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: stream, duplex: "half",
      } as RequestInit & { duplex: "half" }));
      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({ code: "CANVAS_LIMIT_EXCEEDED" });
      expect(cancel).toHaveBeenCalled();
    }
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each([
    [null, 404, "CANVAS_NOT_FOUND"],
    [{ id: canvasId, deletedAt: at }, 409, "CANVAS_DELETED"],
  ])("requires an owned live canvas before resolving any IDs", async (canvas, status, code) => {
    mocks.canvas.mockResolvedValue(canvas);
    const response = await resolve({ runIds: [runId], jobIds: ["job_run"], imageIds: ["image_requested"], assetIds: ["asset_requested"] });
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code });
    for (const query of [mocks.runs, mocks.jobs, mocks.images, mocks.assets]) expect(query).not.toHaveBeenCalled();
  });

  it.each([
    [null, true, 401, "CANVAS_UNAUTHENTICATED"],
    [{ id: ownerId }, false, 404, "CANVAS_DISABLED"],
  ])("authenticates and gates the feature before parsing or querying", async (user, enabled, status, code) => {
    mocks.getUser.mockResolvedValue(user);
    mocks.getEnv.mockReturnValue({ ...environment, CANVAS_ENABLED: enabled });
    const response = await POST(request({ raw: "x".repeat(CANVAS_LIMITS.resolveBodyBytes + 1) }));
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("reports a read failure without returning partially assembled maps or raw database errors", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.jobs.mockRejectedValue(new Error("postgresql://secret:private@db.invalid/private SELECT providerApiKeyEncrypted"));
    const response = await resolve({ jobIds: ["job_run"] });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: "CANVAS_INTERNAL_ERROR", error: CANVAS_ERRORS.CANVAS_INTERNAL_ERROR.userMessage });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/postgresql|private|SELECT|providerApiKeyEncrypted/);
  });

  it("waits for deferred canonical reads without writing scenes, expiring uploads or refunding jobs", async () => {
    const deferred = Promise.withResolvers<ReturnType<typeof job>[]>();
    mocks.jobs.mockReturnValue(deferred.promise);
    const pending = resolveCanvasRuntime(ownerId, canvasRuntimeResolveSchema.parse({ canvasId, jobIds: ["job_run"] }));
    await vi.waitFor(() => expect(mocks.jobs).toHaveBeenCalled());
    expect(mocks.write).not.toHaveBeenCalled();
    deferred.resolve([job("job_run", { status: "PENDING", createdAt: new Date(0), completedAt: null, images: [] })]);
    const result = await pending;
    expect(result.generations.job_run).toMatchObject({ status: "pending", creditsSpent: 5, completedAt: null });
    expect(result.images).toEqual({});
    expect(result.runs).toEqual({});
  });
});
