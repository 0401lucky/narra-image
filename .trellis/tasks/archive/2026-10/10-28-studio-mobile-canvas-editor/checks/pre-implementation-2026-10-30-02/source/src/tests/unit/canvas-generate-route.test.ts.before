// @vitest-environment node

import type { Canvas, CanvasImportAsset } from "@prisma/client";
import { S3Client } from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(), requireUser: vi.fn(), env: vi.fn(), turnstile: vi.fn(), moderation: vi.fn(),
  provider: vi.fn(), providerById: vi.fn(), decrypt: vi.fn(), encrypt: vi.fn(), savedProvider: vi.fn(), publicUrl: vi.fn(), persist: vi.fn(), refund: vi.fn(),
  transaction: vi.fn(), findRun: vi.fn(), findJob: vi.fn(), readAssets: vi.fn(), readImages: vi.fn(),
  createJob: vi.fn(), charge: vi.fn(), conversation: vi.fn(), detachJob: vi.fn(), updateConversation: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: {
  $transaction: mocks.transaction,
  canvasRun: { findUnique: mocks.findRun }, generationJob: { findFirst: mocks.findJob },
  canvasImportAsset: { findMany: mocks.readAssets }, generationImage: { findMany: mocks.readImages },
  conversation: { findFirst: mocks.conversation }, savedProviderConfig: { findUnique: mocks.savedProvider },
} }));
vi.mock("@/lib/server/current-user", () => ({ getCurrentUserRecord: mocks.getUser, requireCurrentUserRecord: mocks.requireUser }));
vi.mock("@/lib/env", () => ({ getEnv: mocks.env }));
vi.mock("@/lib/auth/turnstile", () => ({ requireTurnstile: mocks.turnstile }));
vi.mock("@/lib/moderation/check", () => ({ checkGenerationInput: mocks.moderation }));
vi.mock("@/lib/providers/built-in-provider", () => ({
  getGenerationChannelForModel: mocks.provider, getGenerationChannelById: mocks.providerById,
  generationChannelModelSnapshot: (channel: { defaultModel: string; models: string[] }) => [channel.defaultModel, ...channel.models],
}));
vi.mock("@/lib/providers/provider-secret", () => ({ decryptProviderSecret: mocks.decrypt, encryptProviderSecret: mocks.encrypt }));
vi.mock("@/lib/server/safe-remote-url", () => ({ assertPublicHttpUrl: mocks.publicUrl }));
vi.mock("@/lib/storage/persist-generated-image", () => ({ persistGeneratedImage: mocks.persist }));
vi.mock("@/lib/generation/job-refund", () => ({ failGenerationJobAndRefund: mocks.refund }));

import { POST } from "@/app/api/generate/route";
import {
  CANVAS_RUN_REQUEST_HEADERS, CANVAS_LIMITS, CanvasContractError, canonicalCanvasJson,
  type CanvasErrorCode, type CanvasRunWireV1,
} from "@/lib/canvas/contracts";
import type { CanvasRunLookupRecord } from "@/lib/canvas/runs";
import { GenerationContractError, GENERATION_ERRORS } from "@/lib/generation/contracts";
import { canvasRunSchema } from "@/lib/validators";
import { canvasAssetRow, canvasPng, canvasRow, canvasStorageTestEnv, canvasTestIds } from "./helpers/canvas-api-fixtures";
import { canvasGuardSqlState, canvasRawGuardError } from "./helpers/canvas-sql-error";

const uuid = (value: number) => `aaaaaaaa-0000-4000-8000-${String(value).padStart(12, "0")}`;
const at = new Date("2026-10-29T00:00:00.000Z");
const ownerId = "owner";
const runId = uuid(1);
const nodeId = uuid(2);

function wire(): CanvasRunWireV1 {
  return canvasRunSchema.parse({
    canvasId: canvasTestIds.canvas, nodeId, runId,
    input: { prompt: { sourceNodeId: uuid(3), text: "frozen landscape" }, references: [] },
    parameters: { model: "gpt-image-2", generationType: "text_to_image", count: 2, size: "16:9", quality: "high", moderation: "low", outputFormat: "webp", outputCompression: 83 },
  });
}

function generationRow(data: Record<string, unknown> = {}) {
  return {
    count: 1, creditsSpent: 5, contractVersion: 1, conversationId: null,
    providerMode: "BUILT_IN", providerApiKeyEncrypted: null, providerBaseUrl: null, providerChannelId: "channel_test", providerRemember: false,
    providerModels: ["gpt-image-2"], providerLabel: null, generationType: "TEXT_TO_IMAGE", model: "gpt-image-2", prompt: "frozen landscape",
    negativePrompt: null, seed: null, size: "1024x1024", quality: "auto", moderation: "auto", outputFormat: "png", outputCompression: null,
    startedAt: null, completedAt: null, cancelRequestedAt: null, featuredAt: null, errorCode: null, errorMessage: null,
    aspectRatio: null, durationSeconds: null, handoffState: "NOT_STARTED", workerManaged: true,
    ...data,
    id: typeof data.id === "string" ? data.id : "job_existing",
    userId: typeof data.userId === "string" ? data.userId : ownerId,
    status: typeof data.status === "string" ? data.status : "PENDING",
    sourceImageUrls: Array.isArray(data.sourceImageUrls) ? data.sourceImageUrls.filter((url): url is string => typeof url === "string") : [],
    images: [], videos: [], createdAt: at, updatedAt: at,
  };
}

type FakeRun = CanvasRunLookupRecord & {
  id: string; intentHash: string; credentialFingerprint: string | null; inputSnapshot: CanvasRunWireV1;
  preparationToken: string; preparationExpiresAt: Date;
};
type FakeImage = { id: string; jobId: string; url: string; job: { id: string; userId: string; status: string } };
type FakeState = {
  canvas: Canvas; credits: number; runs: Map<string, FakeRun>; jobs: Map<string, ReturnType<typeof generationRow>>;
  assets: Map<string, CanvasImportAsset>; images: Map<string, FakeImage>; roots: Array<{ runId: string; assetId: string; jobId: string; ordinal: number }>;
  sequence: number;
};
let state: FakeState;
let now: number;
let queue: Promise<void>;
let events: string[];
let loseJobAck: boolean;
let loseReservationAck: boolean;
let failRunReads: boolean;
let rejectUnavailable: boolean;
let commitError: CanvasErrorCode | null;
let commitFailures: unknown[];
let expireDuringInputLock: boolean;
let rawReservationFailure: boolean;
type AssetQuery = { where: { id: { in: string[] }; ownerId: string; userId: string; state?: string } };
type ImageQuery = { where: { id: { in: string[] }; job: { userId: string; status?: string } } };

function assetRead(snapshot: FakeState, query: AssetQuery) {
  events.push("read-assets");
  return [...snapshot.assets.values()].filter((asset) => query.where.id.in.includes(asset.id) && asset.ownerId === query.where.ownerId && asset.userId === query.where.userId && (!query.where.state || asset.state === query.where.state));
}
function imageRead(snapshot: FakeState, query: ImageQuery) {
  events.push("read-images");
  return [...snapshot.images.values()].filter((image) => query.where.id.in.includes(image.id) && image.job.userId === query.where.job.userId && (!query.where.job.status || image.job.status === query.where.job.status));
}
function nodeBusy(snapshot: FakeState, run: CanvasRunWireV1) {
  return [...snapshot.runs.values()].some((other) => other.canvasId === run.canvasId && other.nodeId === run.nodeId && other.runId !== run.runId
    && ((other.state === "PREPARING" && other.preparationExpiresAt.getTime() > now)
      || (other.state === "COMMITTED" && ["PENDING", "PROCESSING"].includes(snapshot.jobs.get(other.liveJobId ?? "")?.status ?? ""))));
}

// This fake models SQL outcomes needed by route orchestration, not PostgreSQL
// trigger/catalog conformance. Each callback has isolated rollbackable state.
function client(snapshot: FakeState) {
  return {
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const sql = strings.join("?");
      if (sql.includes("canvas_reserve_run")) {
        events.push("reserve");
        if (rawReservationFailure) throw new Error("ambiguous adapter error");
        const [owner, canvasId, requestedNode, requestedRun, hash, json, fingerprint] = values;
        const run = JSON.parse(String(json)) as CanvasRunWireV1;
        const key = `${owner}:${requestedRun}`;
        const previous = snapshot.runs.get(key);
        if (previous) {
          if (previous.canvasId !== canvasId || previous.nodeId !== requestedNode || previous.intentHash !== hash
            || previous.credentialFingerprint !== fingerprint || canonicalCanvasJson(previous.inputSnapshot) !== canonicalCanvasJson(run)) throw new CanvasContractError("CANVAS_RUN_CONFLICT");
          if (previous.state !== "PREPARING") return [{ ...previous, replayed: true }];
        }
        if (snapshot.canvas.id !== canvasId || snapshot.canvas.ownerId !== owner || snapshot.canvas.userId !== owner || snapshot.canvas.deletedAt) throw canvasRawGuardError("CANVAS_NOT_FOUND");
        if (previous && previous.preparationExpiresAt.getTime() > now) return [{ ...previous, replayed: true }];
        if (nodeBusy(snapshot, run)) throw new CanvasContractError("CANVAS_NODE_BUSY");
        const reserved: FakeRun = {
          ownerId: String(owner), userId: String(owner), canvasId: String(canvasId), nodeId: String(requestedNode), runId: String(requestedRun),
          id: previous?.id ?? `ledger_${++snapshot.sequence}`, state: "PREPARING", originalJobId: null, liveJobId: null, rejectionCode: null,
          intentHash: String(hash), credentialFingerprint: typeof fingerprint === "string" ? fingerprint : null,
          inputSnapshot: run, preparationToken: uuid(100 + ++snapshot.sequence), preparationExpiresAt: new Date(now + CANVAS_LIMITS.preparationLeaseSeconds * 1_000),
        };
        snapshot.runs.set(key, reserved);
        return [{ ...reserved, replayed: false }];
      }
      if (sql.includes('FROM "Canvas"') && sql.includes("FOR UPDATE")) {
        events.push("lock-canvas");
        return snapshot.canvas.id === values[0] && snapshot.canvas.ownerId === values[1] ? [snapshot.canvas] : [];
      }
      if (sql.includes('FROM "CanvasRun"') && sql.includes("FOR UPDATE")) {
        events.push("lock-run");
        const row = snapshot.runs.get(`${values[0]}:${values.at(-1)}`);
        return row && row.userId === values[1] ? [row] : [];
      }
      if (sql.includes('FROM "GenerationImage"') && sql.includes("FOR SHARE")) {
        events.push("lock-images");
        if (expireDuringInputLock) now += CANVAS_LIMITS.preparationLeaseSeconds * 1_000 + 1;
        return [...snapshot.images.values()].map(({ id }) => ({ id }));
      }
      if (sql.includes(" AS active")) {
        events.push("lease-check");
        const row = snapshot.runs.get(`${values[0]}:${values[1]}`);
        return [{ active: !!row && row.state === "PREPARING" && row.preparationToken === values[2] && row.preparationExpiresAt.getTime() > now }];
      }
      if (sql.includes("canvas_commit_run")) {
        events.push("commit-run");
        if (commitFailures.length) throw commitFailures.shift();
        if (commitError) throw new CanvasContractError(commitError);
        const row = snapshot.runs.get(`${values[0]}:${values[1]}`);
        if (!row || row.state !== "PREPARING" || row.preparationToken !== values[2] || row.preparationExpiresAt.getTime() <= now) throw new CanvasContractError("CANVAS_LEASE_LOST");
        if (nodeBusy(snapshot, row.inputSnapshot)) throw new CanvasContractError("CANVAS_NODE_BUSY");
        const jobId = String(values[3]);
        if (snapshot.jobs.get(jobId)?.userId !== row.ownerId) throw new CanvasContractError("CANVAS_ORIGIN_MISMATCH");
        row.state = "COMMITTED"; row.originalJobId = jobId; row.liveJobId = jobId;
        for (const reference of row.inputSnapshot.input.references) {
          if (reference.kind === "imported") snapshot.roots.push({ runId: row.id, jobId, assetId: reference.assetId, ordinal: reference.ordinal });
        }
        return [{ jobId }];
      }
      if (sql.includes("canvas_reject_run")) {
        events.push("reject-run");
        if (rejectUnavailable) return [{ rejected: false }];
        const row = snapshot.runs.get(`${values[0]}:${values[1]}`);
        const rejected = !!row && row.state === "PREPARING" && row.preparationToken === values[2] && row.preparationExpiresAt.getTime() > now;
        if (row && rejected) { row.state = "REJECTED"; row.rejectionCode = String(values[3]); }
        return [{ rejected }];
      }
      throw new Error(`Unexpected fake SQL: ${sql}`);
    },
    async $executeRaw(strings: TemplateStringsArray) {
      if (!strings.join("?").includes("canvas_lock_assets")) throw new Error("Unexpected fake execute");
      events.push("lock-assets");
      if (expireDuringInputLock) now += CANVAS_LIMITS.preparationLeaseSeconds * 1_000 + 1;
      return 1;
    },
    canvasImportAsset: { findMany: async (query: AssetQuery) => assetRead(snapshot, query) },
    generationImage: { findMany: async (query: ImageQuery) => imageRead(snapshot, query) },
    generationJob: {
      create: async (input: { data: Record<string, unknown> }) => mocks.createJob(snapshot, input),
      updateMany: mocks.detachJob,
      count: async () => 0,
    },
    user: { updateMany: async (input: { where: { id: string; credits: { gte: number } }; data: { credits: { decrement: number } } }) => mocks.charge(snapshot, input) },
    conversation: { update: mocks.updateConversation },
  };
}

function generationRequest(run: CanvasRunWireV1 = wire(), transient: Record<string, unknown> = {}) {
  return new Request("https://app.invalid/api/generate", { method: "POST", headers: CANVAS_RUN_REQUEST_HEADERS, body: JSON.stringify({ canvasRun: run, ...transient }) });
}
function ledger() { return state.runs.get(`${ownerId}:${runId}`)!; }

beforeEach(() => {
  vi.resetAllMocks();
  now = at.getTime(); queue = Promise.resolve(); events = [];
  loseJobAck = false; loseReservationAck = false; failRunReads = false; rejectUnavailable = false; commitError = null;
  commitFailures = []; expireDuringInputLock = false; rawReservationFailure = false;
  state = { canvas: canvasRow(), credits: 50, runs: new Map(), jobs: new Map(), assets: new Map(), images: new Map(), roots: [], sequence: 0 };
  mocks.env.mockReturnValue({ ...canvasStorageTestEnv, AUTH_SECRET: "unit-test-intent-key", CANVAS_ENABLED: true, BUILTIN_PROVIDER_CREDIT_COST: 5, BUILTIN_PROVIDER_VIDEO_CREDIT_COST: 20, WORKER_CONTRACTS_V1_ENABLED: true });
  mocks.getUser.mockImplementation(async () => ({ id: ownerId, credits: state.credits }));
  mocks.requireUser.mockImplementation(async () => ({ id: ownerId, credits: state.credits }));
  mocks.turnstile.mockImplementation(async () => { events.push("captcha"); });
  mocks.moderation.mockImplementation(async () => { events.push("moderation"); return { allowed: true }; });
  const channel = { id: "channel_test", defaultModel: "gpt-image-2", models: [], creditCost: 5, videoCreditCost: 20, name: "Unit test", apiKey: "provider-secret", baseUrl: "https://provider.invalid/v1" };
  mocks.provider.mockImplementation(async () => { events.push("provider"); return channel; });
  mocks.providerById.mockImplementation(async () => { events.push("provider"); return channel; });
  mocks.savedProvider.mockResolvedValue(null);
  mocks.encrypt.mockResolvedValue("encrypted-provider-value"); mocks.decrypt.mockResolvedValue("runtime-provider-value");
  mocks.publicUrl.mockImplementation(async (raw: string) => {
    events.push("url-check");
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.hostname === "127.0.0.1") throw new Error("Blocked URL");
    return url;
  });
  mocks.persist.mockResolvedValue("https://media.invalid/legacy-upload.png");
  mocks.refund.mockImplementation(() => { throw new Error("Canvas must never refund"); });
  mocks.readAssets.mockImplementation(async (query: AssetQuery) => assetRead(state, query));
  mocks.readImages.mockImplementation(async (query: ImageQuery) => imageRead(state, query));
  mocks.findRun.mockImplementation(async (query: { where: { ownerId_runId: { ownerId: string; runId: string }; userId: string } }) => {
    events.push("lookup-run");
    if (failRunReads) throw new Error("Temporary read failure");
    const row = state.runs.get(`${query.where.ownerId_runId.ownerId}:${query.where.ownerId_runId.runId}`);
    return row?.userId === query.where.userId ? structuredClone(row) : null;
  });
  mocks.findJob.mockImplementation(async (query: { where: { id: string; userId: string } }) => {
    events.push("lookup-job");
    const row = state.jobs.get(query.where.id);
    return row?.userId === query.where.userId ? structuredClone(row) : null;
  });
  mocks.createJob.mockImplementation(async (snapshot: FakeState, input: { data: Record<string, unknown> }) => {
    events.push("create-job");
    const job = generationRow({ ...input.data, id: `job_${++snapshot.sequence}` });
    snapshot.jobs.set(job.id, job);
    return job;
  });
  mocks.charge.mockImplementation(async (snapshot: FakeState, input: { where: { credits: { gte: number } }; data: { credits: { decrement: number } } }) => {
    events.push("charge");
    if (snapshot.credits < input.where.credits.gte) return { count: 0 };
    snapshot.credits -= input.data.credits.decrement;
    return { count: 1 };
  });
  mocks.transaction.mockImplementation(async (operation: (tx: ReturnType<typeof client>) => Promise<unknown>) => {
    const previous = queue;
    const gate = Promise.withResolvers<void>(); queue = gate.promise;
    await previous;
    const beforeJobs = state.jobs.size; const beforeRuns = state.runs.size;
    const snapshot = structuredClone(state);
    try {
      const result = await operation(client(snapshot));
      state = snapshot;
      if (loseJobAck && state.jobs.size > beforeJobs) { loseJobAck = false; throw new Error("Connection lost after COMMIT"); }
      if (loseReservationAck && state.runs.size > beforeRuns) { loseReservationAck = false; throw new Error("Reservation commit acknowledgement lost"); }
      return result;
    } finally { gate.resolve(); }
  });
  mocks.conversation.mockResolvedValue({ id: "conversation_owned", generations: [] });
  mocks.detachJob.mockResolvedValue({ count: 1 }); mocks.updateConversation.mockResolvedValue({});
  vi.spyOn(S3Client.prototype, "send").mockImplementation(() => { throw new Error("Unexpected object-store access"); });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network access"); }));
});

afterEach(() => {
  expect(mocks.refund).not.toHaveBeenCalled();
  expect(S3Client.prototype.send).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("canvas run integration with the existing generation route", () => {
  it("creates the ordinary worker job and debit once, with SQL binding in the same transaction", async () => {
    const response = await POST(generationRequest(wire(), { turnstileToken: "runtime-captcha" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.data).toMatchObject({
      canvasRun: { canvasId: canvasTestIds.canvas, nodeId, runId, jobId: ledger().originalJobId },
      generation: { id: ledger().originalJobId, status: "pending", count: 2, creditsSpent: 5, providerMode: "built_in", prompt: "frozen landscape", size: "1824x1024", outputFormat: "webp", outputCompression: 83, quality: "high", moderation: "low" },
    });
    expect(ledger().state).toBe("COMMITTED"); expect(state.jobs.size).toBe(1); expect(state.credits).toBe(45);
    expect([...state.jobs.values()][0]).toMatchObject({ workerManaged: true, handoffState: "NOT_STARTED", contractVersion: 1, providerModels: ["gpt-image-2"], providerChannelId: "channel_test", conversationId: null });
    expect(events.indexOf("reserve")).toBeLessThan(events.indexOf("captcha"));
    expect(events.indexOf("lock-canvas")).toBeLessThan(events.indexOf("lock-run"));
    expect(events.indexOf("lease-check")).toBeLessThan(events.indexOf("create-job"));
    expect(events.indexOf("charge")).toBeLessThan(events.indexOf("commit-run"));
    expect(mocks.persist).not.toHaveBeenCalled(); expect(mocks.conversation).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toMatch(/provider-secret|runtime-captcha|intentHash|credentialFingerprint|preparationToken|providerApiKeyEncrypted/);
  });

  it("replays before used CAPTCHA, current balance, providers, media and deleted organization", async () => {
    const run = wire();
    run.parameters = { ...run.parameters, count: 1, generationType: "image_to_image" };
    run.input.references = [{ sourceNodeId: uuid(4), ordinal: 1, kind: "imported", assetId: "asset-one" }];
    state.assets.set("asset-one", canvasAssetRow());
    const first = await POST(generationRequest(run, { turnstileToken: "already-used" }));
    const original = await first.json();
    state.credits = 0; state.canvas.deletedAt = at; state.assets.clear();
    events = [];
    mocks.turnstile.mockRejectedValue(new Error("Used CAPTCHA")); mocks.provider.mockRejectedValue(new Error("Provider removed"));
    const response = await POST(generationRequest(run, { turnstileToken: "already-used" }));
    expect(response.status).toBe(200);
    expect((await response.json()).data.canvasRun).toEqual(original.data.canvasRun);
    expect(state.jobs.size).toBe(1); expect(state.credits).toBe(0); expect(state.roots).toHaveLength(1);
    expect(events).toEqual(["reserve", "lookup-run", "lookup-job"]);
  });

  it("recovers a committed replay when queued deletion wins the reservation's canvas lock", async () => {
    const preparation = Promise.withResolvers<void>();
    mocks.turnstile.mockReturnValueOnce(preparation.promise);
    const first = POST(generationRequest());
    await vi.waitFor(() => expect(mocks.turnstile).toHaveBeenCalledTimes(1));
    const reservationStarted = Promise.withResolvers<void>();
    const reservationFinished = Promise.withResolvers<void>();
    mocks.transaction.mockImplementationOnce(async () => {
      // The SQL reserve saw PREPARING before waiting behind enqueue and Delete.
      expect(ledger().state).toBe("PREPARING");
      reservationStarted.resolve();
      await reservationFinished.promise;
      throw canvasRawGuardError("CANVAS_NOT_FOUND");
    });
    const replay = POST(generationRequest());
    await reservationStarted.promise;
    preparation.resolve();
    const accepted = await first;
    expect(accepted.status).toBe(200);
    state.canvas.deletedAt = at;
    reservationFinished.resolve();
    const response = await replay;
    expect(response.status).toBe(200);
    expect((await response.json()).data.canvasRun).toEqual((await accepted.json()).data.canvasRun);
    expect(state.jobs.size).toBe(1); expect(state.credits).toBe(45);
    expect(mocks.turnstile).toHaveBeenCalledTimes(1); expect(mocks.createJob).toHaveBeenCalledTimes(1);
    expect(events).not.toContain("reject-run");
  });

  it("does not turn a known missing canvas and absent run into uncertain acceptance", async () => {
    state.canvas.deletedAt = at;
    const response = await POST(generationRequest());
    expect(response.status).toBe(404); expect(await response.json()).toMatchObject({ code: "CANVAS_NOT_FOUND" });
    expect(state.runs.size).toBe(0); expect(state.jobs.size).toBe(0); expect(state.credits).toBe(50);
    expect(mocks.turnstile).not.toHaveBeenCalled();
  });

  it("checks intent before recovering a stale missing-canvas reservation error", async () => {
    await POST(generationRequest());
    mocks.transaction.mockRejectedValueOnce(new CanvasContractError("CANVAS_NOT_FOUND"));
    const changed = wire(); changed.parameters.count = 3;
    const response = await POST(generationRequest(changed));
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: "CANVAS_RUN_CONFLICT" });
    expect(state.jobs.size).toBe(1); expect(state.credits).toBe(45); expect(mocks.turnstile).toHaveBeenCalledTimes(1);
  });

  it("keeps a stale reservation error uncertain when committed lookup is unavailable", async () => {
    await POST(generationRequest());
    failRunReads = true;
    mocks.transaction.mockRejectedValueOnce(new CanvasContractError("CANVAS_NOT_FOUND"));
    const response = await POST(generationRequest());
    expect(response.status).toBe(202); expect(await response.json()).toMatchObject({ data: { state: "PREPARING", origin: { runId } } });
    expect(ledger().state).toBe("COMMITTED"); expect(state.jobs.size).toBe(1); expect(state.credits).toBe(45);
    expect(mocks.turnstile).toHaveBeenCalledTimes(1); expect(events).not.toContain("reject-run");
  });

  it("returns explicit original-job unavailability on replay instead of creating another job", async () => {
    await POST(generationRequest());
    const originalJobId = ledger().originalJobId;
    state.jobs.clear(); ledger().liveJobId = null; state.canvas.deletedAt = at;
    const response = await POST(generationRequest());
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ data: { state: "COMMITTED", jobId: originalJobId, generation: null, unavailable: "CANVAS_JOB_UNAVAILABLE" } });
    expect(state.jobs.size).toBe(0); expect(state.credits).toBe(45); expect(mocks.createJob).toHaveBeenCalledTimes(1);
  });

  it("conflicts on edited intent but not on a different CAPTCHA", async () => {
    await POST(generationRequest(wire(), { turnstileToken: "old" }));
    const changed = wire(); changed.input.prompt.text = "edited later";
    const conflict = await POST(generationRequest(changed));
    expect(conflict.status).toBe(409); expect(await conflict.json()).toMatchObject({ code: "CANVAS_RUN_CONFLICT" });
    expect((await POST(generationRequest(wire(), { turnstileToken: "new" }))).status).toBe(200);
    expect(state.jobs.size).toBe(1); expect(state.credits).toBe(45); expect(mocks.turnstile).toHaveBeenCalledTimes(1);
  });

  it("deduplicates simultaneous same-run requests while the first preparation is outstanding", async () => {
    const wait = Promise.withResolvers<void>(); mocks.turnstile.mockReturnValue(wait.promise);
    const first = POST(generationRequest());
    await vi.waitFor(() => expect(mocks.turnstile).toHaveBeenCalled());
    const second = await POST(generationRequest());
    expect(second.status).toBe(202); expect(second.headers.get("Retry-After")).toBe("1");
    expect(await second.json()).toMatchObject({ data: { state: "PREPARING", origin: { runId, nodeId, canvasId: canvasTestIds.canvas } } });
    expect(state.jobs.size).toBe(0);
    wait.resolve(); expect((await first).status).toBe(200);
    expect(state.jobs.size).toBe(1); expect(state.credits).toBe(45); expect(mocks.turnstile).toHaveBeenCalledTimes(1);
  });

  it("admits only one run per busy node and permits an explicit new run after the prior job settles", async () => {
    await POST(generationRequest());
    const next = wire(); next.runId = uuid(9);
    expect((await POST(generationRequest(next))).status).toBe(409);
    expect(state.jobs.size).toBe(1); expect(state.credits).toBe(45);
    state.jobs.get(ledger().originalJobId!)!.status = "SUCCEEDED";
    expect((await POST(generationRequest(next))).status).toBe(200);
    expect(state.jobs.size).toBe(2); expect(state.credits).toBe(40);
  });

  it("recovers a committed transaction whose acknowledgement was lost without compensation or duplicate debit", async () => {
    loseJobAck = true;
    const response = await POST(generationRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { canvasRun: { jobId: ledger().originalJobId }, generation: { id: ledger().originalJobId } } });
    expect((await POST(generationRequest())).status).toBe(200);
    expect(state.jobs.size).toBe(1); expect(state.credits).toBe(45); expect(mocks.createJob).toHaveBeenCalledTimes(1);
    expect(events).not.toContain("reject-run");
  });

  it("recovers a response serialization failure after commit without entering the legacy refund catch", async () => {
    const serializers = await import("@/lib/canvas/runs");
    vi.spyOn(serializers, "serializeCanvasGeneration").mockImplementationOnce(() => { throw new Error("Response interrupted after commit"); });
    const response = await POST(generationRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { generation: { id: ledger().originalJobId }, canvasRun: { runId } } });
    expect(state.jobs.size).toBe(1); expect(state.credits).toBe(45); expect(events).not.toContain("reject-run");
  });

  it("keeps a failed unconfirmed transaction uncertain without automatically attempting another job", async () => {
    mocks.createJob.mockRejectedValueOnce(new Error("Connection closed during enqueue"));
    const response = await POST(generationRequest());
    expect(response.status).toBe(202); expect(await response.json()).toMatchObject({ data: { state: "PREPARING", origin: { runId } } });
    expect(state.jobs.size).toBe(0); expect(state.credits).toBe(50); expect(mocks.createJob).toHaveBeenCalledTimes(1);
    expect(events).not.toContain("reject-run");
  });

  it.each([
    { label: "Prisma write conflict", error: { code: "P2034" } },
    { label: "raw serialization failure", error: { code: "P2010", meta: { code: "40001", message: "rolled back" } } },
    { label: "adapter deadlock", error: { name: "DriverAdapterError", cause: { originalCode: "40P01", originalMessage: "rolled back" } } },
  ])("retries a known $label with only one durable job and debit", async ({ error }) => {
    commitFailures.push(error);
    const response = await POST(generationRequest());
    expect(response.status).toBe(200); expect(ledger().state).toBe("COMMITTED");
    expect(state.jobs.size).toBe(1); expect(state.credits).toBe(45);
    expect(mocks.createJob).toHaveBeenCalledTimes(2); expect(mocks.charge).toHaveBeenCalledTimes(2);
    expect(mocks.turnstile).toHaveBeenCalledTimes(1); expect(events).not.toContain("reject-run");
  });

  it("stops known-rollback retries at three attempts and leaves no job or debit", async () => {
    commitFailures = Array.from({ length: 3 }, () => ({ code: "40001" }));
    const response = await POST(generationRequest());
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: "CANVAS_RUN_REJECTED" });
    expect(ledger().state).toBe("REJECTED"); expect(state.jobs.size).toBe(0); expect(state.credits).toBe(50); expect(state.roots).toEqual([]);
    expect(mocks.createJob).toHaveBeenCalledTimes(3); expect(mocks.charge).toHaveBeenCalledTimes(3);
    expect(mocks.turnstile).toHaveBeenCalledTimes(1);
  });

  it("does not retry or reject an unknown commit error after a tentative debit", async () => {
    commitFailures.push({ name: "DriverAdapterError", cause: { originalCode: "08006", originalMessage: "connection lost" } });
    const response = await POST(generationRequest());
    expect(response.status).toBe(202); expect(await response.json()).toMatchObject({ data: { state: "PREPARING" } });
    expect(state.jobs.size).toBe(0); expect(state.credits).toBe(50); expect(ledger().state).toBe("PREPARING");
    expect(mocks.createJob).toHaveBeenCalledTimes(1); expect(mocks.charge).toHaveBeenCalledTimes(1);
    expect(events).not.toContain("reject-run");
  });

  it("returns read-only 202 after ambiguous commit plus failed lookup, then same-key replay recovers", async () => {
    loseJobAck = true; failRunReads = true;
    const response = await POST(generationRequest());
    expect(response.status).toBe(202); expect(await response.json()).toMatchObject({ data: { state: "PREPARING", origin: { runId } } });
    expect(ledger().state).toBe("COMMITTED"); expect(state.credits).toBe(45); expect(events).not.toContain("reject-run");
    failRunReads = false;
    expect((await POST(generationRequest())).status).toBe(200);
    expect(state.jobs.size).toBe(1); expect(mocks.turnstile).toHaveBeenCalledTimes(1);
  });

  it("does not continue fresh execution after losing the preparation acknowledgement", async () => {
    loseReservationAck = true;
    const response = await POST(generationRequest());
    expect(response.status).toBe(202); expect(ledger().state).toBe("PREPARING");
    expect(state.jobs.size).toBe(0); expect(state.credits).toBe(50); expect(mocks.turnstile).not.toHaveBeenCalled();
  });

  it("recovery still checks frozen intent when a reservation adapter failure is ambiguous", async () => {
    await POST(generationRequest()); rawReservationFailure = true;
    const changed = wire(); changed.input.prompt.text = "different intent";
    const response = await POST(generationRequest(changed));
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: "CANVAS_RUN_CONFLICT" });
    expect(state.jobs.size).toBe(1); expect(state.credits).toBe(45);
  });

  it.each(["CANVAS_NODE_BUSY", "CANVAS_LEASE_LOST"] as const)("rolls back tentative job and debit on final %s", async (code) => {
    commitError = code;
    const response = await POST(generationRequest());
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code });
    expect(state.jobs.size).toBe(0); expect(state.credits).toBe(50); expect(state.roots).toEqual([]); expect(ledger().state).toBe("REJECTED");
  });

  it.each(["raw", "adapter"] as const)("recognizes the SQL guard's %s rollback after tentative debit without uncertain acceptance", async (shape) => {
    commitFailures.push(shape === "raw" ? canvasRawGuardError("CANVAS_LEASE_LOST") : {
      name: "DriverAdapterError", cause: { originalCode: canvasGuardSqlState, originalMessage: "CANVAS_LEASE_LOST" },
    });
    const response = await POST(generationRequest());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "CANVAS_LEASE_LOST" });
    expect(ledger().state).toBe("REJECTED");
    expect(state.jobs.size).toBe(0); expect(state.credits).toBe(50); expect(state.roots).toEqual([]);
    expect(mocks.createJob).toHaveBeenCalledTimes(1); expect(mocks.charge).toHaveBeenCalledTimes(1);
    expect(mocks.refund).not.toHaveBeenCalled();
  });

  it("checks lease validity against the database clock before attempting job creation", async () => {
    mocks.turnstile.mockImplementation(async () => { now += 121_000; });
    const response = await POST(generationRequest());
    expect(response.status).toBe(202); expect(await response.json()).toMatchObject({ data: { state: "PREPARING" } });
    expect(state.jobs.size).toBe(0); expect(state.credits).toBe(50); expect(mocks.createJob).not.toHaveBeenCalled();
  });

  it.each(["imported", "result"] as const)("rechecks the database lease after blocking on %s input locks", async (kind) => {
    const run = wire(); run.parameters = { ...run.parameters, count: 1, generationType: "image_to_image" };
    run.input.references = [kind === "imported"
      ? { sourceNodeId: uuid(4), ordinal: 1, kind, assetId: "asset-one" }
      : { sourceNodeId: "result:image_a", ordinal: 1, kind, imageId: "image_a", jobId: "job_a" }];
    state.assets.set("asset-one", canvasAssetRow());
    state.images.set("image_a", { id: "image_a", jobId: "job_a", url: "https://media.invalid/source.png", job: { id: "job_a", userId: ownerId, status: "SUCCEEDED" } });
    expireDuringInputLock = true;
    const response = await POST(generationRequest(run));
    expect(response.status).toBe(202); expect(await response.json()).toMatchObject({ data: { state: "PREPARING" } });
    expect(state.jobs.size).toBe(0); expect(state.credits).toBe(50); expect(state.roots).toEqual([]);
    expect(mocks.createJob).not.toHaveBeenCalled(); expect(mocks.charge).not.toHaveBeenCalled();
  });

  it("rolls back a tentative job and debit when the lease expires during final enqueue", async () => {
    mocks.charge.mockImplementationOnce(async (snapshot: FakeState) => {
      snapshot.credits -= 5;
      now += CANVAS_LIMITS.preparationLeaseSeconds * 1_000 + 1;
      return { count: 1 };
    });
    const response = await POST(generationRequest());
    expect(response.status).toBe(202); expect(await response.json()).toMatchObject({ data: { state: "PREPARING" } });
    expect(state.jobs.size).toBe(0); expect(state.credits).toBe(50); expect(state.roots).toEqual([]);
    expect(mocks.createJob).toHaveBeenCalledTimes(1); expect(mocks.charge).toHaveBeenCalledTimes(1);
  });

  it("expired takeover fences the slow original request and creates only the replacement's one job", async () => {
    const wait = Promise.withResolvers<void>(); mocks.turnstile.mockReturnValueOnce(wait.promise);
    const slow = POST(generationRequest()); await vi.waitFor(() => expect(mocks.turnstile).toHaveBeenCalledTimes(1));
    const originalFence = ledger().preparationToken; now += 121_000;
    expect((await POST(generationRequest())).status).toBe(200);
    expect(ledger().preparationToken).not.toBe(originalFence);
    wait.resolve(); expect((await slow).status).toBe(200);
    expect(state.jobs.size).toBe(1); expect(state.credits).toBe(45); expect(mocks.createJob).toHaveBeenCalledTimes(1);
  });

  it("a deletion winning before enqueue blocks attachment without cancellation or charging", async () => {
    mocks.turnstile.mockImplementation(async () => { state.canvas.deletedAt = at; });
    const response = await POST(generationRequest());
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: "CANVAS_DELETED" });
    expect(state.jobs.size).toBe(0); expect(state.credits).toBe(50); expect(state.canvas.deletedAt).toEqual(at);
  });

  it("uses ordered READY originals and owned canonical images without uploading generated copies", async () => {
    const run = wire(); run.parameters = { ...run.parameters, count: 1, generationType: "image_to_image" };
    run.input.references = [
      { sourceNodeId: uuid(5), ordinal: 3, kind: "imported", assetId: "asset-z" },
      { sourceNodeId: "result:legacy-image", ordinal: 2, kind: "result", imageId: "legacy-image", jobId: "legacy-job" },
      { sourceNodeId: uuid(4), ordinal: 1, kind: "imported", assetId: "asset-a" },
    ];
    state.assets.set("asset-a", canvasAssetRow({ id: "asset-a", storageKey: "canvas-imports/a.png" }));
    state.assets.set("asset-z", canvasAssetRow({ id: "asset-z", storageKey: "canvas-imports/z.png" }));
    const dataUrl = `data:image/png;base64,${canvasPng().toString("base64")}`;
    state.images.set("legacy-image", { id: "legacy-image", jobId: "legacy-job", url: dataUrl, job: { id: "legacy-job", userId: ownerId, status: "SUCCEEDED" } });
    const response = await POST(generationRequest(run)); expect(response.status).toBe(200);
    expect([...state.jobs.values()][0]).toMatchObject({ generationType: "IMAGE_TO_IMAGE", count: 1, negativePrompt: null, seed: null,
      sourceImageUrls: ["https://cdn.invalid/media/canvas-imports/a.png", dataUrl, "https://cdn.invalid/media/canvas-imports/z.png"] });
    expect(state.roots.map((root) => [root.assetId, root.ordinal])).toEqual([["asset-a", 1], ["asset-z", 3]]);
    expect(state.roots.every((root) => root.runId === ledger().id && root.runId !== runId)).toBe(true);
    expect(mocks.persist).not.toHaveBeenCalled(); expect(mocks.publicUrl).not.toHaveBeenCalledWith(dataUrl);
    expect(events.indexOf("lock-assets")).toBeLessThan(events.indexOf("lock-images"));
    expect(events.indexOf("lock-images")).toBeLessThan(events.indexOf("create-job"));
  });

  it.each(["foreign", "pending", "wrong-job", "unsafe-url"])("rejects %s canonical result input without a job or debit", async (scenario) => {
    const run = wire(); run.parameters = { ...run.parameters, count: 1, generationType: "image_to_image" };
    run.input.references = [{ sourceNodeId: "result:image_a", ordinal: 1, kind: "result", imageId: "image_a", jobId: "job_a" }];
    state.images.set("image_a", { id: "image_a", jobId: scenario === "wrong-job" ? "different-job" : "job_a", url: scenario === "unsafe-url" ? "blob:unusable" : "https://media.invalid/source.png", job: { id: "job_a", userId: scenario === "foreign" ? "other" : ownerId, status: scenario === "pending" ? "PENDING" : "SUCCEEDED" } });
    const response = await POST(generationRequest(run));
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: "CANVAS_INPUT_UNAVAILABLE" });
    expect(state.jobs.size).toBe(0); expect(state.credits).toBe(50);
  });

  it.each(["foreign", "deleted", "wrong-location", "too-large"])("blocks %s imports before charging", async (scenario) => {
    const run = wire(); run.parameters = { ...run.parameters, count: 1, generationType: "image_to_image" };
    const count = scenario === "too-large" ? 5 : 1;
    run.input.references = Array.from({ length: count }, (_, index) => ({ sourceNodeId: uuid(20 + index), ordinal: index + 1, kind: "imported", assetId: `asset_${index}` }));
    for (let index = 0; index < count; index++) state.assets.set(`asset_${index}`, canvasAssetRow({ id: `asset_${index}`, storageKey: `canvas-imports/${index}.png`, byteLength: CANVAS_LIMITS.importBytes, ownerId: scenario === "foreign" ? "other" : ownerId, state: scenario === "deleted" ? "DELETED" : "READY" }));
    if (scenario === "wrong-location") mocks.env.mockReturnValue({ ...mocks.env(), S3_BUCKET: "different-bucket" });
    const response = await POST(generationRequest(run));
    expect(response.status).toBe(scenario === "too-large" ? 413 : 409);
    expect(state.jobs.size).toBe(0); expect(state.credits).toBe(50);
  });

  it("accepts exactly 32 MiB of known imports without claiming to precheck an unknown-size result", async () => {
    const run = wire(); run.parameters = { ...run.parameters, count: 1, generationType: "image_to_image" };
    run.input.references = Array.from({ length: 4 }, (_, index) => ({ sourceNodeId: uuid(20 + index), ordinal: index + 1, kind: "imported", assetId: `asset_${index}` }));
    for (let index = 0; index < 4; index++) state.assets.set(`asset_${index}`, canvasAssetRow({ id: `asset_${index}`, storageKey: `canvas-imports/${index}.png`, byteLength: CANVAS_LIMITS.importBytes }));
    run.input.references.push({ sourceNodeId: "result:image_a", ordinal: 5, kind: "result", imageId: "image_a", jobId: "job_a" });
    state.images.set("image_a", { id: "image_a", jobId: "job_a", url: "https://media.invalid/unknown-size.png", job: { id: "job_a", userId: ownerId, status: "SUCCEEDED" } });
    const response = await POST(generationRequest(run));
    expect(response.status).toBe(200); expect(state.jobs.size).toBe(1); expect(state.credits).toBe(45);
    expect([...state.jobs.values()][0].sourceImageUrls).toHaveLength(5); expect(state.roots).toHaveLength(4);
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it("rechecks inputs under locks and rejects a canonical URL changed after preflight", async () => {
    const run = wire(); run.parameters = { ...run.parameters, count: 1, generationType: "image_to_image" };
    run.input.references = [{ sourceNodeId: "result:image_a", ordinal: 1, kind: "result", imageId: "image_a", jobId: "job_a" }];
    state.images.set("image_a", { id: "image_a", jobId: "job_a", url: "https://media.invalid/before.png", job: { id: "job_a", userId: ownerId, status: "SUCCEEDED" } });
    mocks.publicUrl.mockImplementation(async () => { state.images.get("image_a")!.url = "https://media.invalid/changed.png"; });
    const response = await POST(generationRequest(run));
    expect(response.status).toBe(409); expect(state.jobs.size).toBe(0); expect(state.credits).toBe(50); expect(mocks.createJob).not.toHaveBeenCalled();
  });

  it("retains the captured request when the caller edits its local object during preparation", async () => {
    const run = wire(); const request = generationRequest(run); const wait = Promise.withResolvers<void>(); mocks.turnstile.mockReturnValue(wait.promise);
    const pending = POST(request); await vi.waitFor(() => expect(mocks.turnstile).toHaveBeenCalled());
    run.input.prompt.text = "new draft text"; run.parameters.count = 1;
    wait.resolve(); expect((await pending).status).toBe(200);
    expect([...state.jobs.values()][0]).toMatchObject({ prompt: "frozen landscape", count: 2 });
    expect(ledger().inputSnapshot.input.prompt.text).toBe("frozen landscape");
  });

  it("hashes transient custom credentials without storing them in the run snapshot", async () => {
    const run = wire(); run.parameters.providerMode = "custom";
    const customProvider = { apiKey: "runtime-api-secret", baseUrl: "https://custom.invalid/v1", model: "gpt-image-2", remember: false };
    const first = await POST(generationRequest(run, { customProvider, turnstileToken: "private-captcha" }));
    expect(first.status).toBe(200); expect(state.credits).toBe(50); expect(mocks.charge).not.toHaveBeenCalled();
    expect(ledger().credentialFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(ledger())).not.toMatch(/runtime-api-secret|private-captcha|custom\.invalid|apiKey/);
    expect([...state.jobs.values()][0]).toMatchObject({ providerMode: "CUSTOM", providerApiKeyEncrypted: "encrypted-provider-value", providerBaseUrl: customProvider.baseUrl, providerRemember: false });
    expect((await POST(generationRequest(run, { customProvider: { ...customProvider, apiKey: "changed-secret" } }))).status).toBe(409);
    expect((await POST(generationRequest(run, { customProvider, turnstileToken: "different" }))).status).toBe(200);
    expect(mocks.encrypt).toHaveBeenCalledTimes(1);
  });

  it("reuses saved provider configuration for fresh runs but not committed replay", async () => {
    const run = wire(); run.parameters.providerMode = "custom";
    mocks.savedProvider.mockResolvedValue({ apiKeyEncrypted: "saved-ciphertext", baseUrl: "https://saved.invalid/v1", label: "Saved", model: "gpt-image-2", models: [] });
    expect((await POST(generationRequest(run))).status).toBe(200);
    mocks.savedProvider.mockResolvedValue(null); mocks.decrypt.mockRejectedValue(new Error("No longer decryptable"));
    expect((await POST(generationRequest(run))).status).toBe(200);
    expect(mocks.savedProvider).toHaveBeenCalledTimes(1); expect(mocks.decrypt).toHaveBeenCalledTimes(1); expect(state.jobs.size).toBe(1);
  });

  it("rejects moderation failures without billing, and does not rerun rejected preparation", async () => {
    mocks.moderation.mockResolvedValue({ allowed: false, message: "Moderation blocked" });
    const response = await POST(generationRequest());
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: "Moderation blocked" });
    expect(state.credits).toBe(50); expect(state.jobs.size).toBe(0); expect(ledger().state).toBe("REJECTED");
    expect((await POST(generationRequest())).status).toBe(409); expect(mocks.moderation).toHaveBeenCalledTimes(1);
  });

  it("does not reach provider resolution or billing after a fresh CAPTCHA failure", async () => {
    mocks.turnstile.mockRejectedValue(new Error("CAPTCHA failed with secret response text"));
    const response = await POST(generationRequest());
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: "CANVAS_RUN_REJECTED" });
    expect(ledger().state).toBe("REJECTED"); expect(state.jobs.size).toBe(0); expect(state.credits).toBe(50);
    expect(mocks.moderation).not.toHaveBeenCalled(); expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("preserves the initial insufficient-credit response without creating a job", async () => {
    state.credits = 0;
    const response = await POST(generationRequest());
    expect(response.status).toBe(402); expect(ledger().state).toBe("REJECTED"); expect(state.jobs.size).toBe(0);
    expect(mocks.createJob).not.toHaveBeenCalled(); expect(mocks.charge).not.toHaveBeenCalled();
  });

  it("still requires a saved or supplied provider for a fresh custom run", async () => {
    const run = wire(); run.parameters.providerMode = "custom";
    const response = await POST(generationRequest(run));
    expect(response.status).toBe(400); expect(ledger().state).toBe("REJECTED"); expect(state.jobs.size).toBe(0); expect(state.credits).toBe(50);
    expect(mocks.encrypt).not.toHaveBeenCalled();
  });

  it("preserves custom-provider URL and model restrictions before encryption or enqueue", async () => {
    const run = wire(); run.parameters.providerMode = "custom";
    const invalidUrl = await POST(generationRequest(run, { customProvider: { apiKey: "runtime-only", baseUrl: "http://127.0.0.1/private", model: "gpt-image-2" } }));
    expect(invalidUrl.status).toBe(409); expect(mocks.encrypt).not.toHaveBeenCalled(); expect(state.jobs.size).toBe(0);
    run.runId = uuid(12);
    const invalidModel = await POST(generationRequest(run, { customProvider: { apiKey: "runtime-only", baseUrl: "https://custom.invalid/v1", model: "different-model" } }));
    expect(invalidModel.status).toBe(400); expect(await invalidModel.json()).toMatchObject({ code: "MODEL_NOT_SUPPORTED_BY_CHANNEL" });
    expect(mocks.encrypt).not.toHaveBeenCalled(); expect(state.jobs.size).toBe(0); expect(state.credits).toBe(50);
  });

  it("returns safe provider contract errors without raw upstream details", async () => {
    mocks.provider.mockRejectedValue(new GenerationContractError("CHANNEL_INACTIVE", { message: "secret raw provider body" }));
    const response = await POST(generationRequest());
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ code: "CHANNEL_INACTIVE", error: GENERATION_ERRORS.CHANNEL_INACTIVE.userMessage });
    expect(ledger().state).toBe("REJECTED"); expect(state.jobs.size).toBe(0); expect(state.credits).toBe(50);
  });

  it("conditional debit failure rolls back the normal job after the initial credit check", async () => {
    mocks.turnstile.mockImplementation(async () => { state.credits = 0; });
    const response = await POST(generationRequest());
    expect(response.status).toBe(402); expect(state.jobs.size).toBe(0); expect(state.credits).toBe(0); expect(ledger().state).toBe("REJECTED");
  });

  it("failed rejection acknowledgement stays honestly uncertain instead of reporting definite failure", async () => {
    rejectUnavailable = true; mocks.turnstile.mockRejectedValue(new Error("CAPTCHA failed"));
    const response = await POST(generationRequest());
    expect(response.status).toBe(202); expect(await response.json()).toMatchObject({ data: { state: "PREPARING", origin: { runId } } });
    expect(state.jobs.size).toBe(0); expect(state.credits).toBe(50); expect(ledger().state).toBe("PREPARING");
  });

  it.each([
    [null, true, 401, "CANVAS_UNAUTHENTICATED"],
    [{ id: ownerId, credits: 50 }, false, 404, "CANVAS_DISABLED"],
  ])("requires owner authentication and the opt-in feature before any reservation", async (user, enabled, status, code) => {
    mocks.getUser.mockResolvedValue(user); mocks.env.mockReturnValue({ ...mocks.env(), CANVAS_ENABLED: enabled });
    const response = await POST(generationRequest());
    expect(response.status).toBe(status); expect(await response.json()).toMatchObject({ code });
    expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.turnstile).not.toHaveBeenCalled();
  });

  it("never creates an owned run for a foreign canvas", async () => {
    state.canvas.ownerId = "other"; state.canvas.userId = "other";
    const response = await POST(generationRequest());
    expect(response.status).toBe(404); expect(state.runs.size).toBe(0); expect(state.jobs.size).toBe(0); expect(mocks.turnstile).not.toHaveBeenCalled();
  });

  it("leaves ordinary legacy generation, conversation replacement and feature-off behavior intact", async () => {
    mocks.env.mockReturnValue({ ...mocks.env(), CANVAS_ENABLED: false, WORKER_CONTRACTS_V1_ENABLED: false });
    const response = await POST(new Request("https://app.invalid/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      model: "gpt-image-2", prompt: "legacy prompt", count: 1, conversationId: "conversation_owned", replaceGenerationId: "failed_legacy_job",
    }) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { generation: { prompt: "legacy prompt", contractVersion: 0, conversationId: "conversation_owned" } } });
    expect(state.runs.size).toBe(0); expect(state.jobs.size).toBe(1); expect(state.credits).toBe(45);
    expect(mocks.detachJob).toHaveBeenCalledWith(expect.objectContaining({ where: { conversationId: "conversation_owned", id: "failed_legacy_job", status: "FAILED", userId: ownerId } }));
    expect(mocks.updateConversation).toHaveBeenCalled(); expect(mocks.getUser).not.toHaveBeenCalled(); expect(events).not.toContain("reserve");
  });
});
