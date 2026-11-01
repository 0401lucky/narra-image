// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  job: vi.fn(),
  canvas: vi.fn(),
  getUser: vi.fn(),
  getEnv: vi.fn(),
  write: vi.fn(),
  refund: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    canvasRun: { findUnique: mocks.run, create: mocks.write, update: mocks.write, updateMany: mocks.write },
    generationJob: { findFirst: mocks.job, create: mocks.write, update: mocks.write, updateMany: mocks.write, delete: mocks.write },
    canvas: { findFirst: mocks.canvas, create: mocks.write, update: mocks.write },
    user: { update: mocks.write, updateMany: mocks.write },
    $executeRaw: mocks.write,
    $queryRaw: mocks.write,
    $transaction: mocks.write,
  },
}));
vi.mock("@/lib/server/current-user", () => ({ getCurrentUserRecord: mocks.getUser }));
vi.mock("@/lib/env", () => ({ getEnv: mocks.getEnv }));
vi.mock("@/lib/generation/job-refund", () => ({
  failGenerationJobAndRefund: mocks.refund,
  failStalePendingGenerationJobs: mocks.refund,
}));

import { GET } from "@/app/api/me/canvas-runs/[runId]/route";
import { CANVAS_ERRORS, CANVAS_LIMITS, type CanvasRunLookupDtoV1 } from "@/lib/canvas/contracts";
import { getCanvasRun, type CanvasRunLookupRecord } from "@/lib/canvas/runs";
import { GENERATION_ERRORS } from "@/lib/generation/contracts";

const ownerId = "owner_test";
const canvasId = "aaaaaaaa-0000-4000-8000-000000000001";
const nodeId = "aaaaaaaa-0000-4000-8000-000000000002";
const runId = "aaaaaaaa-0000-4000-8000-000000000003";
const jobId = "job_original";
const at = new Date("2026-10-29T00:00:00.000Z");

function run(overrides: Partial<CanvasRunLookupRecord> = {}): CanvasRunLookupRecord {
  return { ownerId, userId: ownerId, canvasId, nodeId, runId, state: "COMMITTED", originalJobId: jobId, liveJobId: jobId, rejectionCode: null, ...overrides };
}

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: jobId, userId: ownerId, status: "SUCCEEDED", generationType: "TEXT_TO_IMAGE", providerMode: "BUILT_IN",
    providerApiKeyEncrypted: "encrypted-provider-secret", providerBaseUrl: "https://provider-secret.invalid", providerChannelId: "channel_test",
    contractVersion: 1, handoffState: "RESOLVED", conversationId: null, cancelRequestedAt: null,
    prompt: "A quiet landscape", negativePrompt: null, model: "gpt-image-2", size: "1024x1024", count: 2,
    quality: "auto", moderation: "auto", outputFormat: "png", outputCompression: null,
    creditsSpent: 10, errorCode: null, errorMessage: null, featuredAt: null, sourceImageUrls: ["https://media.invalid/original.png"],
    aspectRatio: null, durationSeconds: null, createdAt: at, updatedAt: at, startedAt: at, completedAt: new Date(at.getTime() + 2_000),
    images: [{ id: "image_original", jobId, url: "https://media.invalid/result.png", width: 1024, height: 768, storageKey: "private-storage-key", createdAt: at }],
    videos: [],
    ...overrides,
  };
}

async function lookup(id = runId) {
  return GET(new Request(`https://app.invalid/api/me/canvas-runs/${id}`), { params: Promise.resolve({ runId: id }) });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({ id: ownerId });
  mocks.getEnv.mockReturnValue({ CANVAS_ENABLED: true });
  mocks.run.mockResolvedValue(run());
  mocks.job.mockResolvedValue(job());
  mocks.write.mockImplementation(() => { throw new Error("A lookup must not write"); });
  mocks.refund.mockImplementation(() => { throw new Error("A lookup must not refund"); });
});

afterEach(() => {
  expect(mocks.write).not.toHaveBeenCalled();
  expect(mocks.refund).not.toHaveBeenCalled();
  expect(mocks.canvas).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

describe("canvas run read-only lookup", () => {
  it("returns the original owned job with canonical fields and no ledger/provider internals", async () => {
    mocks.run.mockResolvedValue({ ...run(), intentHash: "private-intent", inputSnapshot: { apiKey: "private-input" }, preparationToken: "private-fence" });
    const response = await lookup();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await response.json();
    expect(body).toMatchObject({ data: {
      state: "COMMITTED", origin: { canvasId, nodeId, runId }, jobId, unavailable: null,
      generation: {
        id: jobId, status: "succeeded", count: 2, creditsSpent: 10, contractVersion: 1,
        prompt: "A quiet landscape", providerMode: "built_in", providerChannelId: "channel_test", outputFormat: "png",
        createdAt: at.toISOString(), completedAt: "2026-10-29T00:00:02.000Z", durationMs: 2_000,
        sourceImageUrls: ["https://media.invalid/original.png"],
        images: [{ id: "image_original", url: "https://media.invalid/result.png", actualWidth: 1024, actualHeight: 768, actualSize: "1024x768" }],
      },
    } });
    expect(Object.keys(body.data)).toEqual(["state", "origin", "jobId", "generation", "unavailable"]);
    expect(JSON.stringify(body)).not.toMatch(/private-|encrypted-provider|provider-secret|ownerId|userId|preparationToken|inputSnapshot|storageKey/);
    expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerId_runId: { ownerId, runId }, userId: ownerId } }));
    expect(mocks.job).toHaveBeenCalledWith(expect.objectContaining({ where: { id: jobId, userId: ownerId } }));
  });

  it("keeps lookup available after organization deletion without consulting its tombstone", async () => {
    mocks.canvas.mockResolvedValue({ deletedAt: at });
    const result = await getCanvasRun(ownerId, runId);
    expect(result).toMatchObject({ state: "COMMITTED", origin: { canvasId, nodeId, runId }, jobId, generation: { id: jobId }, unavailable: null });
  });

  it.each([null, run({ ownerId: "other_owner", userId: "other_owner" }), run({ userId: null })])("makes unknown/foreign/detached-principal lookups indistinguishable", async (row) => {
    mocks.run.mockResolvedValue(row);
    const response = await lookup();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "CANVAS_RUN_NOT_FOUND", error: CANVAS_ERRORS.CANVAS_RUN_NOT_FOUND.userMessage });
    expect(mocks.job).not.toHaveBeenCalled();
  });

  it("normalizes a client UUID before the owner/run unique lookup", async () => {
    expect((await lookup(runId.toUpperCase())).status).toBe(200);
    expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerId_runId: { ownerId, runId }, userId: ownerId } }));
  });

  it.each(["not-a-uuid", "job_opaque", "../secret", "a".repeat(300)])("rejects malformed run parameters without a database read", async (id) => {
    const response = await lookup(id);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "CANVAS_INVALID_INPUT" });
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("reports PREPARING with bounded retry advice, never taking over an expired lease", async () => {
    mocks.run.mockResolvedValue({ ...run({ state: "PREPARING", originalJobId: null, liveJobId: null }), preparationExpiresAt: new Date(0) });
    const response = await lookup();
    expect(response.status).toBe(202);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await response.json() as { data: Extract<CanvasRunLookupDtoV1, { state: "PREPARING" }> };
    expect(body.data).toMatchObject({ state: "PREPARING", origin: { canvasId, nodeId, runId } });
    expect(body.data.retryAfterMs).toBeGreaterThan(0);
    expect(body.data.retryAfterMs).toBeLessThanOrEqual(CANVAS_LIMITS.preparationLeaseSeconds * 1_000);
    expect(response.headers.get("Retry-After")).toBe(String(Math.ceil(body.data.retryAfterMs / 1_000)));
    expect(mocks.job).not.toHaveBeenCalled();
  });

  it.each([
    ["CANVAS_INPUT_UNAVAILABLE", "CANVAS_INPUT_UNAVAILABLE"],
    ["postgresql://secret:private@db.invalid/secret raw SQL", "CANVAS_RUN_REJECTED"],
    [null, "CANVAS_RUN_REJECTED"],
  ])("returns a safe REJECTED code without retry or leaked preparation details", async (stored, expected) => {
    mocks.run.mockResolvedValue(run({ state: "REJECTED", originalJobId: null, liveJobId: null, rejectionCode: stored }));
    const response = await lookup();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { state: "REJECTED", origin: { canvasId, nodeId, runId }, code: expected } });
    expect(mocks.job).not.toHaveBeenCalled();
  });

  it.each(["missing-fk", "missing-row", "wrong-owner", "wrong-job", "changed-fk"])("retains the original ID when the committed live job is unavailable: %s", async (reason) => {
    if (reason === "missing-fk") mocks.run.mockResolvedValue(run({ liveJobId: null }));
    if (reason === "changed-fk") mocks.run.mockResolvedValue(run({ liveJobId: "job_replacement" }));
    mocks.job.mockResolvedValue(reason === "wrong-owner" ? job({ userId: "other_owner" })
      : reason === "wrong-job" ? job({ id: "job_replacement" }) : null);
    const response = await lookup();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: {
      state: "COMMITTED", origin: { canvasId, nodeId, runId }, jobId, generation: null, unavailable: "CANVAS_JOB_UNAVAILABLE",
    } });
    if (reason === "missing-fk" || reason === "changed-fk") expect(mocks.job).not.toHaveBeenCalled();
  });

  it("does not refresh or refund stale pending jobs while recovering an acknowledgement", async () => {
    mocks.job.mockResolvedValue(job({ status: "PENDING", createdAt: new Date(0), completedAt: null, images: [] }));
    const response = await lookup();
    expect(await response.json()).toMatchObject({ data: { generation: { id: jobId, status: "pending", creditsSpent: 10, completedAt: null } } });
  });

  it("maps known worker errors to public contract text instead of stored provider bodies", async () => {
    mocks.job.mockResolvedValue(job({ status: "FAILED", errorCode: "HANDOFF_UNKNOWN", errorMessage: "Authorization: Bearer provider-secret raw upstream body", images: [] }));
    const response = await lookup();
    const body = await response.json();
    expect(body.data.generation).toMatchObject({ status: "failed", errorCode: "HANDOFF_UNKNOWN", errorMessage: GENERATION_ERRORS.HANDOFF_UNKNOWN.userMessage });
    expect(JSON.stringify(body)).not.toMatch(/provider-secret|upstream body|Authorization/);
  });

  it("does not echo unknown error codes or raw legacy error messages", async () => {
    mocks.job.mockResolvedValue(job({ status: "FAILED", errorCode: "secret-upstream-token", errorMessage: "raw SQL select private from secret", images: [] }));
    const response = await lookup();
    const body = await response.json();
    expect(body.data.generation.errorCode).toBeNull();
    expect(typeof body.data.generation.errorMessage).toBe("string");
    expect(JSON.stringify(body)).not.toMatch(/secret|raw SQL|select private/);
  });

  it.each([
    [null, true, 401, "CANVAS_UNAUTHENTICATED"],
    [{ id: ownerId }, false, 404, "CANVAS_DISABLED"],
  ])("requires an authenticated owner and enabled feature before lookup", async (user, enabled, status, code) => {
    mocks.getUser.mockResolvedValue(user);
    mocks.getEnv.mockReturnValue({ CANVAS_ENABLED: enabled });
    const response = await lookup();
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code });
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("redacts database failures and never fabricates a replacement job", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.run.mockRejectedValue(new Error("postgresql://secret:private@db.invalid/raw SELECT providerApiKeyEncrypted"));
    const response = await lookup();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: "CANVAS_INTERNAL_ERROR", error: CANVAS_ERRORS.CANVAS_INTERNAL_ERROR.userMessage });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/postgresql|private|SELECT|providerApiKeyEncrypted/);
    expect(mocks.job).not.toHaveBeenCalled();
  });

  it("returns a deferred lookup only to its captured owner and does no work before the record arrives", async () => {
    const deferred = Promise.withResolvers<CanvasRunLookupRecord>();
    mocks.run.mockReturnValue(deferred.promise);
    const pending = lookup();
    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalled());
    expect(mocks.job).not.toHaveBeenCalled();
    mocks.getUser.mockResolvedValue({ id: "other_owner" });
    deferred.resolve(run());
    const response = await pending;
    expect(await response.json()).toMatchObject({ data: { origin: { canvasId, nodeId, runId }, generation: { id: jobId } } });
    expect(mocks.job).toHaveBeenCalledWith(expect.objectContaining({ where: { id: jobId, userId: ownerId } }));
  });
});
