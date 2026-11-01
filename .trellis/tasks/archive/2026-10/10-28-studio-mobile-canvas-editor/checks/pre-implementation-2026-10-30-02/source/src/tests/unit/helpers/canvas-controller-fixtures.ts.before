import { vi } from "vitest";

import { CanvasContractError, type CanvasAssetDtoV1, type CanvasDocumentDtoV1, type CanvasGenerationParametersV1, type CanvasMetadataDtoV1, type CanvasRunLookupDtoV1, type CanvasRuntimeResolveDtoV1 } from "@/lib/canvas/contracts";
import type { SerializedGeneration } from "@/lib/prisma-mappers";
import type { CanvasClientApi } from "@/components/create/canvas/client-api";
import { createCanvasController, type CanvasControllerOptions } from "@/components/create/canvas/controller";
import { emptyCanvasScene } from "@/components/create/canvas/commands";
import { CanvasDraftStoreError, type CanvasDraftCommitV1, type CanvasDraftReadResultV1, type CanvasDraftStore } from "@/components/create/canvas/draft-types";
import type { CanvasJobOrigin, CanvasJobsPort } from "@/components/create/canvas/studio-bridge";
import type { GenerationItem } from "@/components/create/types";

export const canvasDate = "2026-10-29T00:00:00.000Z";
export const canvasDigest = "a".repeat(64);
export const canvasDefaults: CanvasGenerationParametersV1 = { providerMode: "built_in", channelId: "channel-account", model: "image-account-default", size: "auto", quality: "auto", outputFormat: "png", outputCompression: null, moderation: "auto", count: 1, negativePrompt: null, seed: null };
export function canvasUuid(sequence: number) { return `10000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`; }
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}
export function metadata(id: string, overrides: Partial<CanvasMetadataDtoV1> = {}): CanvasMetadataDtoV1 {
  return { id, title: "Canvas", revision: 0, hasSavedSnapshot: false, lastSavedAt: null, createdAt: canvasDate, updatedAt: canvasDate, ...overrides };
}
export function canvasJob(id: string, overrides: Partial<SerializedGeneration> = {}): SerializedGeneration {
  return { id, count: 1, createdAt: canvasDate, updatedAt: canvasDate, startedAt: null, completedAt: null, status: "pending", generationType: "text_to_image",
    providerMode: "built_in", providerChannelId: "channel-account", model: canvasDefaults.model, prompt: "frozen prompt", size: "auto", quality: "auto", outputFormat: "png", outputCompression: null,
    moderation: "auto", negativePrompt: null, creditsSpent: 1, images: [], videos: [], aspectRatio: null, durationSeconds: null, durationMs: null, conversationId: null,
    sourceImageUrl: null, sourceImageUrls: [], cancelRequestedAt: null, contractVersion: 1, errorCode: null, errorMessage: null, featuredAt: null, handoffState: null, ...overrides };
}
export function completedJob(id: string, count = 1): SerializedGeneration {
  return canvasJob(id, { status: "succeeded", count, completedAt: canvasDate, images: Array.from({ length: count }, (_, index) => ({ id: `${id}-image-${index + 1}`, url: `https://images.invalid/${id}/${index + 1}.png`, actualWidth: 1024, actualHeight: 1024, actualSize: "1024x1024" })) });
}
export function canvasAsset(id: string, uploadId: string, overrides: Partial<CanvasAssetDtoV1> = {}): CanvasAssetDtoV1 {
  return { id, uploadId, state: "READY", byteLength: 3, mimeType: "image/png", sha256: canvasDigest, readyAt: canvasDate, url: `https://images.invalid/${id}.png`, ...overrides };
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

export function createFakeCanvasStore() {
  const rows = new Map<string, CanvasDraftReadResultV1>();
  let failure: Error | null = null;
  const keyFor = (key: readonly string[]) => JSON.stringify(key);
  const port: CanvasDraftStore = {
    list: vi.fn<CanvasDraftStore["list"]>(async (ownerId) => [...rows.values()].filter((row) => row.envelope.ownerId === ownerId).map((row) => ({ envelope: clone(row.envelope), stamp: { ...row.stamp } }))),
    read: vi.fn<CanvasDraftStore["read"]>(async (key) => {
      const row = rows.get(keyFor(key));
      return row ? { envelope: clone(row.envelope), stamp: { ...row.stamp }, blobs: row.blobs.map((blob) => ({ ...blob })) } : null;
    }),
    commit: vi.fn(async (input: CanvasDraftCommitV1) => {
      if (failure) throw failure;
      const key = keyFor(input.key);
      const old = rows.get(key);
      if (JSON.stringify(old?.stamp ?? null) !== JSON.stringify(input.expected)) throw new CanvasDraftStoreError("conflict");
      if (old?.envelope.deletedAt) throw new CanvasDraftStoreError("deleted");
      if (old && (input.envelope.editRevision < old.envelope.editRevision || input.envelope.deletionEpoch < old.envelope.deletionEpoch
        || (input.envelope.cloud?.revision ?? 0) < (old.envelope.cloud?.revision ?? 0))) throw new CanvasDraftStoreError("conflict");
      if (old && input.envelope.editRevision === old.envelope.editRevision && JSON.stringify(input.envelope.scene) !== JSON.stringify(old.envelope.scene)) throw new CanvasDraftStoreError("invalid");
      const originals = new Map(old?.blobs.map((blob) => [blob.blobId, blob]) ?? []);
      for (const blob of input.putBlobs ?? []) originals.set(blob.blobId, { ...blob });
      for (const id of input.deleteBlobIds ?? []) originals.delete(id);
      const stamp = { writerId: canvasUuid(999), writeRevision: (old?.stamp.writeRevision ?? 0) + 1 };
      rows.set(key, { envelope: clone(input.envelope), stamp, blobs: [...originals.values()] });
      return stamp;
    }),
    close: vi.fn(),
  };
  return { port, rows, setFailure: (error: Error | null) => { failure = error; }, row: (owner: string, id: string) => rows.get(keyFor([owner, id])), seed(row: CanvasDraftReadResultV1) { rows.set(keyFor([row.envelope.ownerId, row.envelope.canvasId]), row); } };
}

export function createFakeCanvasJobs() {
  const jobs = new Map<string, GenerationItem>();
  const origins = new Map<string, CanvasJobOrigin>();
  const subscribers = new Set<(origin: CanvasJobOrigin, job: GenerationItem) => void>();
  const port: CanvasJobsPort = {
    register: vi.fn<CanvasJobsPort["register"]>((origin, incoming) => {
      const old = jobs.get(incoming.id);
      const job = old && old.status !== "pending" ? old : incoming;
      jobs.set(job.id, job);
      origins.set(job.id, origin);
      for (const notify of subscribers) notify(origin, job);
      return job;
    }),
    read: vi.fn<CanvasJobsPort["read"]>((id) => jobs.get(id) ?? null),
    subscribe: vi.fn<CanvasJobsPort["subscribe"]>((listener) => { subscribers.add(listener); return () => { subscribers.delete(listener); }; }),
  };
  return { port, jobs, origins, push: (origin: CanvasJobOrigin, job: GenerationItem) => port.register(origin, job), subscribers };
}

export function createFakeCanvasApi() {
  const documents = new Map<string, CanvasDocumentDtoV1>();
  const deleted = new Set<string>();
  const assets = new Map<string, CanvasAssetDtoV1>();
  const runs = new Map<string, CanvasRunLookupDtoV1>();
  const savedReceipts = new Map<string, { saveId: string; scene: string; expectedRevision: number; acknowledgedRevision: number }>();
  const read = (id: string) => {
    if (deleted.has(id)) throw new CanvasContractError("CANVAS_DELETED");
    const document = documents.get(id);
    if (!document) throw new CanvasContractError("CANVAS_NOT_FOUND");
    return document;
  };
  const port: CanvasClientApi = {
    list: vi.fn<CanvasClientApi["list"]>(async () => ({ canvases: [...documents.values()].filter((doc) => !deleted.has(doc.canvas.id)).map((doc) => doc.canvas), nextCursor: null })),
    read: vi.fn<CanvasClientApi["read"]>(async (id) => clone(read(id))),
    create: vi.fn<CanvasClientApi["create"]>(async (id, title) => {
      if (deleted.has(id)) throw new CanvasContractError("CANVAS_DELETED");
      if (!documents.has(id)) documents.set(id, { canvas: metadata(id, { title }), scene: null });
      return clone(read(id).canvas);
    }),
    rename: vi.fn<CanvasClientApi["rename"]>(async (id, title, expectedRevision) => {
      const document = read(id);
      if (document.canvas.revision !== expectedRevision) throw new CanvasContractError("CANVAS_REVISION_CONFLICT");
      document.canvas = { ...document.canvas, title, revision: expectedRevision + 1 };
      return clone(document.canvas);
    }),
    save: vi.fn<CanvasClientApi["save"]>(async (id, input) => {
      const document = read(id);
      const receipt = savedReceipts.get(id);
      if (receipt && receipt.saveId === input.saveId) {
        if (receipt.scene !== JSON.stringify(input.scene) || receipt.expectedRevision !== input.expectedRevision) throw new CanvasContractError("CANVAS_SAVE_CONFLICT");
        return { canvas: clone(document.canvas), saveId: input.saveId, sceneHash: canvasDigest, acknowledgedRevision: receipt.acknowledgedRevision };
      }
      if (document.canvas.revision !== input.expectedRevision) throw new CanvasContractError("CANVAS_REVISION_CONFLICT");
      document.scene = clone(input.scene);
      document.canvas = { ...document.canvas, revision: input.expectedRevision + 1, hasSavedSnapshot: true, lastSavedAt: canvasDate };
      savedReceipts.set(id, { saveId: input.saveId, scene: JSON.stringify(input.scene), expectedRevision: input.expectedRevision, acknowledgedRevision: document.canvas.revision });
      return { canvas: clone(document.canvas), saveId: input.saveId, sceneHash: canvasDigest, acknowledgedRevision: document.canvas.revision };
    }),
    delete: vi.fn<CanvasClientApi["delete"]>(async (id, expectedRevision) => {
      if (deleted.has(id)) return { id, deleted: true, revision: expectedRevision + 1 };
      if (read(id).canvas.revision !== expectedRevision) throw new CanvasContractError("CANVAS_REVISION_CONFLICT");
      deleted.add(id);
      return { id, deleted: true, revision: expectedRevision + 1 };
    }),
    asset: vi.fn<CanvasClientApi["asset"]>(async (id) => {
      const asset = assets.get(id);
      if (!asset) throw new CanvasContractError("CANVAS_INPUT_UNAVAILABLE");
      return asset;
    }),
    uploadStatus: vi.fn<CanvasClientApi["uploadStatus"]>(async (uploadId) => {
      const asset = [...assets.values()].find((value) => value.uploadId === uploadId);
      if (!asset) throw new CanvasContractError("CANVAS_INPUT_UNAVAILABLE");
      return asset;
    }),
    upload: vi.fn<CanvasClientApi["upload"]>(async (input) => {
      const id = `asset-${input.uploadId}`;
      const asset = canvasAsset(id, input.uploadId, { byteLength: input.blob.size, mimeType: input.blob.type, sha256: input.sha256 });
      assets.set(id, asset);
      return asset;
    }),
    resolve: vi.fn<CanvasClientApi["resolve"]>(async (input) => {
      read(input.canvasId);
      const response: CanvasRuntimeResolveDtoV1 = { canvasId: input.canvasId, assets: {}, images: {}, generations: {}, runs: {}, missing: [] };
      for (const id of input.assetIds) {
        const asset = assets.get(id);
        if (asset) response.assets[id] = asset;
        else response.missing.push({ kind: "asset", id, code: "CANVAS_INPUT_UNAVAILABLE" });
      }
      for (const id of [...input.runIds, ...input.runBindings.map((binding) => binding.runId)]) {
        const run = runs.get(id);
        if (!run) { response.missing.push({ kind: "run", id, code: "CANVAS_RUN_NOT_FOUND" }); continue; }
        response.runs[id] = run;
        if (run.state === "COMMITTED" && run.generation) response.generations[run.jobId] = run.generation;
      }
      for (const run of runs.values()) {
        if (run.state !== "COMMITTED" || !run.generation) continue;
        if (input.jobIds.includes(run.jobId)) response.generations[run.jobId] = run.generation;
        for (const image of run.generation.images) if (input.imageIds.includes(image.id)) response.images[image.id] = { ...image, jobId: run.jobId };
      }
      return response;
    }),
    lookup: vi.fn<CanvasClientApi["lookup"]>(async (id) => {
      const run = runs.get(id);
      if (!run) throw new CanvasContractError("CANVAS_RUN_NOT_FOUND");
      return run;
    }),
    submit: vi.fn<CanvasClientApi["submit"]>(async (projection) => {
      const existing = runs.get(projection.runId);
      if (existing) return existing;
      read(projection.canvasId);
      const job = canvasJob(`job-${projection.runId}`, { count: projection.references.length ? 1 : projection.params.count, prompt: projection.prompt.text });
      const origin = { canvasId: projection.canvasId, nodeId: projection.nodeId, runId: projection.runId };
      runs.set(projection.runId, { state: "COMMITTED", origin, jobId: job.id, generation: job, unavailable: null });
      return { generation: job, canvasRun: { ...origin, jobId: job.id } };
    }),
  };
  return { port, documents, assets, runs, deleted, savedReceipts, seed(id: string) { documents.set(id, { canvas: metadata(id), scene: null }); } };
}

export function canvasControllerFixture(overrides: Partial<CanvasControllerOptions> = {}) {
  const api = createFakeCanvasApi();
  const store = createFakeCanvasStore();
  const jobs = createFakeCanvasJobs();
  const release = vi.fn();
  const acquireTransientLease = vi.fn(async () => ({ fields: {}, release }));
  let sequence = 0;
  const options: CanvasControllerOptions = {
    ownerId: "owner-one", enabled: true, readOnly: false, defaultParameters: canvasDefaults, jobs: jobs.port, api: api.port, store: store.port,
    preferences: null, uuid: () => canvasUuid(++sequence), now: () => canvasDate, debounceMs: 60_000, digest: async () => canvasDigest, acquireTransientLease,
    ...overrides,
  };
  const controller = createCanvasController(options);
  return { controller, api, store, jobs, release, acquireTransientLease, options,
    async newGraph() {
      await controller.start();
      const canvasId = await controller.newCanvas();
      const promptId = controller.addPrompt(canvasId, { x: -300, y: 10 }, "frozen prompt");
      const nodeId = controller.addGeneration(canvasId, { x: 20, y: 10 });
      controller.connect(canvasId, promptId, nodeId);
      return { canvasId, promptId, nodeId };
    },
  };
}

export function localEnvelope(id: string) {
  return { storageVersion: 1 as const, ownerId: "owner-one", canvasId: id, title: "Local", scene: emptyCanvasScene(), editRevision: 0,
    cloud: metadata(id), savedEditRevision: null, shell: "registered" as const, deletionEpoch: 0, deletedAt: null, pendingSave: null, outbox: [], updatedAt: canvasDate };
}
