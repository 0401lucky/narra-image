import {
  CANVAS_LIMITS, CanvasContractError, normalizeCanvasRunParametersV1,
  type CanvasLocalRunProjectionV1, type CanvasLocalSceneV1,
  type CanvasRunOutboxEntryV1, type CanvasRunProjectionV1,
} from "@/lib/canvas/contracts";
import { assertCanvasOutputCapacityV1, resolveCanvasRunProjectionV1, type CanvasInputRuntimeV1 } from "@/lib/canvas/graph";
import { canvasLocalRunProjectionSchema } from "@/lib/validators";

import type { GenerationItem } from "../types";
import type { CanvasClientApi, CanvasSubmissionResult } from "./client-api";
import type { CanvasCapacityReservation } from "./commands";
import {
  CanvasCommandError, canvasControllerErrorMessage as errorMessage,
  type CanvasControllerEntry as Entry, type CanvasPreparation as Preparation,
  type CanvasControllerOptions,
} from "./controller-types";
import type { CanvasDraftEnvelopeV1 } from "./draft-types";
import type { CanvasReferenceCapture } from "./reference-runtime";
import type { AcquireCanvasTransientLease, CanvasJobOrigin } from "./studio-bridge";

type CanvasRunCommandContext = {
  options: Pick<CanvasControllerOptions, "ownerId" | "jobs" | "acquireTransientLease">;
  api: CanvasClientApi;
  uuid: () => string;
  signal: AbortSignal;
  getEntry: (id: string, mutation?: boolean) => Entry;
  live: (entry: Entry) => boolean;
  valid: (entry: Entry) => boolean;
  preparationLive: (entry: Entry, preparation: Preparation) => boolean;
  ensureShell: (entry: Entry) => Promise<void>;
  flushEntry: (entry: Entry) => Promise<boolean>;
  touch: (entry: Entry, envelope?: CanvasDraftEnvelopeV1) => void;
  publish: () => void;
  receiveJob: (origin: CanvasJobOrigin, job: GenerationItem) => void;
  applySubmission: (entry: Entry, preparation: Preparation, response: CanvasSubmissionResult) => void;
  recover: (entry: Entry) => Promise<void>;
  captureScene: (entry: Entry) => CanvasLocalSceneV1;
  inputRuntime: (entry: Entry) => CanvasInputRuntimeV1;
  captures: (entry: Entry, scene: CanvasLocalSceneV1) => Map<string, CanvasReferenceCapture>;
  reservations: (entry: Entry) => CanvasCapacityReservation[];
};

// Only these two explicit commands can reach api.submit. Recovery, editing and
// canonical job notifications are deliberately outside this transport owner.
export function createCanvasRunCommands(context: CanvasRunCommandContext) {
  const { options, api, uuid, signal, getEntry, live, valid, preparationLive,
    ensureShell, flushEntry, touch, publish, receiveJob, applySubmission, recover,
    captureScene, inputRuntime, captures, reservations } = context;
  async function resolveRun(entry: Entry, projection: CanvasLocalRunProjectionV1, originals: Map<string, CanvasReferenceCapture>): Promise<CanvasRunProjectionV1> {
    const references: CanvasRunProjectionV1["references"] = [];
    for (const reference of projection.references) {
      if (reference.kind === "result") { references.push({ ...reference }); continue; }
      const capture = originals.get(reference.sourceNodeId);
      if (!capture) throw new CanvasContractError("CANVAS_INPUT_UNAVAILABLE");
      const asset = await entry.references.resolve(capture);
      references.push({ kind: "imported", sourceNodeId: reference.sourceNodeId, ordinal: reference.ordinal, assetId: asset.id });
    }
    const resolved = { ...projection, prompt: { ...projection.prompt }, params: { ...projection.params }, references };
    if (!canvasLocalRunProjectionSchema.safeParse(resolved).success) throw new CanvasContractError("CANVAS_INVALID_INPUT");
    return resolved;
  }
  function frozenTransportProjection(item: CanvasRunOutboxEntryV1): CanvasRunProjectionV1 {
    if (item.projection.references.some((reference) => reference.kind === "local")) throw new CanvasContractError("CANVAS_INPUT_UNAVAILABLE");
    return JSON.parse(JSON.stringify(item.projection)) as CanvasRunProjectionV1;
  }
  async function submit(entry: Entry, preparation: Preparation, projection: CanvasRunProjectionV1, reason: "run" | "transport-retry") {
    let lease: Awaited<ReturnType<AcquireCanvasTransientLease>> = null;
    let sent = false;
    try {
      if (!preparationLive(entry, preparation)) throw new CanvasContractError("CANVAS_DELETED");
      if (!await flushEntry(entry)) throw new CanvasCommandError("storage");
      if (!preparationLive(entry, preparation)) throw new CanvasContractError("CANVAS_DELETED");
      lease = await options.acquireTransientLease({ origin: preparation.origin, parameters: { ...projection.params }, reason, signal: preparation.abort.signal });
      if (!lease) throw new CanvasCommandError("cancelled");
      if (!preparationLive(entry, preparation)) throw new CanvasContractError("CANVAS_DELETED");
      const current = entry.envelope.outbox.find((item) => item.runId === preparation.origin.runId);
      if (current?.phase === "accepted") return;
      preparation.phase = "submitting";
      touch(entry, { ...entry.envelope, outbox: entry.envelope.outbox.map((item): CanvasRunOutboxEntryV1 => item.runId === preparation.origin.runId ? { ...item, phase: "uncertain", jobId: null } : item) });
      if (!await flushEntry(entry)) throw new CanvasCommandError("storage");
      if (!preparationLive(entry, preparation)) throw new CanvasContractError("CANVAS_DELETED");
      sent = true;
      const response = await api.submit(projection, lease.fields, signal);
      applySubmission(entry, preparation, response);
      if (live(entry)) await flushEntry(entry);
    } catch (failure) {
      if (live(entry)) {
        entry.runErrors.set(preparation.origin.runId, errorMessage(failure));
        if (!sent && failure instanceof CanvasCommandError && failure.code === "cancelled") {
          touch(entry, { ...entry.envelope, outbox: entry.envelope.outbox.map((item): CanvasRunOutboxEntryV1 => item.runId === preparation.origin.runId ? { ...item, phase: "rejected", jobId: null } : item) });
        }
        publish();
      }
      throw failure;
    } finally { lease?.release(); }
  }
  async function runNode(canvasId: string, nodeId: string): Promise<string> {
    const entry = getEntry(canvasId, true);
    for (const binding of entry.envelope.scene.runBindings.filter((item) => item.nodeId === nodeId)) {
      const job = options.jobs.read(binding.jobId);
      if (job) receiveJob({ ownerId: options.ownerId, canvasId, nodeId, runId: binding.runId }, job);
    }
    const held = reservations(entry);
    if (held.some((item) => item.nodeId === nodeId && !item.outputsHandled)) throw new CanvasContractError("CANVAS_NODE_BUSY");
    if (entry.envelope.outbox.filter((item) => item.nodeId !== nodeId).length >= CANVAS_LIMITS.sceneNodes) throw new CanvasContractError("CANVAS_LIMIT_EXCEEDED");
    const origin = Object.freeze({ ownerId: options.ownerId, canvasId, nodeId, runId: uuid() });
    const scene = captureScene(entry);
    // Capture the coherent direct-input scene and original identities before
    // shell creation, upload, challenge acquisition, or any asynchronous work.
    const projection = resolveCanvasRunProjectionV1(scene, { canvasId, nodeId, runId: origin.runId }, inputRuntime(entry)).projection;
    const originals = captures(entry, scene);
    const count = normalizeCanvasRunParametersV1(projection.params, projection.references.length).count;
    assertCanvasOutputCapacityV1(entry.envelope.scene, held, { nodes: count, edges: count });
    const preparation: Preparation = { origin, epoch: entry.envelope.deletionEpoch, count, phase: "preparing", abort: new AbortController() };
    entry.preparations.set(origin.runId, preparation);
    publish();
    try {
      await ensureShell(entry);
      if (!preparationLive(entry, preparation)) throw new CanvasContractError("CANVAS_DELETED");
      const resolved = await resolveRun(entry, projection, originals);
      if (!preparationLive(entry, preparation)) throw new CanvasContractError("CANVAS_DELETED");
      const item: CanvasRunOutboxEntryV1 = { storageVersion: 1, ...origin, projection: resolved, phase: "prepared", jobId: null };
      touch(entry, { ...entry.envelope, outbox: [...entry.envelope.outbox.filter((value) => value.nodeId !== nodeId), item] });
      await submit(entry, preparation, resolved, "run");
      return origin.runId;
    } catch (failure) {
      if (live(entry)) { entry.error = errorMessage(failure); entry.runErrors.set(origin.runId, errorMessage(failure)); publish(); }
      throw failure;
    } finally { entry.preparations.delete(origin.runId); preparation.abort.abort(); if (valid(entry)) publish(); }
  }
  async function retryTransport(canvasId: string, runId: string): Promise<void> {
    const entry = getEntry(canvasId, true);
    const item = entry.envelope.outbox.find((value) => value.runId === runId);
    if (!item) throw new CanvasContractError("CANVAS_RUN_NOT_FOUND");
    if (item.phase === "accepted") { await recover(entry); return; }
    if (item.phase === "rejected") throw new CanvasContractError("CANVAS_RUN_REJECTED");
    if (!entry.envelope.scene.nodes.some((node) => node.id === item.nodeId && node.kind === "generation")) throw new CanvasContractError("CANVAS_INVALID_CONNECTION");
    if ([...entry.preparations.values()].some((value) => value.origin.nodeId === item.nodeId)) throw new CanvasContractError("CANVAS_NODE_BUSY");
    const projection = frozenTransportProjection(item);
    const preparation: Preparation = { origin: Object.freeze({ ownerId: options.ownerId, canvasId, nodeId: item.nodeId, runId }), epoch: entry.envelope.deletionEpoch,
      count: normalizeCanvasRunParametersV1(projection.params, projection.references.length).count, phase: "preparing", abort: new AbortController() };
    entry.preparations.set(runId, preparation);
    publish();
    try { await submit(entry, preparation, projection, "transport-retry"); }
    finally { entry.preparations.delete(runId); preparation.abort.abort(); if (valid(entry)) publish(); }
  }

  return { runNode, retryTransport };
}
