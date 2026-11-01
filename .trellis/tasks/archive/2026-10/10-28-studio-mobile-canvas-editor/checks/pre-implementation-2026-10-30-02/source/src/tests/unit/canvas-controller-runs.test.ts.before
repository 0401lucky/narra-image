import { afterEach, describe, expect, it, vi } from "vitest";

import { CanvasContractError, type CanvasRunSubmissionDtoV1 } from "@/lib/canvas/contracts";
import { CanvasTransportError, createCanvasClientApi } from "@/components/create/canvas/client-api";
import { createCanvasController, type CanvasController, type CanvasControllerOptions } from "@/components/create/canvas/controller";
import { CanvasDraftStoreError } from "@/components/create/canvas/draft-types";
import type { AcquireCanvasTransientLease, CanvasTransientLease } from "@/components/create/canvas/studio-bridge";

import { canvasControllerFixture, canvasUuid, completedJob, createFakeCanvasJobs, createFakeCanvasStore, deferred } from "./helpers/canvas-controller-fixtures";

const controllers: CanvasController[] = [];
function fixture(options: Partial<CanvasControllerOptions> = {}) {
  const result = canvasControllerFixture(options);
  controllers.push(result.controller);
  return result;
}
function file(name = "reference.png", content = "png") { return new File([content], name, { type: "image/png", lastModified: 1 }); }
afterEach(() => { for (const controller of controllers.splice(0)) controller.dispose(); vi.useRealTimers(); });

describe("canvas direct Run and recovery", () => {
  it("graph edits/connect/reorder/reuse never submit anything and keep direct input order", async () => {
    const f = fixture();
    const { canvasId, promptId, nodeId } = await f.newGraph();
    const first = f.controller.importReference(canvasId, file("first.png"), { x: 0, y: 0 });
    const second = f.controller.importReference(canvasId, file("second.png"), { x: -40, y: -100 });
    const edge = f.controller.connect(canvasId, second, nodeId);
    f.controller.connect(canvasId, first, nodeId);
    f.controller.reorderInputs(canvasId, nodeId, [first, second]);
    f.controller.moveNode(canvasId, first, { x: -1000, y: 500 });
    f.controller.updatePrompt(canvasId, promptId, "changed explicitly");
    expect(f.api.port.submit).not.toHaveBeenCalled();
    expect(f.api.port.upload).not.toHaveBeenCalled();
    f.controller.disconnect(canvasId, edge);
    expect(f.controller.getSnapshot().active?.scene.edges.filter((item) => item.kind === "image-input")).toMatchObject([{ source: first, ordinal: 1 }]);
    expect(() => f.controller.connect(canvasId, first, nodeId)).toThrow(expect.objectContaining({ code: "CANVAS_DUPLICATE_INPUT" }));
    expect(() => f.controller.connect(canvasId, nodeId, nodeId)).toThrow(expect.objectContaining({ code: "CANVAS_INVALID_CONNECTION" }));
    const secondPrompt = f.controller.addPrompt(canvasId, { x: 0, y: 0 }, "another");
    expect(() => f.controller.connect(canvasId, secondPrompt, nodeId)).toThrow(expect.objectContaining({ code: "CANVAS_DUPLICATE_INPUT" }));
  });

  it("freezes one node's prompt/parameters/ordered originals before asynchronous upload", async () => {
    const f = fixture();
    const { canvasId, promptId, nodeId } = await f.newGraph();
    f.controller.updateParameters(canvasId, nodeId, { count: 4, model: "original-model" });
    const reference = f.controller.importReference(canvasId, file("original.png"), { x: 0, y: 0 });
    f.controller.connect(canvasId, reference, nodeId);
    const gate = deferred<void>();
    const upload = vi.mocked(f.api.port.upload).getMockImplementation()!;
    vi.mocked(f.api.port.upload).mockImplementationOnce(async (...args) => { await gate.promise; return upload(...args); });
    const running = f.controller.runNode(canvasId, nodeId);
    await vi.waitFor(() => expect(f.api.port.upload).toHaveBeenCalled());
    f.controller.updatePrompt(canvasId, promptId, "after click");
    f.controller.updateParameters(canvasId, nodeId, { count: 2, model: "later-model" });
    f.controller.replaceReference(canvasId, reference, file("replacement.png", "new"));
    const other = await f.controller.newCanvas();
    gate.resolve();
    const runId = await running;
    expect(f.controller.getSnapshot().activeCanvasId).toBe(other);
    expect(f.controller.getSnapshot().active?.scene.nodes).toHaveLength(0);
    const request = vi.mocked(f.api.port.submit).mock.calls[0][0];
    expect(request).toMatchObject({ canvasId, nodeId, runId, prompt: { sourceNodeId: promptId, text: "frozen prompt" }, params: { count: 4, model: "original-model" }, references: [{ sourceNodeId: reference, ordinal: 1, kind: "imported" }] });
    expect(vi.mocked(f.api.port.upload).mock.calls[0][0].fileName).toBe("original.png");
    await f.controller.selectCanvas(canvasId);
    expect(f.controller.getSnapshot().active?.scene.nodes.find((node) => node.id === promptId)).toMatchObject({ text: "after click" });
    expect(f.controller.getSnapshot().active?.reservations).toMatchObject([{ count: 1, runId }]);
    const leaseInput = f.acquireTransientLease.mock.calls[0] as unknown as [Parameters<AcquireCanvasTransientLease>[0]];
    expect(leaseInput[0]).toMatchObject({ origin: { ownerId: "owner-one", canvasId, nodeId, runId }, parameters: { model: "original-model" }, reason: "run" });
    expect(f.release).toHaveBeenCalledTimes(1);
  });

  it("Save and Run share one stable upload promise for an unchanged original", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    const reference = f.controller.importReference(canvasId, file(), { x: 0, y: 0 });
    f.controller.connect(canvasId, reference, nodeId);
    const gate = deferred<void>();
    const upload = vi.mocked(f.api.port.upload).getMockImplementation()!;
    vi.mocked(f.api.port.upload).mockImplementationOnce(async (...args) => { await gate.promise; return upload(...args); });
    const saving = f.controller.saveCanvas(canvasId);
    const running = f.controller.runNode(canvasId, nodeId);
    await vi.waitFor(() => expect(f.api.port.upload).toHaveBeenCalledTimes(1));
    gate.resolve();
    await Promise.all([saving, running]);
    const sceneAsset = f.api.documents.get(canvasId)?.scene?.nodes.find((node) => node.kind === "reference");
    const runAsset = vi.mocked(f.api.port.submit).mock.calls[0][0].references[0];
    expect(sceneAsset).toMatchObject({ source: { kind: "imported", assetId: runAsset.kind === "imported" ? runAsset.assetId : "invalid" } });
    expect(f.api.port.upload).toHaveBeenCalledTimes(1);
  });

  it("Run uploads only its direct references, not unrelated disconnected imports", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    const used = f.controller.importReference(canvasId, file("used.png"), { x: 0, y: 0 });
    f.controller.importReference(canvasId, file("disconnected.png"), { x: 0, y: 100 });
    f.controller.connect(canvasId, used, nodeId);
    await f.controller.runNode(canvasId, nodeId);
    expect(vi.mocked(f.api.port.upload).mock.calls.map(([input]) => input.fileName)).toEqual(["used.png"]);
    expect(f.api.port.save).not.toHaveBeenCalled();
  });

  it("persists nonsecret exact outbox before the potentially billable POST", async () => {
    const acquire = vi.fn<AcquireCanvasTransientLease>(async () => ({ fields: { turnstileToken: "request-only-challenge", customProvider: { apiKey: "request-only-key", baseUrl: "https://provider.invalid", model: "custom-model" } }, release: vi.fn() }));
    const f = fixture({ acquireTransientLease: acquire });
    const { canvasId, nodeId } = await f.newGraph();
    const submit = vi.mocked(f.api.port.submit).getMockImplementation()!;
    vi.mocked(f.api.port.submit).mockImplementationOnce(async (...args) => {
      const row = f.store.row("owner-one", canvasId)!;
      expect(row.envelope.outbox).toMatchObject([{ phase: "uncertain", jobId: null, projection: args[0] }]);
      const durable = JSON.stringify(row.envelope);
      expect(durable).not.toMatch(/request-only|apiKey|turnstileToken|baseUrl|blob:|https:/);
      expect(args[1]).toMatchObject({ turnstileToken: "request-only-challenge" });
      return submit(...args);
    });
    const runId = await f.controller.runNode(canvasId, nodeId);
    const row = f.store.row("owner-one", canvasId)!;
    expect(row.envelope.outbox).toMatchObject([{ phase: "accepted", runId }]);
    expect(row.envelope.scene.runBindings).toMatchObject([{ runId, jobId: row.envelope.outbox[0].jobId, outputsHandled: false }]);
  });

  it("a storage failure blocks billing, preserves memory, and allows only exact retry after recovery", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    f.store.setFailure(new CanvasDraftStoreError("quota"));
    await expect(f.controller.runNode(canvasId, nodeId)).rejects.toMatchObject({ code: "storage" });
    expect(f.api.port.submit).not.toHaveBeenCalled();
    expect(f.acquireTransientLease).not.toHaveBeenCalled();
    expect(f.controller.getSnapshot().active?.scene.nodes).toHaveLength(2);
    const runId = f.controller.getSnapshot().active!.runs[0].runId;
    f.store.setFailure(null);
    await f.controller.retryTransport(canvasId, runId);
    expect(f.api.port.submit).toHaveBeenCalledTimes(1);
    expect(vi.mocked(f.api.port.submit).mock.calls[0][0].runId).toBe(runId);
  });

  it("unknown acceptance retains exact assets/intent; explicit retry never resolves newer inputs", async () => {
    const f = fixture();
    const { canvasId, promptId, nodeId } = await f.newGraph();
    const reference = f.controller.importReference(canvasId, file(), { x: 0, y: 0 });
    f.controller.connect(canvasId, reference, nodeId);
    const submit = vi.mocked(f.api.port.submit).getMockImplementation()!;
    vi.mocked(f.api.port.submit).mockImplementationOnce(async (...args) => { await submit(...args); throw new CanvasTransportError(); });
    await expect(f.controller.runNode(canvasId, nodeId)).rejects.toBeInstanceOf(CanvasTransportError);
    const row = f.store.row("owner-one", canvasId)!;
    const runId = row.envelope.outbox[0].runId;
    expect(row.envelope.outbox[0]).toMatchObject({ phase: "uncertain", jobId: null });
    f.controller.updatePrompt(canvasId, promptId, "do not retry this text");
    f.controller.replaceReference(canvasId, reference, file("later.png", "new"));
    f.controller.updateParameters(canvasId, nodeId, { model: "later-model" });
    f.api.assets.clear();
    await expect(f.controller.runNode(canvasId, nodeId)).rejects.toMatchObject({ code: "CANVAS_NODE_BUSY" });
    await f.controller.retryTransport(canvasId, runId);
    expect(vi.mocked(f.api.port.submit).mock.calls[1][0]).toEqual(vi.mocked(f.api.port.submit).mock.calls[0][0]);
    expect(f.api.port.upload).toHaveBeenCalledTimes(1);
    expect(f.api.port.asset).not.toHaveBeenCalled();
    expect(f.api.runs.size).toBe(1);
    expect(f.controller.getSnapshot().active?.scene.runBindings).toMatchObject([{ runId }]);
    expect(f.release).toHaveBeenCalledTimes(2);
  });

  it("a real transport timeout releases the run guard but preserves exact retry and ignores late ACKs", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const { canvasId, promptId, nodeId } = await f.newGraph();
    const first = deferred<Response>();
    const retry = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>().mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
    vi.mocked(f.api.port.submit).mockImplementation(createCanvasClientApi(fetcher).submit);
    const running = f.controller.runNode(canvasId, nodeId).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const captured = f.store.row("owner-one", canvasId)!.envelope.outbox[0];
    const origin = { canvasId, nodeId, runId: captured.runId, jobId: "timeout-job" };
    const accepted = { generation: completedJob(origin.jobId), canvasRun: origin };
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await running).toBeInstanceOf(CanvasTransportError);
    expect(f.controller.getSnapshot().active?.runs).toMatchObject([{ runId: captured.runId, phase: "uncertain" }]);
    expect(f.release).toHaveBeenCalledTimes(1);
    f.controller.updatePrompt(canvasId, promptId, "newer unsaved prompt");
    const selected = await f.controller.newCanvas();
    await expect(f.controller.runNode(canvasId, nodeId)).rejects.toMatchObject({ code: "CANVAS_NODE_BUSY" });
    const retrying = f.controller.retryTransport(canvasId, captured.runId);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][1]?.body).toBe(fetcher.mock.calls[0][1]?.body);
    first.resolve(Response.json({ data: accepted }));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.jobs.jobs.size).toBe(0);
    expect(f.store.row("owner-one", canvasId)!.envelope.scene.runBindings).toEqual([]);
    retry.resolve(Response.json({ data: accepted }));
    await retrying;
    expect(f.release).toHaveBeenCalledTimes(2);
    expect(f.controller.getSnapshot().activeCanvasId).toBe(selected);
    expect(f.controller.getSnapshot().active?.scene.nodes).toEqual([]);
    await f.controller.selectCanvas(canvasId);
    expect(f.controller.getSnapshot().active?.scene.runBindings).toMatchObject([{ runId: captured.runId, jobId: origin.jobId, outputsHandled: true }]);
    expect(f.controller.getSnapshot().active?.scene.nodes.find((node) => node.id === promptId)).toMatchObject({ text: "newer unsaved prompt" });
    expect(f.jobs.jobs.size).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("same-browser reload recovers uncertain run by read-only lookup and no new POST", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    const submit = vi.mocked(f.api.port.submit).getMockImplementation()!;
    vi.mocked(f.api.port.submit).mockImplementationOnce(async (...args) => { await submit(...args); throw new CanvasTransportError(); });
    await expect(f.controller.runNode(canvasId, nodeId)).rejects.toBeInstanceOf(CanvasTransportError);
    await f.controller.flushLocal();
    f.controller.dispose();
    const newJobs = createFakeCanvasJobs();
    const reopened = createCanvasController({ ...f.options, jobs: newJobs.port });
    controllers.push(reopened);
    await reopened.start();
    expect(f.api.port.lookup).toHaveBeenCalledTimes(1);
    expect(f.api.port.submit).toHaveBeenCalledTimes(1);
    expect(reopened.getSnapshot().active?.scene.runBindings).toHaveLength(1);
    expect(reopened.getSnapshot().active?.runs[0].phase).toBe("pending");
    expect(newJobs.jobs.size).toBe(1);
  });

  it("PREPARING or unknown lookup never proves failure or automatically resubmits", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    vi.mocked(f.api.port.submit).mockImplementationOnce(async (projection) => ({ state: "PREPARING", origin: { canvasId, nodeId, runId: projection.runId }, retryAfterMs: 1000 }));
    const runId = await f.controller.runNode(canvasId, nodeId);
    expect(f.controller.getSnapshot().active?.runs[0]).toMatchObject({ runId, phase: "uncertain" });
    await f.controller.recoverRuns(canvasId);
    expect(f.controller.getSnapshot().active?.runs[0]).toMatchObject({ runId, phase: "uncertain" });
    expect(f.api.port.submit).toHaveBeenCalledTimes(1);
    expect(f.controller.getSnapshot().active?.scene.runBindings).toHaveLength(0);
  });

  it("definitive rejected runs allow a fresh manual ID but not a same-key retry", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    vi.mocked(f.api.port.submit).mockImplementationOnce(async (projection) => ({ state: "REJECTED", origin: { canvasId, nodeId, runId: projection.runId }, code: "CANVAS_RUN_REJECTED" }));
    const rejectedId = await f.controller.runNode(canvasId, nodeId);
    await expect(f.controller.retryTransport(canvasId, rejectedId)).rejects.toMatchObject({ code: "CANVAS_RUN_REJECTED" });
    const nextId = await f.controller.runNode(canvasId, nodeId);
    expect(nextId).not.toBe(rejectedId);
    expect(f.api.port.submit).toHaveBeenCalledTimes(2);
  });

  it("reserves original output count during edits and before restored canonical hydration", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    f.controller.updateParameters(canvasId, nodeId, { count: 4 });
    for (let index = 0; index < 194; index += 1) f.controller.addPrompt(canvasId, { x: index, y: 0 });
    await f.controller.runNode(canvasId, nodeId);
    f.controller.updateParameters(canvasId, nodeId, { count: 1 });
    expect(() => f.controller.addPrompt(canvasId, { x: 0, y: 0 })).toThrow(expect.objectContaining({ code: "CANVAS_OUTPUT_CAPACITY_EXCEEDED" }));
    await f.controller.flushLocal();
    f.controller.dispose();
    const gate = deferred<void>();
    const resolve = vi.mocked(f.api.port.resolve).getMockImplementation()!;
    vi.mocked(f.api.port.resolve).mockImplementationOnce(async (...args) => { await gate.promise; return resolve(...args); });
    const jobs = createFakeCanvasJobs();
    // Simulate a cloud-snapshot binding with no local frozen outbox authority.
    f.store.row("owner-one", canvasId)!.envelope.outbox = [];
    const reopened = createCanvasController({ ...f.options, jobs: jobs.port, uuid: () => canvasUuid(9999) });
    controllers.push(reopened);
    const starting = reopened.start();
    await vi.waitFor(() => expect(reopened.getSnapshot().active?.hydrating).toBe(true));
    expect(reopened.getSnapshot().active?.reservations[0].count).toBeNull();
    expect(() => reopened.addPrompt(canvasId, { x: 0, y: 0 })).toThrow(expect.objectContaining({ code: "CANVAS_OUTPUT_CAPACITY_EXCEEDED" }));
    gate.resolve();
    await starting;
    expect(reopened.getSnapshot().active?.reservations[0].count).toBe(4);
    expect(() => reopened.addPrompt(canvasId, { x: 0, y: 0 })).toThrow(expect.objectContaining({ code: "CANVAS_OUTPUT_CAPACITY_EXCEEDED" }));
  });

  it("restores capacity and node admission for an accepted outbox whose attachment was paused by Delete", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    f.controller.updateParameters(canvasId, nodeId, { count: 4 });
    for (let index = 0; index < 194; index += 1) f.controller.addPrompt(canvasId, { x: index, y: 0 });
    const ack = deferred<void>();
    const remove = deferred<{ id: string; deleted: true; revision: number }>();
    const submit = vi.mocked(f.api.port.submit).getMockImplementation()!;
    vi.mocked(f.api.port.submit).mockImplementationOnce(async (...args) => { const response = await submit(...args); await ack.promise; return response; });
    vi.mocked(f.api.port.delete).mockImplementationOnce(() => remove.promise);
    const running = f.controller.runNode(canvasId, nodeId);
    await vi.waitFor(() => expect(f.api.port.submit).toHaveBeenCalled());
    f.controller.updateParameters(canvasId, nodeId, { count: 1 });
    const deleting = f.controller.deleteCanvas(canvasId, true).catch((error: unknown) => error);
    await vi.waitFor(() => expect(f.api.port.delete).toHaveBeenCalled());
    ack.resolve();
    const runId = await running;
    const saved = f.store.row("owner-one", canvasId)!;
    expect(saved.envelope.outbox).toMatchObject([{ phase: "accepted", runId }]);
    expect(saved.envelope.scene.runBindings).toEqual([]);
    f.controller.dispose();
    remove.reject(new CanvasTransportError());
    await deleting;
    const gate = deferred<void>();
    const lookup = vi.mocked(f.api.port.lookup).getMockImplementation()!;
    vi.mocked(f.api.port.lookup).mockImplementationOnce(async (...args) => { await gate.promise; return lookup(...args); });
    const jobs = createFakeCanvasJobs();
    let sequence = 9000;
    const reopened = createCanvasController({ ...f.options, jobs: jobs.port, uuid: () => canvasUuid(++sequence) });
    controllers.push(reopened);
    const starting = reopened.start();
    await vi.waitFor(() => expect(f.api.port.lookup).toHaveBeenCalledWith(runId, expect.any(AbortSignal)));
    expect(reopened.getSnapshot().active?.reservations).toMatchObject([{ runId, nodeId, count: 4, outputsHandled: false }]);
    await expect(reopened.runNode(canvasId, nodeId)).rejects.toMatchObject({ code: "CANVAS_NODE_BUSY" });
    expect(() => reopened.addPrompt(canvasId, { x: 0, y: 0 })).toThrow(expect.objectContaining({ code: "CANVAS_OUTPUT_CAPACITY_EXCEEDED" }));
    gate.resolve();
    await starting;
    const binding = reopened.getSnapshot().active!.scene.runBindings[0];
    jobs.push({ ownerId: "owner-one", canvasId, nodeId, runId }, completedJob(binding.jobId, 4));
    expect(reopened.getSnapshot().active?.scene.nodes.filter((node) => node.kind === "result")).toHaveLength(4);
    expect(reopened.getSnapshot().active?.scene.runBindings[0].outputsHandled).toBe(true);
    expect(f.api.port.submit).toHaveBeenCalledTimes(1);
  });

  it("terminal complete batches and accepted outbox/binding commit atomically, once", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    f.controller.updateParameters(canvasId, nodeId, { count: 2 });
    const submit = vi.mocked(f.api.port.submit).getMockImplementation()!;
    vi.mocked(f.api.port.submit).mockImplementationOnce(async (...args) => {
      const response = await submit(...args) as CanvasRunSubmissionDtoV1;
      return { ...response, generation: completedJob(response.generation.id, 2) };
    });
    const runId = await f.controller.runNode(canvasId, nodeId);
    const row = f.store.row("owner-one", canvasId)!;
    expect(row.envelope.outbox).toMatchObject([{ phase: "accepted", runId }]);
    expect(row.envelope.scene.runBindings).toMatchObject([{ runId, outputsHandled: true }]);
    expect(row.envelope.scene.nodes.filter((node) => node.kind === "result")).toHaveLength(2);
    for (const [input] of vi.mocked(f.store.port.commit).mock.calls) if (input.envelope.outbox[0]?.phase === "accepted") {
      expect(input.envelope.scene.runBindings[0].outputsHandled).toBe(true);
      expect(input.envelope.scene.nodes.filter((node) => node.kind === "result")).toHaveLength(2);
    }
    const binding = row.envelope.scene.runBindings[0];
    const origin = { ownerId: "owner-one", canvasId, nodeId, runId };
    f.jobs.push(origin, completedJob(binding.jobId, 2));
    expect(f.controller.getSnapshot().active?.scene.nodes.filter((node) => node.kind === "result")).toHaveLength(2);
  });

  it("deleted result cards remain suppressed after repeated terminal callbacks and reload", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    f.controller.updateParameters(canvasId, nodeId, { count: 2 });
    const runId = await f.controller.runNode(canvasId, nodeId);
    const binding = f.controller.getSnapshot().active!.scene.runBindings[0];
    const terminal = completedJob(binding.jobId, 2);
    const origin = { ownerId: "owner-one", canvasId, nodeId, runId };
    f.jobs.push(origin, terminal);
    f.api.runs.set(runId, { state: "COMMITTED", origin, jobId: terminal.id, generation: terminal, unavailable: null });
    f.controller.removeNode(canvasId, `result:${terminal.images[0].id}`);
    f.jobs.push(origin, terminal);
    await f.controller.flushLocal();
    expect(f.controller.getSnapshot().active?.scene.runBindings[0].outputsHandled).toBe(true);
    f.controller.dispose();
    const reopened = createCanvasController({ ...f.options, jobs: createFakeCanvasJobs().port });
    controllers.push(reopened);
    await reopened.start();
    expect(reopened.getSnapshot().active?.scene.nodes.filter((node) => node.kind === "result").map((node) => node.id)).toEqual([`result:${terminal.images[1].id}`]);
    expect(f.api.port.submit).toHaveBeenCalledTimes(1);
  });

  it("manual rerun uses a fresh ID and preserves older images/downstream connections, including feedback", async () => {
    const f = fixture();
    const { canvasId, nodeId, promptId } = await f.newGraph();
    const firstRun = await f.controller.runNode(canvasId, nodeId);
    const firstBinding = f.controller.getSnapshot().active!.scene.runBindings[0];
    const terminal = completedJob(firstBinding.jobId);
    f.jobs.push({ ownerId: "owner-one", canvasId, nodeId, runId: firstRun }, terminal);
    const resultId = `result:${terminal.images[0].id}`;
    const downstream = f.controller.addGeneration(canvasId, { x: 800, y: 0 });
    f.controller.connect(canvasId, promptId, downstream);
    const edgeId = f.controller.connect(canvasId, resultId, downstream);
    f.controller.connect(canvasId, resultId, nodeId);
    expect(f.api.port.submit).toHaveBeenCalledTimes(1);
    const secondRun = await f.controller.runNode(canvasId, nodeId);
    expect(secondRun).not.toBe(firstRun);
    const secondBinding = f.controller.getSnapshot().active!.scene.runBindings.find((value) => value.nodeId === nodeId)!;
    f.jobs.push({ ownerId: "owner-one", canvasId, nodeId, runId: secondRun }, completedJob(secondBinding.jobId));
    expect(f.controller.getSnapshot().active?.scene.nodes.filter((node) => node.kind === "result")).toHaveLength(2);
    expect(f.controller.getSnapshot().active?.scene.edges.find((edge) => edge.id === edgeId)).toMatchObject({ source: resultId, target: downstream });
    expect(vi.mocked(f.api.port.submit).mock.calls[1][0].references).toMatchObject([{ kind: "result", imageId: terminal.images[0].id, jobId: terminal.id }]);
    expect(f.api.port.upload).not.toHaveBeenCalled();
    expect(f.api.port.submit).toHaveBeenCalledTimes(2);
  });

  it("removing a generation during delayed ACK retains canonical job but never recreates its organization", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    const gate = deferred<void>();
    const submit = vi.mocked(f.api.port.submit).getMockImplementation()!;
    vi.mocked(f.api.port.submit).mockImplementationOnce(async (...args) => {
      const response = await submit(...args) as CanvasRunSubmissionDtoV1;
      await gate.promise;
      return { ...response, generation: completedJob(response.generation.id) };
    });
    const running = f.controller.runNode(canvasId, nodeId);
    await vi.waitFor(() => expect(f.api.port.submit).toHaveBeenCalled());
    f.controller.removeNode(canvasId, nodeId);
    gate.resolve();
    await running;
    expect(f.controller.getSnapshot().active?.scene.runBindings).toHaveLength(0);
    expect(f.controller.getSnapshot().active?.scene.nodes.map((node) => node.kind)).toEqual(["prompt"]);
    expect([...f.jobs.jobs.values()]).toMatchObject([{ status: "succeeded" }]);
    expect(f.api.port.delete).not.toHaveBeenCalled();
  });

  it("failed Delete catches up terminal ACK/cache exactly once without new POST", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    f.controller.updateParameters(canvasId, nodeId, { count: 2 });
    const ack = deferred<void>();
    const remove = deferred<{ id: string; deleted: true; revision: number }>();
    const submit = vi.mocked(f.api.port.submit).getMockImplementation()!;
    vi.mocked(f.api.port.submit).mockImplementationOnce(async (...args) => {
      const response = await submit(...args) as CanvasRunSubmissionDtoV1;
      const job = completedJob(response.generation.id, 2);
      f.api.runs.set(response.canvasRun.runId, { state: "COMMITTED", origin: response.canvasRun, jobId: job.id, generation: job, unavailable: null });
      await ack.promise;
      return { ...response, generation: job };
    });
    vi.mocked(f.api.port.delete).mockImplementationOnce(() => remove.promise);
    const running = f.controller.runNode(canvasId, nodeId);
    await vi.waitFor(() => expect(f.api.port.submit).toHaveBeenCalled());
    const deleting = f.controller.deleteCanvas(canvasId, true);
    const deletedOutcome = expect(deleting).rejects.toBeInstanceOf(CanvasTransportError);
    await vi.waitFor(() => expect(f.api.port.delete).toHaveBeenCalled());
    ack.resolve();
    await running;
    expect(f.controller.getSnapshot().active?.scene.nodes.filter((node) => node.kind === "result")).toHaveLength(0);
    expect(f.store.row("owner-one", canvasId)?.envelope.outbox[0].phase).toBe("accepted");
    remove.reject(new CanvasTransportError());
    await deletedOutcome;
    expect(f.controller.getSnapshot().active?.document.deleting).toBe(false);
    expect(f.controller.getSnapshot().active?.scene.nodes.filter((node) => node.kind === "result")).toHaveLength(2);
    expect(f.controller.getSnapshot().active?.scene.runBindings[0].outputsHandled).toBe(true);
    await f.controller.recoverRuns(canvasId);
    expect(f.controller.getSnapshot().active?.scene.nodes.filter((node) => node.kind === "result")).toHaveLength(2);
    expect(f.api.port.submit).toHaveBeenCalledTimes(1);
  });

  it("successful Delete rejects late attachments while preserving completed canonical jobs", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    const ack = deferred<void>();
    const submit = vi.mocked(f.api.port.submit).getMockImplementation()!;
    vi.mocked(f.api.port.submit).mockImplementationOnce(async (...args) => {
      const response = await submit(...args) as CanvasRunSubmissionDtoV1;
      await ack.promise;
      return { ...response, generation: completedJob(response.generation.id) };
    });
    const running = f.controller.runNode(canvasId, nodeId);
    await vi.waitFor(() => expect(f.api.port.submit).toHaveBeenCalled());
    await f.controller.deleteCanvas(canvasId, true);
    ack.resolve();
    await running;
    expect(f.controller.getSnapshot().documents).toHaveLength(0);
    expect([...f.jobs.jobs.values()]).toMatchObject([{ status: "succeeded" }]);
    expect(f.store.row("owner-one", canvasId)?.envelope.scene.nodes).toHaveLength(0);
  });

  it.each(["quota", "conflict"] as const)("does not restore deleted organization after a failed local %s tombstone and reload", async (code) => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    const runId = await f.controller.runNode(canvasId, nodeId);
    const binding = f.controller.getSnapshot().active!.scene.runBindings[0];
    const terminal = completedJob(binding.jobId);
    const origin = { canvasId, nodeId, runId };
    f.api.runs.set(runId, { state: "COMMITTED", origin, jobId: terminal.id, generation: terminal, unavailable: null });
    f.store.setFailure(new CanvasDraftStoreError(code));
    await f.controller.deleteCanvas(canvasId, true);
    expect(f.store.row("owner-one", canvasId)?.envelope.deletedAt).toBeNull();
    f.controller.dispose();
    f.store.setFailure(null);
    const jobs = createFakeCanvasJobs();
    // Server tombstone reconciliation is read-only with respect to the account,
    // and must also suppress stale organization on a phone.
    const reopened = createCanvasController({ ...f.options, jobs: jobs.port, readOnly: true });
    controllers.push(reopened);
    await reopened.start();
    expect(reopened.getSnapshot()).toMatchObject({ active: null, activeCanvasId: null, documents: [], loading: false });
    expect(f.store.row("owner-one", canvasId)?.envelope).toMatchObject({ scene: { nodes: [], runBindings: [] }, outbox: [] });
    expect(f.store.row("owner-one", canvasId)?.envelope.deletedAt).not.toBeNull();
    await expect(reopened.selectCanvas(canvasId)).rejects.toMatchObject({ code: "CANVAS_DELETED" });
    expect(f.api.port.lookup).not.toHaveBeenCalled();
    expect(f.api.port.resolve).not.toHaveBeenCalled();
    expect(f.api.port.submit).toHaveBeenCalledTimes(1);
    expect(f.api.port.delete).toHaveBeenCalledTimes(1);
    expect(f.api.runs.get(runId)).toMatchObject({ state: "COMMITTED", generation: terminal });
  });

  it.each([
    new CanvasTransportError(),
    new CanvasContractError("CANVAS_NOT_FOUND"),
    new CanvasContractError("CANVAS_INTERNAL_ERROR"),
  ])("does not infer a tombstone from an unavailable account read ($name)", async (failure) => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    await f.controller.runNode(canvasId, nodeId);
    const before = f.store.row("owner-one", canvasId)!.envelope;
    f.controller.dispose();
    vi.mocked(f.api.port.read).mockRejectedValueOnce(failure);
    const reopened = createCanvasController({ ...f.options, jobs: createFakeCanvasJobs().port });
    controllers.push(reopened);
    await reopened.start();
    expect(reopened.getSnapshot().active?.scene).toEqual(before.scene);
    expect(reopened.getSnapshot().active?.document.error).toBe(failure.message);
    await reopened.flushLocal();
    expect(f.store.row("owner-one", canvasId)?.envelope).toMatchObject({ deletedAt: null, outbox: before.outbox });
    expect(f.api.port.delete).not.toHaveBeenCalled();
    expect(f.api.port.submit).toHaveBeenCalledTimes(1);
  });

  it("keeps a confirmed-deleted source closed without force-overwriting a conflicting local writer", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    await f.controller.runNode(canvasId, nodeId);
    const before = f.store.row("owner-one", canvasId)!;
    f.api.deleted.add(canvasId);
    f.controller.dispose();
    f.store.setFailure(new CanvasDraftStoreError("conflict"));
    const reopened = createCanvasController({ ...f.options, jobs: createFakeCanvasJobs().port });
    controllers.push(reopened);
    await reopened.start();
    expect(reopened.getSnapshot()).toMatchObject({ active: null, activeCanvasId: null, documents: [] });
    expect(reopened.getSnapshot().warning).toBe(new CanvasDraftStoreError("conflict").message);
    expect(f.store.row("owner-one", canvasId)).toEqual(before);
    const lastWrite = vi.mocked(f.store.port.commit).mock.calls.at(-1)![0];
    expect(lastWrite.expected).toEqual(before.stamp);
    expect(f.api.port.lookup).not.toHaveBeenCalled();
    expect(f.api.port.delete).not.toHaveBeenCalled();
    expect(f.api.port.submit).toHaveBeenCalledTimes(1);
  });

  it("reconciles every saved terminal binding after hydration resolves the other runs' reserved counts", async () => {
    const f = fixture();
    const { canvasId, promptId, nodeId } = await f.newGraph();
    f.controller.updateParameters(canvasId, nodeId, { count: 2 });
    const otherNodeId = f.controller.addGeneration(canvasId, { x: 20, y: 400 });
    f.controller.connect(canvasId, promptId, otherNodeId);
    await f.controller.runNode(canvasId, nodeId);
    await f.controller.runNode(canvasId, otherNodeId);
    await f.controller.saveCanvas(canvasId);
    const bindings = f.controller.getSnapshot().active!.scene.runBindings;
    const expectedResults: string[] = [];
    for (const binding of bindings) {
      const terminal = completedJob(binding.jobId, binding.nodeId === nodeId ? 2 : 1);
      expectedResults.push(...terminal.images.map((image) => `result:${image.id}`));
      f.api.runs.set(binding.runId, { state: "COMMITTED", origin: { canvasId, nodeId: binding.nodeId, runId: binding.runId }, jobId: binding.jobId, generation: terminal, unavailable: null });
    }
    f.controller.dispose();
    // Another device has no local outbox from which to infer either output count.
    const reopened = createCanvasController({ ...f.options, store: createFakeCanvasStore().port, jobs: createFakeCanvasJobs().port, uuid: () => crypto.randomUUID() });
    controllers.push(reopened);
    await reopened.start();
    expect(reopened.getSnapshot().active?.scene.nodes.filter((node) => node.kind === "result").map((node) => node.id).sort()).toEqual(expectedResults.sort());
    expect(reopened.getSnapshot().active?.scene.runBindings.every((binding) => binding.outputsHandled)).toBe(true);
    expect(reopened.getSnapshot().active?.runs.every((run) => run.error === null)).toBe(true);
    const scene = reopened.getSnapshot().active!.scene;
    await reopened.refreshRuntime(canvasId);
    expect(reopened.getSnapshot().active?.scene).toEqual(scene);
    expect(f.api.port.submit).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["pending", "succeeded"], ["missing", "succeeded"], ["missing", "failed"],
  ] as const)("preserves a %s sibling reservation during %s hydration catch-up", async (state, terminalStatus) => {
    const f = fixture();
    const { canvasId, promptId, nodeId } = await f.newGraph();
    const otherNodeId = f.controller.addGeneration(canvasId, { x: 20, y: 400 });
    f.controller.connect(canvasId, promptId, otherNodeId);
    await f.controller.runNode(canvasId, nodeId);
    await f.controller.runNode(canvasId, otherNodeId);
    await f.controller.saveCanvas(canvasId);
    const bindings = f.controller.getSnapshot().active!.scene.runBindings;
    const first = bindings.find((binding) => binding.nodeId === nodeId)!;
    const other = bindings.find((binding) => binding.nodeId === otherNodeId)!;
    const terminal = { ...completedJob(first.jobId), status: terminalStatus, ...(terminalStatus === "failed" ? { images: [] } : {}) };
    f.api.runs.set(first.runId, { state: "COMMITTED", origin: { canvasId, nodeId, runId: first.runId }, jobId: first.jobId, generation: terminal, unavailable: null });
    if (state === "missing") f.api.runs.delete(other.runId);
    f.controller.dispose();
    const reopened = createCanvasController({ ...f.options, store: createFakeCanvasStore().port, jobs: createFakeCanvasJobs().port, uuid: () => crypto.randomUUID() });
    controllers.push(reopened);
    await reopened.start();
    const active = reopened.getSnapshot().active!;
    expect(active.scene.runBindings.find((binding) => binding.runId === first.runId)?.outputsHandled).toBe(terminalStatus === "failed" || state === "pending");
    expect(active.scene.runBindings.find((binding) => binding.runId === other.runId)?.outputsHandled).toBe(false);
    expect(active.reservations.find((reservation) => reservation.runId === other.runId)).toMatchObject({ outputsHandled: false, count: state === "missing" ? null : 1 });
    expect(active.scene.nodes.filter((node) => node.kind === "result")).toHaveLength(state === "pending" ? terminal.images.length : 0);
    if (state === "missing") expect(() => reopened.addPrompt(canvasId, { x: 0, y: 0 })).toThrow(expect.objectContaining({ code: "CANVAS_OUTPUT_CAPACITY_EXCEEDED" }));
    expect(f.api.port.submit).toHaveBeenCalledTimes(2);
  });

  it("failed Delete never resets already-handled suppression for removed result cards", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    const runId = await f.controller.runNode(canvasId, nodeId);
    const binding = f.controller.getSnapshot().active!.scene.runBindings[0];
    const job = completedJob(binding.jobId);
    const origin = { ownerId: "owner-one", canvasId, nodeId, runId };
    f.jobs.push(origin, job);
    f.api.runs.set(runId, { state: "COMMITTED", origin, jobId: job.id, generation: job, unavailable: null });
    f.controller.removeNode(canvasId, `result:${job.images[0].id}`);
    vi.mocked(f.api.port.delete).mockRejectedValueOnce(new CanvasTransportError());
    await expect(f.controller.deleteCanvas(canvasId, true)).rejects.toBeInstanceOf(CanvasTransportError);
    expect(f.controller.getSnapshot().active?.scene.nodes.filter((node) => node.kind === "result")).toHaveLength(0);
    expect(f.controller.getSnapshot().active?.scene.runBindings[0].outputsHandled).toBe(true);
  });

  it("Save during uncertain submission includes no fabricated null-job binding", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    const ack = deferred<void>();
    const submit = vi.mocked(f.api.port.submit).getMockImplementation()!;
    vi.mocked(f.api.port.submit).mockImplementationOnce(async (...args) => { const response = await submit(...args); await ack.promise; return response; });
    const running = f.controller.runNode(canvasId, nodeId);
    await vi.waitFor(() => expect(f.api.port.submit).toHaveBeenCalled());
    await f.controller.saveCanvas(canvasId);
    expect(f.api.documents.get(canvasId)?.scene?.runBindings).toEqual([]);
    expect(f.controller.getSnapshot().active?.document.cloudState).toBe("saved");
    ack.resolve();
    await running;
    expect(f.controller.getSnapshot().active?.document.cloudState).toBe("dirty");
    expect(f.controller.getSnapshot().active?.scene.runBindings).toHaveLength(1);
  });

  it("removal during preparation prevents POST after an original upload finishes", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    const reference = f.controller.importReference(canvasId, file(), { x: 0, y: 0 });
    f.controller.connect(canvasId, reference, nodeId);
    const gate = deferred<void>();
    const upload = vi.mocked(f.api.port.upload).getMockImplementation()!;
    vi.mocked(f.api.port.upload).mockImplementationOnce(async (...args) => { await gate.promise; return upload(...args); });
    const running = f.controller.runNode(canvasId, nodeId);
    const outcome = expect(running).rejects.toMatchObject({ code: "CANVAS_DELETED" });
    await vi.waitFor(() => expect(f.api.port.upload).toHaveBeenCalled());
    f.controller.removeNode(canvasId, nodeId);
    gate.resolve();
    await outcome;
    expect(f.api.port.submit).not.toHaveBeenCalled();
    expect(f.controller.getSnapshot().active?.scene.nodes.find((node) => node.id === reference)).toBeDefined();
  });

  it("owner disposal aborts lease acquisition and rejects late request callbacks", async () => {
    const lease = deferred<CanvasTransientLease | null>();
    const release = vi.fn();
    const acquire = vi.fn<AcquireCanvasTransientLease>(() => lease.promise);
    const f = fixture({ acquireTransientLease: acquire });
    const { canvasId, nodeId } = await f.newGraph();
    const running = f.controller.runNode(canvasId, nodeId);
    const outcome = expect(running).rejects.toMatchObject({ code: "CANVAS_DELETED" });
    await vi.waitFor(() => expect(acquire).toHaveBeenCalled());
    const signal = acquire.mock.calls[0][0].signal;
    f.controller.dispose();
    expect(signal.aborted).toBe(true);
    lease.resolve({ fields: { turnstileToken: "late-token" }, release });
    await outcome;
    expect(release).toHaveBeenCalledTimes(1);
    expect(f.api.port.submit).not.toHaveBeenCalled();
    expect(f.jobs.subscribers.size).toBe(0);
  });

  it("a cancelled challenge creates no request and releases capacity for a new explicit run", async () => {
    const acquire = vi.fn<AcquireCanvasTransientLease>().mockResolvedValueOnce(null).mockResolvedValue({ fields: {}, release: vi.fn() });
    const f = fixture({ acquireTransientLease: acquire });
    const { canvasId, nodeId } = await f.newGraph();
    await expect(f.controller.runNode(canvasId, nodeId)).rejects.toMatchObject({ code: "cancelled" });
    expect(f.api.port.submit).not.toHaveBeenCalled();
    expect(f.controller.getSnapshot().active?.reservations).toHaveLength(0);
    const cancelled = f.controller.getSnapshot().active!.runs[0].runId;
    const runId = await f.controller.runNode(canvasId, nodeId);
    expect(runId).not.toBe(cancelled);
  });

  it("phone mode switched during a challenge prevents an eventual POST", async () => {
    const lease = deferred<CanvasTransientLease | null>();
    const release = vi.fn();
    const acquire = vi.fn<AcquireCanvasTransientLease>(() => lease.promise);
    const f = fixture({ acquireTransientLease: acquire });
    const { canvasId, nodeId } = await f.newGraph();
    const running = f.controller.runNode(canvasId, nodeId);
    const outcome = expect(running).rejects.toMatchObject({ code: "CANVAS_DELETED" });
    await vi.waitFor(() => expect(acquire).toHaveBeenCalled());
    f.controller.setReadOnly(true);
    lease.resolve({ fields: {}, release });
    await outcome;
    expect(f.api.port.submit).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("missing committed jobs remain unavailable, not an invitation to regenerate", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    vi.mocked(f.api.port.submit).mockImplementationOnce(async (projection) => ({ state: "COMMITTED", origin: { canvasId, nodeId, runId: projection.runId }, jobId: "missing-job", generation: null, unavailable: "CANVAS_JOB_UNAVAILABLE" }));
    const runId = await f.controller.runNode(canvasId, nodeId);
    expect(f.controller.getSnapshot().active?.runs[0]).toMatchObject({ runId, phase: "unavailable" });
    expect(f.controller.getSnapshot().active?.scene.runBindings[0]).toMatchObject({ jobId: "missing-job", outputsHandled: false });
    await expect(f.controller.runNode(canvasId, nodeId)).rejects.toMatchObject({ code: "CANVAS_NODE_BUSY" });
    expect(f.api.port.submit).toHaveBeenCalledTimes(1);
  });

  it("invalid prompt/inputs fail before shell, upload, credentials or billable transport", async () => {
    const f = fixture();
    const { canvasId, promptId, nodeId } = await f.newGraph();
    f.controller.updatePrompt(canvasId, promptId, " ");
    await expect(f.controller.runNode(canvasId, nodeId)).rejects.toMatchObject({ code: "CANVAS_PROMPT_REQUIRED" });
    expect(f.api.port.upload).not.toHaveBeenCalled();
    expect(f.acquireTransientLease).not.toHaveBeenCalled();
    expect(f.api.port.submit).not.toHaveBeenCalled();
  });
});
