import {
  CANVAS_LIMITS,
  CanvasContractError,
  type CanvasGenerationParametersV1,
  type CanvasLocalSceneV1,
  type CanvasMetadataDtoV1,
  type CanvasPositionV1,
  type CanvasRunLookupDtoV1,
  type CanvasRunOutboxEntryV1,
  type CanvasRuntimeImageDtoV1,
  type CanvasSceneV1,
  type CanvasViewportV1,
} from "@/lib/canvas/contracts";
import type { CanvasInputRuntimeV1 } from "@/lib/canvas/graph";
import {
  canvasClientIdSchema,
  canvasGenerationParametersSchema,
  canvasSceneSchema,
  canvasTitleSchema,
  canvasViewportSchema,
} from "@/lib/validators";

import type { GenerationItem } from "../types";
import { createCanvasClientApi, type CanvasSubmissionResult } from "./client-api";
import {
  applyCanvasEdit,
  canvasReservations,
  canvasRuntimeRequests,
  copyCanvasScene,
  emptyCanvasScene,
  materializeCanvasTerminal,
  type CanvasCapacityReservation,
  type CanvasEditCommand,
} from "./commands";
import { openCanvasDraftStore } from "./draft-store";
import {
  CanvasDraftStoreError,
  type CanvasDraftBlobV1,
  type CanvasDraftEnvelopeV1,
  type CanvasDraftStore,
  type CanvasPendingSaveV1,
  type CanvasWriteStamp,
} from "./draft-types";
import {
  captureCanvasReference,
  createCanvasReferenceRuntime,
  validateCanvasOriginal,
  type CanvasPreviewLease,
  type CanvasReferenceCapture,
} from "./reference-runtime";
import type { CanvasJobOrigin } from "./studio-bridge";
import { createCanvasRunCommands } from "./run-commands";

import {
  CanvasCommandError, canvasControllerErrorMessage as errorMessage,
  emptyCanvasControllerSnapshot, isCanvasCloudConflict as isConflict,
  type CanvasControllerEntry as Entry, type CanvasPreparation as Preparation,
  type CanvasControllerOptions, type CanvasDocumentView, type CanvasRunView,
  type CanvasReferenceView, type CanvasActiveView,
} from "./controller-types";

export { CanvasCommandError, emptyCanvasControllerSnapshot } from "./controller-types";
export type {
  CanvasControllerOptions, CanvasControllerSnapshot, CanvasDocumentView,
  CanvasActiveView, CanvasReferenceView, CanvasRunView,
} from "./controller-types";

export function createCanvasController(options: CanvasControllerOptions) {
  const api = options.api ?? createCanvasClientApi();
  const uuid = options.uuid ?? (() => crypto.randomUUID());
  const now = options.now ?? (() => new Date().toISOString());
  const abort = new AbortController();
  const entries = new Map<string, Entry>();
  const loads = new Map<string, Promise<Entry>>();
  const metadata = new Map<string, CanvasMetadataDtoV1>();
  const listeners = new Set<() => void>();
  const preferenceKey = `narra_canvas_active_v1:${options.ownerId}`;
  let store: CanvasDraftStore | null = options.store ?? null;
  let preferences = options.preferences ?? null;
  let active = true;
  let started = false;
  let ready = false;
  let readOnly = options.readOnly;
  let defaults = { ...options.defaultParameters };
  let activeCanvasId: string | null = null;
  let nextCursor: string | null = null;
  let loading = false;
  let error: string | null = null;
  let warning: string | null = null;
  let unsubscribeJobs: (() => void) | null = null;
  let selectionEpoch = 0;
  let snapshot = emptyCanvasControllerSnapshot(options);

  function valid(entry: Entry): boolean {
    return active && !entry.invalidated && entries.get(entry.envelope.canvasId) === entry && entry.envelope.ownerId === options.ownerId;
  }
  function live(entry: Entry): boolean { return valid(entry) && !entry.envelope.deletedAt; }
  function assertActive() {
    if (!active || !started || !options.enabled) throw new CanvasCommandError("inactive");
  }
  function assertMutable() {
    assertActive();
    if (readOnly) throw new CanvasCommandError("readOnly");
    if (!ready) throw new CanvasCommandError("loading");
  }
  function getEntry(id: string, mutation = false): Entry {
    if (mutation) assertMutable(); else assertActive();
    const entry = entries.get(id);
    if (!entry?.loaded) throw new CanvasCommandError("loading");
    if (!live(entry) || (mutation && entry.deleting)) throw new CanvasContractError("CANVAS_DELETED");
    return entry;
  }
  function reservations(entry: Entry, scene = entry.envelope.scene, outbox = entry.envelope.outbox): CanvasCapacityReservation[] {
    const held = canvasReservations(scene, outbox, options.jobs.read);
    for (const preparation of entry.preparations.values()) {
      if (!held.some((item) => item.runId === preparation.origin.runId)
        && scene.nodes.some((node) => node.id === preparation.origin.nodeId)) {
        held.push({ runId: preparation.origin.runId, nodeId: preparation.origin.nodeId, count: preparation.count, outputsHandled: false });
      }
    }
    return held;
  }
  function viewDocument(id: string): CanvasDocumentView | null {
    const entry = entries.get(id);
    const cloud = entry?.envelope.cloud ?? metadata.get(id) ?? null;
    if (entry?.envelope.deletedAt) return null;
    if (!entry) return cloud ? { id, title: cloud.title, cloud: { ...cloud }, shell: "registered", editRevision: 0, savedEditRevision: cloud.hasSavedSnapshot ? 0 : null, localState: "saved", cloudState: cloud.hasSavedSnapshot ? "saved" : "local", deleting: false, loaded: false, error: null, warning: null } : null;
    const envelope = entry.envelope;
    return {
      id, title: envelope.title, cloud: envelope.cloud ? { ...envelope.cloud } : null, shell: envelope.shell,
      editRevision: envelope.editRevision, savedEditRevision: envelope.savedEditRevision,
      localState: entry.localState, cloudState: entry.cloudState ?? (envelope.savedEditRevision === envelope.editRevision ? "saved" : envelope.cloud?.hasSavedSnapshot ? "dirty" : "local"),
      deleting: entry.deleting, loaded: entry.loaded, error: entry.error, warning: entry.warning,
    };
  }
  function runViews(entry: Entry): CanvasRunView[] {
    const views = new Map<string, CanvasRunView>();
    for (const binding of entry.envelope.scene.runBindings) {
      const job = options.jobs.read(binding.jobId);
      views.set(binding.runId, { ...binding, phase: job?.status ?? "unavailable", error: entry.runErrors.get(binding.runId) ?? null });
    }
    for (const item of entry.envelope.outbox) {
      if (!entry.envelope.scene.nodes.some((node) => node.id === item.nodeId) || views.has(item.runId)) continue;
      views.set(item.runId, { runId: item.runId, nodeId: item.nodeId, jobId: item.jobId, phase: item.phase === "accepted" ? options.jobs.read(item.jobId)?.status ?? "unavailable" : item.phase === "rejected" ? "rejected" : "uncertain", error: entry.runErrors.get(item.runId) ?? null });
    }
    for (const preparation of entry.preparations.values()) views.set(preparation.origin.runId, { ...preparation.origin, jobId: null, phase: preparation.phase, error: null });
    return [...views.values()];
  }
  function viewActive(entry: Entry): CanvasActiveView | null {
    const document = viewDocument(entry.envelope.canvasId);
    if (!document || !entry.loaded) return null;
    const references: Record<string, CanvasReferenceView> = {};
    const images: Record<string, CanvasRuntimeImageDtoV1> = {};
    const jobs: Record<string, GenerationItem> = {};
    for (const node of entry.envelope.scene.nodes) {
      if (node.kind === "reference") {
        const captured = captureCanvasReference(node, entry.originals);
        const assetId = captured.original?.assetId ?? (node.source.kind === "imported" ? node.source.assetId : null);
        const asset = assetId ? entry.assets.get(assetId) : null;
        references[node.id] = { assetId, blobId: captured.original?.blobId ?? null, url: asset?.state === "READY" ? asset.url : null,
          state: asset?.state === "READY" && asset.url ? "ready" : asset?.state === "UPLOADING" ? "uploading" : captured.original ? "local" : "missing" };
      } else if (node.kind === "result") {
        const image = entry.images.get(node.imageId);
        if (image?.jobId === node.jobId) images[node.imageId] = { ...image };
        const job = options.jobs.read(node.jobId);
        if (job) jobs[job.id] = job;
      }
    }
    for (const binding of entry.envelope.scene.runBindings) {
      const job = options.jobs.read(binding.jobId);
      if (job) jobs[job.id] = job;
    }
    return { document, scene: copyCanvasScene(entry.envelope.scene), selectedNodeId: entry.selectedNodeId, viewport: { ...entry.camera }, references, images,
      jobs: JSON.parse(JSON.stringify(jobs)) as Record<string, GenerationItem>, runs: runViews(entry), reservations: reservations(entry), hydrating: entry.hydrating };
  }
  function publish() {
    if (!active) return;
    const entry = activeCanvasId ? entries.get(activeCanvasId) : null;
    snapshot = { ownerId: options.ownerId, enabled: options.enabled, ready, readOnly, activeCanvasId, active: entry ? viewActive(entry) : null,
      documents: [...new Set([...entries.keys(), ...metadata.keys()])].flatMap((id) => { const view = viewDocument(id); return view ? [view] : []; }), nextCursor, loading, error, warning };
    for (const listener of listeners) listener();
  }
  function savePreference() {
    try { if (activeCanvasId) preferences?.setItem(preferenceKey, activeCanvasId); else preferences?.removeItem(preferenceKey); }
    catch { /* Selection is optional; scene durability is reported separately. */ }
  }
  function schedule(entry: Entry) {
    if (!valid(entry)) return;
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.localState === "conflict") return;
    entry.localState = "pending";
    entry.timer = setTimeout(() => { entry.timer = null; void flushEntry(entry); }, options.debounceMs ?? 300);
  }
  function touch(entry: Entry, envelope: CanvasDraftEnvelopeV1 = entry.envelope) {
    if (!valid(entry)) return;
    entry.envelope = { ...envelope, updatedAt: now() };
    entry.version += 1;
    schedule(entry);
    publish();
  }
  function changeScene(entry: Entry, scene: CanvasLocalSceneV1, outbox = entry.envelope.outbox) {
    const changed = JSON.stringify(scene) !== JSON.stringify(entry.envelope.scene);
    if (!changed && JSON.stringify(outbox) === JSON.stringify(entry.envelope.outbox)) { publish(); return; }
    touch(entry, { ...entry.envelope, scene, outbox, editRevision: entry.envelope.editRevision + (changed ? 1 : 0) });
  }
  async function flushEntry(entry: Entry): Promise<boolean> {
    if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
    if (entry.flushPromise) {
      if (!await entry.flushPromise) return false;
      return entry.durableVersion >= entry.version ? valid(entry) : flushEntry(entry);
    }
    if (!valid(entry) || entry.localState === "conflict") return false;
    if (entry.durableVersion >= entry.version) return true;
    const persist = async () => {
      while (valid(entry) && entry.durableVersion < entry.version) {
        const version = entry.version;
        const envelope = JSON.parse(JSON.stringify(entry.envelope)) as CanvasDraftEnvelopeV1;
        const originals = [...entry.originals.values()].map((original) => ({ ...original }));
        try {
          if (!store) throw new CanvasDraftStoreError("unavailable");
          const stamp = await store.commit({ key: [options.ownerId, envelope.canvasId], expected: entry.stamp, envelope, putBlobs: originals, deleteBlobIds: entry.deleteBlobIds.slice() });
          if (!valid(entry)) return false;
          entry.stamp = stamp;
          entry.durableVersion = version;
          entry.localState = entry.durableVersion === entry.version ? "saved" : "pending";
          entry.warning = null;
          publish();
        } catch (failure) {
          if (!valid(entry)) return false;
          entry.localState = failure instanceof CanvasDraftStoreError && ["conflict", "deleted", "corrupt", "version"].includes(failure.code) ? "conflict" : "failed";
          entry.warning = errorMessage(failure);
          if (entry.envelope.deletedAt) warning = entry.warning;
          publish();
          return false;
        }
      }
      return valid(entry);
    };
    const promise = persist().finally(() => { if (entry.flushPromise === promise) entry.flushPromise = null; });
    entry.flushPromise = promise;
    return promise;
  }
  function makeEntry(envelope: CanvasDraftEnvelopeV1, stamp: CanvasWriteStamp | null, originals: CanvasDraftBlobV1[], loaded: boolean): Entry {
    const references = createCanvasReferenceRuntime({ api, uuid, signal: abort.signal, alive: () => live(entry),
      readOriginal: (blobId) => entry.originals.get(blobId),
      onOriginal: (original) => {
        const previous = entry.originals.get(original.blobId);
        if (!live(entry) || !previous) return;
        entry.originals.set(original.blobId, original);
        let changed = false;
        const nodes = entry.envelope.scene.nodes.map((node): CanvasLocalSceneV1["nodes"][number] => {
          if (!previous.assetId || previous.assetId === original.assetId || node.kind !== "reference"
            || node.source.kind !== "imported" || node.source.assetId !== previous.assetId) return node;
          changed = true;
          // Cloud-loaded references need their durable original locator before
          // an expired asset mapping is cleared, including an interrupted upload.
          return { ...node, source: original.assetId ? { kind: "imported", assetId: original.assetId }
            : { kind: "local", blobId: original.blobId, uploadId: original.uploadId } };
        });
        if (changed) changeScene(entry, { ...entry.envelope.scene, nodes }); else touch(entry);
      },
      onAsset: (asset) => { if (live(entry)) { entry.assets.set(asset.id, asset); publish(); } },
      digest: options.digest, objectUrls: options.objectUrls,
    });
    const entry: Entry = {
      envelope, stamp, references, originals: new Map(originals.map((original) => [original.blobId, original])), assets: new Map(), images: new Map(), preparations: new Map(), runErrors: new Map(),
      version: stamp ? 0 : 1, durableVersion: 0, flushPromise: null, timer: null, metadataTail: Promise.resolve(), savePromise: null,
      loaded, invalidated: false, deleting: false, hydrating: false, hydrateEpoch: 0, selectedNodeId: null,
      camera: { ...envelope.scene.viewport }, localState: stamp ? "saved" : "pending", cloudState: null, error: null, warning: null, deleteBlobIds: [],
    };
    return entry;
  }
  function newEnvelope(id: string, title: string, cloud: CanvasMetadataDtoV1 | null = null, scene: CanvasLocalSceneV1 = emptyCanvasScene()): CanvasDraftEnvelopeV1 {
    return { storageVersion: 1, ownerId: options.ownerId, canvasId: id, title, scene, editRevision: 0, cloud, savedEditRevision: cloud?.hasSavedSnapshot ? 0 : null,
      shell: cloud ? "registered" : "local", deletionEpoch: 0, deletedAt: null, pendingSave: null, outbox: [], updatedAt: now() };
  }
  function metadataMutation<T>(entry: Entry, operation: () => Promise<T>): Promise<T> {
    const result = entry.metadataTail.catch(() => {}).then(() => {
      if (!live(entry)) throw new CanvasContractError("CANVAS_DELETED");
      return operation();
    });
    entry.metadataTail = result.catch(() => {});
    return result;
  }
  function acknowledgeMetadata(entry: Entry, cloud: CanvasMetadataDtoV1) {
    if (!live(entry)) return;
    if (cloud.id !== entry.envelope.canvasId || cloud.revision < (entry.envelope.cloud?.revision ?? 0)) throw new CanvasContractError("CANVAS_ORIGIN_MISMATCH");
    metadata.set(cloud.id, cloud);
    touch(entry, { ...entry.envelope, cloud, title: cloud.title, shell: "registered" });
  }
  async function ensureShellNow(entry: Entry, deleting = false): Promise<void> {
    if (entry.envelope.shell === "registered") return;
    if (!live(entry) || (entry.deleting && !deleting)) throw new CanvasContractError("CANVAS_DELETED");
    touch(entry, { ...entry.envelope, shell: "uncertain" });
    const cloud = await api.create(entry.envelope.canvasId, entry.envelope.title, abort.signal);
    acknowledgeMetadata(entry, cloud);
  }
  async function ensureShell(entry: Entry) {
    if (entry.envelope.shell === "registered") return;
    await metadataMutation(entry, () => ensureShellNow(entry));
  }
  function preparationLive(entry: Entry, preparation: Preparation): boolean {
    return live(entry) && !readOnly && !entry.deleting && entry.envelope.deletionEpoch === preparation.epoch
      && entry.envelope.scene.nodes.some((node) => node.id === preparation.origin.nodeId && node.kind === "generation");
  }

  function rememberImages(entry: Entry, job: GenerationItem) {
    if (job.status !== "succeeded") return;
    for (const image of job.images) entry.images.set(image.id, { id: image.id, jobId: job.id, url: image.url,
      actualWidth: image.actualWidth ?? null, actualHeight: image.actualHeight ?? null, actualSize: image.actualSize ?? null });
  }
  function receiveJob(origin: CanvasJobOrigin, incoming: GenerationItem) {
    if (!active || origin.ownerId !== options.ownerId) return;
    const entry = entries.get(origin.canvasId);
    if (!entry || !live(entry)) return;
    const job = options.jobs.read(incoming.id) ?? incoming;
    rememberImages(entry, job);
    const binding = entry.envelope.scene.runBindings.find((item) => item.runId === origin.runId && item.nodeId === origin.nodeId && item.jobId === job.id);
    if (!binding || entry.deleting) { publish(); return; }
    try {
      const next = materializeCanvasTerminal(entry.envelope.scene, binding, job, reservations(entry), uuid);
      entry.runErrors.delete(origin.runId);
      if (next !== entry.envelope.scene) changeScene(entry, next); else publish();
    } catch (failure) {
      entry.runErrors.set(origin.runId, errorMessage(failure));
      publish();
    }
  }
  function accept(entry: Entry, origin: CanvasJobOrigin, jobId: string, incoming: GenerationItem | null) {
    if (!active || origin.ownerId !== options.ownerId || origin.canvasId !== entry.envelope.canvasId || (incoming && incoming.id !== jobId)) throw new CanvasContractError("CANVAS_ORIGIN_MISMATCH");
    // register() commits the canonical cache before notifying subscriptions.
    // Even an acknowledged deleted source keeps its job, but no organization.
    const job = incoming ? options.jobs.register(origin, incoming) : options.jobs.read(jobId);
    if (!live(entry)) return;
    if (job) rememberImages(entry, job);
    const old = entry.envelope.outbox.find((item) => item.runId === origin.runId && item.nodeId === origin.nodeId);
    const current = entry.envelope.scene.runBindings.find((item) => item.nodeId === origin.nodeId);
    if ((old?.phase === "accepted" && old.jobId !== jobId) || (current?.runId === origin.runId && current.jobId !== jobId)) throw new CanvasContractError("CANVAS_ORIGIN_MISMATCH");
    const outbox = entry.envelope.outbox.map((item): CanvasRunOutboxEntryV1 => item === old ? { ...item, phase: "accepted", jobId } : item);
    let scene = entry.envelope.scene;
    const mayAttach = !entry.deleting && scene.nodes.some((node) => node.id === origin.nodeId && node.kind === "generation")
      && (old || current?.runId === origin.runId) && (!current || current.runId === origin.runId || current.outputsHandled);
    let attachmentError: unknown;
    if (mayAttach) {
      const binding = current?.runId === origin.runId ? current : { runId: origin.runId, nodeId: origin.nodeId, jobId, outputsHandled: false };
      scene = { ...scene, runBindings: [...scene.runBindings.filter((item) => item.nodeId !== origin.nodeId), binding] };
      if (job) {
        try { scene = materializeCanvasTerminal(scene, binding, job, reservations(entry, scene, outbox), uuid); }
        catch (failure) { attachmentError = failure; }
      }
    }
    entry.runErrors.delete(origin.runId);
    if (!job) entry.runErrors.set(origin.runId, errorMessage(new CanvasContractError("CANVAS_JOB_UNAVAILABLE")));
    else if (attachmentError) entry.runErrors.set(origin.runId, errorMessage(attachmentError));
    changeScene(entry, scene, outbox);
  }
  function applyLookup(entry: Entry, runId: string, lookup: CanvasRunLookupDtoV1) {
    const item = entry.envelope.outbox.find((value) => value.runId === runId);
    const binding = entry.envelope.scene.runBindings.find((value) => value.runId === runId);
    const result = entry.envelope.scene.nodes.find((node) => node.kind === "result" && node.runId === runId);
    if (lookup.origin.canvasId !== entry.envelope.canvasId || lookup.origin.runId !== runId
      || ((item || binding) && lookup.origin.nodeId !== (item?.nodeId ?? binding?.nodeId))) throw new CanvasContractError("CANVAS_ORIGIN_MISMATCH");
    if (lookup.state === "COMMITTED") {
      if ((binding && binding.jobId !== lookup.jobId) || (result?.kind === "result" && result.jobId !== lookup.jobId)) throw new CanvasContractError("CANVAS_ORIGIN_MISMATCH");
      accept(entry, { ownerId: options.ownerId, ...lookup.origin }, lookup.jobId, lookup.generation);
    } else if (live(entry) && item) {
      if (item.phase === "accepted") return;
      const phase = lookup.state === "REJECTED" ? "rejected" : "uncertain";
      touch(entry, { ...entry.envelope, outbox: entry.envelope.outbox.map((value): CanvasRunOutboxEntryV1 => value.runId === runId ? { ...value, phase, jobId: null } : value) });
      entry.runErrors.set(runId, errorMessage(new CanvasContractError(lookup.state === "REJECTED" ? lookup.code : "CANVAS_RUN_PREPARING")));
      publish();
    }
  }
  function applySubmission(entry: Entry, preparation: Preparation, response: CanvasSubmissionResult) {
    if ("state" in response) { applyLookup(entry, preparation.origin.runId, response); return; }
    const origin = response.canvasRun;
    if (origin.canvasId !== preparation.origin.canvasId || origin.nodeId !== preparation.origin.nodeId || origin.runId !== preparation.origin.runId) throw new CanvasContractError("CANVAS_ORIGIN_MISMATCH");
    accept(entry, preparation.origin, origin.jobId, response.generation);
  }
  function reconcileBindings(entry: Entry) {
    if (!live(entry) || entry.deleting) return;
    for (const binding of entry.envelope.scene.runBindings.slice()) {
      const cached = options.jobs.read(binding.jobId);
      if (cached) receiveJob({ ownerId: options.ownerId, canvasId: entry.envelope.canvasId, nodeId: binding.nodeId, runId: binding.runId }, cached);
    }
  }
  async function recover(entry: Entry) {
    const items = entry.envelope.outbox.slice();
    for (const item of items) {
      if (!live(entry)) return;
      try {
        const cached = item.phase === "accepted" ? options.jobs.read(item.jobId) : null;
        if (cached) accept(entry, { ownerId: options.ownerId, canvasId: item.canvasId, nodeId: item.nodeId, runId: item.runId }, cached.id, cached);
        else if (item.phase !== "rejected") applyLookup(entry, item.runId, await api.lookup(item.runId, abort.signal));
      } catch (failure) {
        if (live(entry)) { entry.runErrors.set(item.runId, errorMessage(failure)); publish(); }
      }
    }
    reconcileBindings(entry);
  }
  async function hydrate(entry: Entry) {
    if (!live(entry) || entry.envelope.shell !== "registered") return;
    const epoch = ++entry.hydrateEpoch;
    const scene = copyCanvasScene(entry.envelope.scene);
    const mappedAssets = scene.nodes.flatMap((node) => node.kind === "reference" ? [captureCanvasReference(node, entry.originals).original?.assetId].filter((id): id is string => Boolean(id)) : []);
    entry.hydrating = true;
    publish();
    try {
      for (const request of canvasRuntimeRequests(entry.envelope.canvasId, scene, mappedAssets)) {
        const response = await api.resolve(request, abort.signal);
        if (!live(entry) || epoch !== entry.hydrateEpoch) return;
        if (response.canvasId !== entry.envelope.canvasId) throw new CanvasContractError("CANVAS_ORIGIN_MISMATCH");
        for (const id of request.assetIds) {
          const asset = response.assets[id];
          if (asset) entry.assets.set(id, asset); else entry.assets.delete(id);
        }
        for (const id of request.imageIds) {
          const image = response.images[id];
          const node = scene.nodes.find((item) => item.kind === "result" && item.imageId === id);
          if (image && node?.kind === "result" && image.jobId === node.jobId) entry.images.set(id, image);
          else entry.images.delete(id);
        }
        for (const runId of [...request.runBindings.map((binding) => binding.runId), ...request.runIds]) {
          const lookup = response.runs[runId];
          if (lookup) applyLookup(entry, runId, lookup);
          else entry.runErrors.set(runId, errorMessage(new CanvasContractError(response.missing.find((item) => item.kind === "run" && item.id === runId)?.code ?? "CANVAS_JOB_UNAVAILABLE")));
        }
      }
    } catch (failure) {
      if (live(entry) && epoch === entry.hydrateEpoch) entry.error = errorMessage(failure);
    } finally {
      if (live(entry) && epoch === entry.hydrateEpoch) {
        // An earlier terminal batch may have waited for a later binding's count.
        // Reconcile only the current scene's canonical cache after bounded reads.
        reconcileBindings(entry);
        entry.hydrating = false;
        publish();
      }
    }
  }
  async function loadEntry(id: string): Promise<Entry> {
    const existing = entries.get(id);
    if (existing?.loaded) return existing;
    const loading = loads.get(id);
    if (loading) return loading;
    const load = async () => {
      let local = null;
      try { if (store) local = await store.read([options.ownerId, id]); }
      catch (failure) {
        if (existing || !(failure instanceof CanvasDraftStoreError) || ["corrupt", "version", "conflict", "deleted"].includes(failure.code)) throw failure;
        warning = errorMessage(failure);
      }
      if (!active) throw new CanvasCommandError("inactive");
      if (local && (local.envelope.ownerId !== options.ownerId || local.envelope.canvasId !== id)) throw new CanvasDraftStoreError("corrupt");
      let entry: Entry;
      if (local) entry = makeEntry(local.envelope, local.stamp, local.blobs, true);
      else {
        // A listed local record disappearing is eviction, not permission to
        // silently replace its unsaved graph with an empty/cloud document.
        if (existing) throw new CanvasDraftStoreError("unavailable");
        const document = await api.read(id, abort.signal);
        if (!active) throw new CanvasCommandError("inactive");
        if (document.canvas.id !== id) throw new CanvasContractError("CANVAS_ORIGIN_MISMATCH");
        entry = makeEntry(newEnvelope(id, document.canvas.title, document.canvas, document.scene ?? emptyCanvasScene()), null, [], true);
      }
      if (existing) { existing.invalidated = true; existing.references.dispose(); }
      entries.set(id, entry);
      if (entry.envelope.deletedAt) { metadata.delete(id); publish(); throw new CanvasContractError("CANVAS_DELETED"); }
      if (!local) schedule(entry);
      publish();
      if (local && local.envelope.shell !== "local") {
        try {
          const document = await api.read(id, abort.signal);
          if (live(entry) && entry.envelope.cloud && document.canvas.revision !== entry.envelope.cloud.revision) {
            entry.cloudState = "conflict";
            entry.error = errorMessage(new CanvasContractError("CANVAS_REVISION_CONFLICT"));
          }
        } catch (failure) {
          if (live(entry)) {
            // Only the owner's explicit server tombstone revokes attachment.
            // Missing/offline reads must keep the local scene and run outbox.
            if (failure instanceof CanvasContractError && failure.code === "CANVAS_DELETED") {
              if (activeCanvasId === id) error = errorMessage(failure);
              await acknowledgeDeletion(entry);
              return entry;
            }
            entry.error = errorMessage(failure);
          }
        }
      }
      if (live(entry)) await Promise.all([hydrate(entry), recover(entry)]);
      return entry;
    };
    const promise = load();
    loads.set(id, promise);
    try { return await promise; }
    finally { if (loads.get(id) === promise) loads.delete(id); }
  }
  async function selectCanvas(id: string) {
    assertActive();
    if (!canvasClientIdSchema.safeParse(id).success) throw new CanvasContractError("CANVAS_INVALID_INPUT");
    if (entries.get(id)?.envelope.deletedAt) throw new CanvasContractError("CANVAS_DELETED");
    const epoch = ++selectionEpoch;
    activeCanvasId = id;
    error = null;
    loading = true;
    savePreference();
    publish();
    try { await loadEntry(id); }
    catch (failure) {
      if (active && selectionEpoch === epoch) error = errorMessage(failure);
      throw failure;
    } finally { if (active && selectionEpoch === epoch) { loading = false; publish(); } }
  }

  function captureScene(entry: Entry): CanvasLocalSceneV1 {
    const scene = copyCanvasScene(entry.envelope.scene);
    scene.nodes = scene.nodes.map((node) => {
      if (node.kind !== "reference") return node;
      const original = captureCanvasReference(node, entry.originals).original;
      return original ? { ...node, source: { kind: "local", blobId: original.blobId, uploadId: original.uploadId } } : node;
    });
    return scene;
  }
  function inputRuntime(entry: Entry): CanvasInputRuntimeV1 {
    return {
      ownerId: options.ownerId,
      localBlobs: Object.fromEntries([...entry.originals].map(([id, original]) => [id, { available: true, byteLength: original.blob.size }])),
      assets: Object.fromEntries([...entry.assets].map(([id, asset]) => [id, { assetId: id, ownerId: options.ownerId, state: asset.url ? asset.state : "UNAVAILABLE", byteLength: asset.byteLength, uploadId: asset.uploadId }])),
      images: Object.fromEntries([...entry.images].map(([id, image]) => [id, { imageId: id, jobId: image.jobId, ownerId: options.ownerId, status: "SUCCEEDED", available: Boolean(image.url) }])),
    };
  }
  function captures(entry: Entry, scene: CanvasLocalSceneV1): Map<string, CanvasReferenceCapture> {
    return new Map(scene.nodes.flatMap((node) => node.kind === "reference" ? [[node.id, captureCanvasReference(node, entry.originals)] as const] : []));
  }
  async function resolveSavedScene(entry: Entry, pending: CanvasPendingSaveV1, originals: Map<string, CanvasReferenceCapture>): Promise<CanvasSceneV1> {
    if (pending.resolvedScene) return copyCanvasScene(pending.resolvedScene);
    const nodes: CanvasSceneV1["nodes"] = [];
    for (const node of pending.scene.nodes) {
      if (!live(entry) || entry.deleting || pending.deletionEpoch !== entry.envelope.deletionEpoch) throw new CanvasContractError("CANVAS_DELETED");
      if (node.kind !== "reference") { nodes.push(node); continue; }
      const capture = originals.get(node.id);
      if (!capture) throw new CanvasContractError("CANVAS_INPUT_UNAVAILABLE");
      const asset = await entry.references.resolve(capture);
      nodes.push({ ...node, source: { kind: "imported", assetId: asset.id } });
    }
    const parsed = canvasSceneSchema.safeParse({ ...pending.scene, nodes });
    if (!parsed.success) throw new CanvasContractError("CANVAS_INVALID_INPUT");
    return parsed.data;
  }
  async function saveCanvas(id: string): Promise<void> {
    const entry = getEntry(id, true);
    if (entry.savePromise) return entry.savePromise;
    const pending: CanvasPendingSaveV1 = entry.envelope.pendingSave ?? {
      saveId: uuid(), expectedRevision: entry.envelope.cloud?.revision ?? 0, editRevision: entry.envelope.editRevision,
      deletionEpoch: entry.envelope.deletionEpoch, scene: captureScene(entry), resolvedScene: null,
    };
    const originals = captures(entry, pending.scene);
    entry.cloudState = "saving";
    entry.error = null;
    touch(entry, { ...entry.envelope, pendingSave: pending });
    const request = metadataMutation(entry, async () => {
      let sent = false;
      try {
        assertMutable();
        if (entry.deleting || pending.deletionEpoch !== entry.envelope.deletionEpoch) throw new CanvasContractError("CANVAS_DELETED");
        await ensureShellNow(entry);
        if (entry.envelope.cloud?.revision !== pending.expectedRevision && !pending.resolvedScene) throw new CanvasContractError("CANVAS_REVISION_CONFLICT");
        const resolvedScene = await resolveSavedScene(entry, pending, originals);
        if (!live(entry) || entry.deleting || entry.envelope.deletionEpoch !== pending.deletionEpoch) throw new CanvasContractError("CANVAS_DELETED");
        touch(entry, { ...entry.envelope, pendingSave: { ...pending, resolvedScene } });
        // Account Save can still preserve memory-only originals after local
        // quota failure. Unlike Run, this request cannot create a billable job.
        await flushEntry(entry);
        assertMutable();
        if (!live(entry) || entry.deleting || entry.envelope.deletionEpoch !== pending.deletionEpoch) throw new CanvasContractError("CANVAS_DELETED");
        sent = true;
        const receipt = await api.save(id, { saveId: pending.saveId, expectedRevision: pending.expectedRevision, scene: resolvedScene }, abort.signal);
        if (!live(entry)) return;
        if (receipt.canvas.id !== id || receipt.saveId !== pending.saveId || receipt.acknowledgedRevision !== pending.expectedRevision + 1
          || receipt.canvas.revision < receipt.acknowledgedRevision) throw new CanvasContractError("CANVAS_ORIGIN_MISMATCH");
        acknowledgeMetadata(entry, receipt.canvas);
        entry.cloudState = null;
        entry.error = null;
        touch(entry, { ...entry.envelope, savedEditRevision: pending.editRevision, pendingSave: null });
        await flushEntry(entry);
      } catch (failure) {
        if (live(entry)) {
          entry.cloudState = isConflict(failure) ? "conflict" : "failed";
          entry.error = errorMessage(failure);
          // A known rejection permits a new explicit capture after correction.
          // Unknown PUT outcome retains the exact save ID/assets/revision.
          const definitive = !sent || (failure instanceof CanvasContractError && failure.status < 500 && !isConflict(failure));
          if (definitive && !isConflict(failure)) touch(entry, { ...entry.envelope, pendingSave: null });
          publish();
        }
        throw failure;
      }
    });
    const promise = request.finally(() => { if (entry.savePromise === promise) entry.savePromise = null; });
    entry.savePromise = promise;
    return promise;
  }
  function edit(canvasId: string, command: CanvasEditCommand, original?: CanvasDraftBlobV1) {
    const entry = getEntry(canvasId, true);
    const scene = applyCanvasEdit(entry.envelope.scene, command, reservations(entry));
    if (!original && JSON.stringify(scene) === JSON.stringify(entry.envelope.scene)) return;
    if (original) {
      if (entry.originals.size >= CANVAS_LIMITS.ownerAccountedImports) throw new CanvasContractError("CANVAS_LIMIT_EXCEEDED");
      entry.originals.set(original.blobId, original);
    }
    if (command.kind === "remove") {
      if (entry.selectedNodeId === command.nodeId) entry.selectedNodeId = null;
      for (const preparation of entry.preparations.values()) if (preparation.origin.nodeId === command.nodeId) preparation.abort.abort();
    }
    entry.error = null;
    changeScene(entry, scene);
  }
  function originalFile(file: File): CanvasDraftBlobV1 {
    validateCanvasOriginal(file);
    return { blobId: uuid(), uploadId: uuid(), blob: file, fileName: file.name, lastModified: file.lastModified, sha256: null, assetId: null };
  }
  async function newCanvas(title = "\u672a\u547d\u540d\u753b\u5e03"): Promise<string> {
    assertMutable();
    const parsed = canvasTitleSchema.safeParse(title);
    if (!parsed.success) throw new CanvasContractError("CANVAS_INVALID_INPUT");
    if (snapshot.documents.length >= CANVAS_LIMITS.liveCanvasesPerOwner) throw new CanvasContractError("CANVAS_QUOTA_EXCEEDED");
    const id = uuid();
    if (entries.has(id) || metadata.has(id)) throw new CanvasContractError("CANVAS_INVALID_INPUT");
    const entry = makeEntry(newEnvelope(id, parsed.data), null, [], true);
    entries.set(id, entry);
    activeCanvasId = id;
    selectionEpoch += 1;
    loading = false;
    error = null;
    savePreference();
    schedule(entry);
    publish();
    try { await ensureShell(entry); return id; }
    catch (failure) { if (live(entry)) { entry.error = errorMessage(failure); publish(); } throw failure; }
  }
  async function renameCanvas(id: string, title: string): Promise<void> {
    const entry = getEntry(id, true);
    const parsed = canvasTitleSchema.safeParse(title);
    if (!parsed.success) throw new CanvasContractError("CANVAS_INVALID_INPUT");
    await metadataMutation(entry, async () => {
      assertMutable();
      if (entry.deleting) throw new CanvasContractError("CANVAS_DELETED");
      try {
        await ensureShellNow(entry);
        const cloud = await api.rename(id, parsed.data, entry.envelope.cloud!.revision, abort.signal);
        if (live(entry)) { acknowledgeMetadata(entry, cloud); entry.error = null; publish(); }
      } catch (failure) {
        if (live(entry)) { entry.error = errorMessage(failure); if (isConflict(failure)) entry.cloudState = "conflict"; publish(); }
        throw failure;
      }
    });
  }
  async function acknowledgeDeletion(entry: Entry, revision = entry.envelope.cloud?.revision ?? 0): Promise<void> {
    if (!live(entry)) return;
    const id = entry.envelope.canvasId;
    entry.deleting = true;
    for (const preparation of entry.preparations.values()) preparation.abort.abort();
    entry.deleteBlobIds = [...entry.originals.keys()];
    entry.originals.clear();
    entry.references.dispose();
    entry.hydrateEpoch += 1;
    metadata.delete(id);
    const cloud = entry.envelope.cloud ? { ...entry.envelope.cloud, revision, hasSavedSnapshot: false, lastSavedAt: null } : null;
    touch(entry, { ...entry.envelope, scene: emptyCanvasScene(), editRevision: entry.envelope.editRevision + 1, cloud,
      savedEditRevision: null, pendingSave: null, outbox: [], deletedAt: now(), deletionEpoch: entry.envelope.deletionEpoch + 1 });
    if (activeCanvasId === id) { activeCanvasId = null; selectionEpoch += 1; loading = false; savePreference(); }
    if (!await flushEntry(entry)) warning = entry.warning ?? errorMessage(new CanvasDraftStoreError("unavailable"));
    publish();
  }
  async function deleteCanvas(id: string, confirmed: boolean): Promise<void> {
    const entry = getEntry(id, true);
    if (!confirmed) throw new CanvasCommandError("confirmation");
    entry.deleting = true;
    touch(entry, { ...entry.envelope, deletionEpoch: entry.envelope.deletionEpoch + 1 });
    for (const preparation of entry.preparations.values()) preparation.abort.abort();
    try {
      await metadataMutation(entry, async () => {
        assertMutable();
        let revision = entry.envelope.cloud?.revision ?? 0;
        if (entry.envelope.shell !== "local") {
          // Completing the same idempotent create then DELETE installs a server
          // tombstone even if an earlier lost create request arrives late.
          try { await ensureShellNow(entry, true); }
          catch (failure) { if (!(failure instanceof CanvasContractError) || failure.code !== "CANVAS_DELETED") throw failure; }
          const receipt = await api.delete(id, entry.envelope.cloud?.revision ?? 0, abort.signal);
          revision = receipt.revision;
        }
        await acknowledgeDeletion(entry, revision);
      });
    } catch (failure) {
      if (live(entry)) {
        entry.deleting = false;
        entry.error = errorMessage(failure);
        if (isConflict(failure)) entry.cloudState = "conflict";
        if (entry.envelope.pendingSave) touch(entry, { ...entry.envelope, pendingSave: { ...entry.envelope.pendingSave, deletionEpoch: entry.envelope.deletionEpoch } });
        // A terminal poll/ACK can have arrived while attachment was blocked.
        // Replay only retained IDs and the canonical cache, never generation POST.
        await recover(entry);
        await hydrate(entry);
        publish();
      }
      throw failure;
    }
  }
  async function reloadAccountCanvas(id: string, confirmed: boolean): Promise<void> {
    assertMutable();
    if (!confirmed) throw new CanvasCommandError("confirmation");
    const previous = entries.get(id);
    if (previous?.envelope.deletedAt) throw new CanvasContractError("CANVAS_DELETED");
    if (previous?.deleting) throw new CanvasContractError("CANVAS_DELETED");
    const reload = async () => {
      if (previous) {
        previous.deleting = true;
        touch(previous, { ...previous.envelope, deletionEpoch: previous.envelope.deletionEpoch + 1 });
        for (const preparation of previous.preparations.values()) preparation.abort.abort();
        await flushEntry(previous);
      }
      try {
        const document = await api.read(id, abort.signal);
        if (!active || document.canvas.id !== id) throw new CanvasContractError("CANVAS_ORIGIN_MISMATCH");
        let stored = null;
        try { if (store) stored = await store.read([options.ownerId, id]); }
        catch (failure) { warning = errorMessage(failure); }
        if (!active) throw new CanvasCommandError("inactive");
        if (stored?.envelope.deletedAt) throw new CanvasContractError("CANVAS_DELETED");
        if (document.canvas.revision < Math.max(previous?.envelope.cloud?.revision ?? 0, stored?.envelope.cloud?.revision ?? 0)) throw new CanvasContractError("CANVAS_REVISION_CONFLICT");
        const editRevision = Math.max(previous?.envelope.editRevision ?? 0, stored?.envelope.editRevision ?? 0) + 1;
        const envelope = { ...newEnvelope(id, document.canvas.title, document.canvas, document.scene ?? emptyCanvasScene()), editRevision,
          savedEditRevision: document.canvas.hasSavedSnapshot ? editRevision : null, deletionEpoch: Math.max(previous?.envelope.deletionEpoch ?? 0, stored?.envelope.deletionEpoch ?? 0) };
        const originals = new Map(stored?.blobs.map((original) => [original.blobId, original]) ?? []);
        for (const [blobId, original] of previous?.originals ?? []) originals.set(blobId, original);
        if (previous) { previous.invalidated = true; previous.references.dispose(); if (previous.timer) clearTimeout(previous.timer); }
        const entry = makeEntry(envelope, stored?.stamp ?? previous?.stamp ?? null, [...originals.values()], true);
        entry.version = 1;
        entries.set(id, entry);
        metadata.set(id, document.canvas);
        error = null;
        touch(entry);
        await flushEntry(entry);
        await Promise.all([hydrate(entry), recover(entry)]);
      } catch (failure) {
        if (previous && live(previous)) {
          previous.deleting = false;
          previous.error = errorMessage(failure);
          if (previous.envelope.pendingSave) touch(previous, { ...previous.envelope, pendingSave: { ...previous.envelope.pendingSave, deletionEpoch: previous.envelope.deletionEpoch } });
          await recover(previous);
        }
        if (active) { error = errorMessage(failure); publish(); }
        throw failure;
      }
    };
    await (previous ? metadataMutation(previous, reload) : reload());
  }
  async function loadMore() {
    assertActive();
    if (!nextCursor || loading) return;
    loading = true;
    publish();
    try {
      const page = await api.list(nextCursor, abort.signal);
      if (!active) return;
      for (const canvas of page.canvases) if (!entries.get(canvas.id)?.envelope.deletedAt) metadata.set(canvas.id, canvas);
      nextCursor = page.nextCursor;
    } catch (failure) { if (active) error = errorMessage(failure); throw failure; }
    finally { if (active) { loading = false; publish(); } }
  }
  async function start() {
    if (started || !active) return;
    started = true;
    if (!options.enabled) { ready = true; publish(); return; }
    unsubscribeJobs = options.jobs.subscribe(receiveJob);
    loading = true;
    publish();
    if (options.preferences === undefined) {
      try { preferences = typeof window === "undefined" ? null : window.localStorage; } catch { preferences = null; }
    }
    try {
      if (options.store === undefined) store = await openCanvasDraftStore({ writerId: uuid() });
      if (!active) { store?.close(); return; }
      const locals = store ? await store.list(options.ownerId) : [];
      if (!active) return;
      for (const local of locals) {
        if (local.envelope.ownerId !== options.ownerId) throw new CanvasDraftStoreError("corrupt");
        const entry = makeEntry(local.envelope, local.stamp, [], false);
        entries.set(local.envelope.canvasId, entry);
      }
    } catch (failure) { if (active) warning = errorMessage(failure); }
    if (!active) return;
    try {
      if (options.initialCanvases) for (const canvas of options.initialCanvases) metadata.set(canvas.id, canvas);
      else {
        const page = await api.list(null, abort.signal);
        if (!active) return;
        for (const canvas of page.canvases) metadata.set(canvas.id, canvas);
        nextCursor = page.nextCursor;
      }
    } catch (failure) { if (active) error = errorMessage(failure); }
    if (!active) return;
    ready = true;
    loading = false;
    publish();
    let preferred: string | null = null;
    try { preferred = preferences?.getItem(preferenceKey) ?? null; } catch { /* Optional preference. */ }
    const target = snapshot.documents.find((document) => document.id === preferred) ?? snapshot.documents[0];
    if (target) { try { await selectCanvas(target.id); } catch { /* selectCanvas preserves the recoverable load error. */ } }
  }
  function dispose() {
    if (!active) return;
    active = false;
    abort.abort();
    unsubscribeJobs?.();
    for (const entry of entries.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      for (const preparation of entry.preparations.values()) preparation.abort.abort();
      entry.references.dispose();
      entry.invalidated = true;
    }
    entries.clear();
    loads.clear();
    metadata.clear();
    listeners.clear();
    snapshot = emptyCanvasControllerSnapshot({ ownerId: options.ownerId, enabled: options.enabled, readOnly });
    store?.close();
  }

  const { runNode, retryTransport } = createCanvasRunCommands({
    options, api, uuid, signal: abort.signal, getEntry, live, valid, preparationLive,
    ensureShell, flushEntry, touch, publish, receiveJob, applySubmission, recover,
    captureScene, inputRuntime, captures, reservations,
  });

  // Commands below intentionally address an explicit document, never whichever
  // canvas happens to be selected when an asynchronous response arrives.
  const controller = {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start,
    dispose,
    newCanvas,
    selectCanvas,
    loadMore,
    renameCanvas,
    saveCanvas,
    deleteCanvas,
    reloadAccountCanvas,
    runNode,
    retryTransport,
    setReadOnly(value: boolean) { if (readOnly !== value) { readOnly = value; publish(); } },
    setDefaults(parameters: CanvasGenerationParametersV1) { defaults = canvasGenerationParametersSchema.parse(parameters); },
    async registerCanvas(id: string) {
      const entry = getEntry(id, true);
      try { await ensureShell(entry); entry.error = null; publish(); }
      catch (failure) { if (live(entry)) { entry.error = errorMessage(failure); publish(); } throw failure; }
    },
    async recoverRuns(id: string) { const entry = getEntry(id); await recover(entry); },
    async refreshRuntime(id: string) { const entry = getEntry(id); await hydrate(entry); },
    async flushLocal(id?: string) {
      const targets = id ? [entries.get(id)].filter((entry): entry is Entry => Boolean(entry)) : [...entries.values()].filter((entry) => entry.loaded);
      const results = await Promise.all(targets.map(flushEntry));
      return results.every(Boolean);
    },
    addPrompt(id: string, position: CanvasPositionV1, text = "") {
      assertMutable();
      const nodeId = uuid();
      edit(id, { kind: "add", node: { id: nodeId, kind: "prompt", position: { ...position }, text } });
      return nodeId;
    },
    addGeneration(id: string, position: CanvasPositionV1) {
      assertMutable();
      const nodeId = uuid();
      edit(id, { kind: "add", node: { id: nodeId, kind: "generation", position: { ...position }, parameters: canvasGenerationParametersSchema.parse(defaults) } });
      return nodeId;
    },
    importReference(id: string, file: File, position: CanvasPositionV1) {
      assertMutable();
      const original = originalFile(file);
      const nodeId = uuid();
      edit(id, { kind: "add", node: { id: nodeId, kind: "reference", position: { ...position }, source: { kind: "local", blobId: original.blobId, uploadId: original.uploadId } } }, original);
      return nodeId;
    },
    replaceReference(id: string, nodeId: string, file: File) {
      assertMutable();
      const original = originalFile(file);
      edit(id, { kind: "reference", nodeId, source: { kind: "local", blobId: original.blobId, uploadId: original.uploadId } }, original);
    },
    reuseReference(id: string, sourceNodeId: string, position: CanvasPositionV1) {
      const entry = getEntry(id, true);
      const source = entry.envelope.scene.nodes.find((node) => node.id === sourceNodeId);
      if (source?.kind !== "reference") throw new CanvasContractError("CANVAS_INVALID_CONNECTION");
      const nodeId = uuid();
      edit(id, { kind: "add", node: { ...source, id: nodeId, source: { ...source.source }, position: { ...position } } });
      return nodeId;
    },
    moveNode(id: string, nodeId: string, position: CanvasPositionV1) { edit(id, { kind: "move", nodeId, position }); },
    updatePrompt(id: string, nodeId: string, text: string) { edit(id, { kind: "prompt", nodeId, text }); },
    updateParameters(id: string, nodeId: string, patch: Partial<CanvasGenerationParametersV1>) {
      const entry = getEntry(id, true);
      const node = entry.envelope.scene.nodes.find((value) => value.id === nodeId);
      if (node?.kind !== "generation") throw new CanvasContractError("CANVAS_INVALID_CONNECTION");
      const parameters = canvasGenerationParametersSchema.safeParse({ ...node.parameters, ...patch });
      if (!parameters.success) throw new CanvasContractError("CANVAS_INVALID_INPUT");
      edit(id, { kind: "parameters", nodeId, parameters: parameters.data });
    },
    removeNode(id: string, nodeId: string) { edit(id, { kind: "remove", nodeId }); },
    connect(id: string, source: string, target: string) {
      const entry = getEntry(id, true);
      const node = entry.envelope.scene.nodes.find((value) => value.id === source);
      if (node?.kind === "result" && entry.images.get(node.imageId)?.jobId !== node.jobId) throw new CanvasContractError("CANVAS_INPUT_UNAVAILABLE");
      const edgeId = uuid();
      edit(id, { kind: "connect", id: edgeId, source, target });
      return edgeId;
    },
    disconnect(id: string, edgeId: string) { edit(id, { kind: "disconnect", edgeId }); },
    replaceConnection(id: string, edgeId: string, source: string) {
      const entry = getEntry(id, true);
      const node = entry.envelope.scene.nodes.find((value) => value.id === source);
      if (node?.kind === "result") {
        const image = entry.images.get(node.imageId);
        if (!image || image.id !== node.imageId || image.jobId !== node.jobId || !image.url) throw new CanvasContractError("CANVAS_INPUT_UNAVAILABLE");
      }
      if (node?.kind === "reference") {
        const captured = captureCanvasReference(node, entry.originals);
        const assetId = captured.original?.assetId ?? (node.source.kind === "imported" ? node.source.assetId : null);
        const asset = assetId ? entry.assets.get(assetId) : null;
        if (!captured.original && (asset?.state !== "READY" || !asset.url)) throw new CanvasContractError("CANVAS_INPUT_UNAVAILABLE");
      }
      edit(id, { kind: "replace-connection", edgeId, source });
    },
    reorderInputs(id: string, nodeId: string, sourceIds: string[]) { edit(id, { kind: "reorder", nodeId, sourceIds: sourceIds.slice() }); },
    selectNode(id: string, nodeId: string | null) {
      const entry = getEntry(id);
      if (nodeId !== null && !entry.envelope.scene.nodes.some((node) => node.id === nodeId)) throw new CanvasContractError("CANVAS_INVALID_CONNECTION");
      if (entry.selectedNodeId === nodeId) return;
      entry.selectedNodeId = nodeId;
      publish();
    },
    setViewport(id: string, viewport: CanvasViewportV1) {
      const entry = getEntry(id);
      const parsed = canvasViewportSchema.safeParse(viewport);
      if (!parsed.success) throw new CanvasContractError("CANVAS_INVALID_INPUT");
      if (entry.camera.x === parsed.data.x && entry.camera.y === parsed.data.y && entry.camera.zoom === parsed.data.zoom) return;
      entry.camera = parsed.data;
      if (readOnly || entry.deleting) publish(); else changeScene(entry, { ...entry.envelope.scene, viewport: parsed.data });
    },
    acquirePreview(id: string, nodeId: string): CanvasPreviewLease | null {
      const entry = getEntry(id);
      const node = entry.envelope.scene.nodes.find((value) => value.id === nodeId);
      const original = node?.kind === "reference" ? captureCanvasReference(node, entry.originals).original : null;
      return original ? entry.references.preview(original.blobId) : null;
    },
  };
  return controller;
}

export type CanvasController = ReturnType<typeof createCanvasController>;
