import { afterEach, describe, expect, it, vi } from "vitest";

import { CanvasContractError } from "@/lib/canvas/contracts";
import { CanvasTransportError, createCanvasClientApi } from "@/components/create/canvas/client-api";
import { createCanvasController, type CanvasController, type CanvasControllerOptions } from "@/components/create/canvas/controller";
import { CanvasDraftStoreError } from "@/components/create/canvas/draft-types";

import { canvasAsset, canvasControllerFixture, canvasDate, canvasDefaults, canvasDigest, canvasUuid, deferred, metadata } from "./helpers/canvas-controller-fixtures";

const controllers: CanvasController[] = [];
function fixture(options: Partial<CanvasControllerOptions> = {}) {
  const result = canvasControllerFixture(options);
  controllers.push(result.controller);
  return result;
}
function file(name = "reference.png", content = "png") { return new File([content], name, { type: "image/png", lastModified: 1 }); }
afterEach(() => { for (const controller of controllers.splice(0)) controller.dispose(); vi.useRealTimers(); });

describe("canvas document commands", () => {
  it("does no storage or API work when disabled and never creates on start/select", async () => {
    const f = fixture({ enabled: false });
    await f.controller.start();
    expect(f.controller.getSnapshot()).toMatchObject({ ready: true, enabled: false, active: null, documents: [] });
    expect(f.api.port.list).not.toHaveBeenCalled();
    expect(f.store.port.list).not.toHaveBeenCalled();
    await expect(f.controller.newCanvas()).rejects.toMatchObject({ code: "inactive" });
    expect(f.api.port.submit).not.toHaveBeenCalled();
  });

  it("creates an empty independent UUID scene and defaults from account options", async () => {
    const f = fixture();
    const first = await f.newGraph();
    f.controller.updatePrompt(first.canvasId, first.promptId, "first draft only");
    const second = await f.controller.newCanvas("Second");
    expect(second).not.toBe(first.canvasId);
    expect(f.controller.getSnapshot().active?.scene).toMatchObject({ nodes: [], edges: [], runBindings: [] });
    const generation = f.controller.addGeneration(second, { x: -20, y: -30 });
    expect(f.controller.getSnapshot().active?.scene.nodes.find((node) => node.id === generation)).toMatchObject({ parameters: canvasDefaults });
    await f.controller.selectCanvas(first.canvasId);
    expect(f.controller.getSnapshot().active?.scene.nodes.find((node) => node.id === first.promptId)).toMatchObject({ text: "first draft only" });
    expect(f.api.port.submit).not.toHaveBeenCalled();
  });

  it("keeps the original shell ID and uncertainty after lost New acknowledgement", async () => {
    const f = fixture();
    await f.controller.start();
    const create = vi.mocked(f.api.port.create).getMockImplementation()!;
    vi.mocked(f.api.port.create).mockImplementationOnce(async (...args) => { await create(...args); throw new CanvasTransportError(); });
    await expect(f.controller.newCanvas("Offline draft")).rejects.toBeInstanceOf(CanvasTransportError);
    const id = f.controller.getSnapshot().activeCanvasId!;
    expect(f.controller.getSnapshot().active?.document).toMatchObject({ id, shell: "uncertain" });
    f.controller.addPrompt(id, { x: 0, y: 0 }, "preserved");
    await f.controller.registerCanvas(id);
    expect(f.controller.getSnapshot().active?.document.shell).toBe("registered");
    expect(f.api.documents.size).toBe(1);
    expect(f.api.port.create).toHaveBeenNthCalledWith(2, id, "Offline draft", expect.any(AbortSignal));
    expect(f.controller.getSnapshot().active?.scene.nodes).toHaveLength(1);
  });

  it("rename advances only coarse metadata, never the saved graph revision", async () => {
    const f = fixture();
    const { canvasId, promptId } = await f.newGraph();
    await f.controller.saveCanvas(canvasId);
    const savedRevision = f.controller.getSnapshot().active!.document.savedEditRevision;
    f.controller.updatePrompt(canvasId, promptId, "unsaved later text");
    await f.controller.renameCanvas(canvasId, "Renamed");
    expect(f.controller.getSnapshot().active?.document).toMatchObject({ title: "Renamed", savedEditRevision: savedRevision, cloudState: "dirty", cloud: { revision: 2 } });
    expect(f.api.documents.get(canvasId)?.scene?.nodes.find((node) => node.id === promptId)).toMatchObject({ text: "frozen prompt" });
  });

  it("serializes a rename behind a captured Save instead of concurrent metadata CAS", async () => {
    const f = fixture();
    const { canvasId } = await f.newGraph();
    const gate = deferred<void>();
    const save = vi.mocked(f.api.port.save).getMockImplementation()!;
    vi.mocked(f.api.port.save).mockImplementationOnce(async (...args) => { await gate.promise; return save(...args); });
    const saving = f.controller.saveCanvas(canvasId);
    await vi.waitFor(() => expect(f.api.port.save).toHaveBeenCalled());
    const renaming = f.controller.renameCanvas(canvasId, "After snapshot");
    expect(f.api.port.rename).not.toHaveBeenCalled();
    gate.resolve();
    await Promise.all([saving, renaming]);
    expect(f.api.port.rename).toHaveBeenCalledWith(canvasId, "After snapshot", 1, expect.any(AbortSignal));
    expect(f.controller.getSnapshot().active?.document).toMatchObject({ cloudState: "saved", title: "After snapshot", cloud: { revision: 2 } });
  });

  it("Save uploads every disconnected original and acknowledges only its captured edit revision", async () => {
    const f = fixture();
    const { canvasId, promptId } = await f.newGraph();
    const disconnected = f.controller.importReference(canvasId, file(), { x: 100, y: 20 });
    const gate = deferred<void>();
    const upload = vi.mocked(f.api.port.upload).getMockImplementation()!;
    vi.mocked(f.api.port.upload).mockImplementationOnce(async (...args) => { await gate.promise; return upload(...args); });
    const revision = f.controller.getSnapshot().active!.document.editRevision;
    const saving = f.controller.saveCanvas(canvasId);
    await vi.waitFor(() => expect(f.api.port.upload).toHaveBeenCalledTimes(1));
    f.controller.updatePrompt(canvasId, promptId, "edited while uploading");
    gate.resolve();
    await saving;
    expect(f.api.documents.get(canvasId)?.scene?.nodes.find((node) => node.id === disconnected)).toMatchObject({ kind: "reference", source: { kind: "imported" } });
    expect(f.api.documents.get(canvasId)?.scene?.nodes.find((node) => node.id === promptId)).toMatchObject({ text: "frozen prompt" });
    expect(f.controller.getSnapshot().active?.document).toMatchObject({ savedEditRevision: revision, cloudState: "dirty" });
    expect(f.controller.getSnapshot().active?.scene.nodes.find((node) => node.id === promptId)).toMatchObject({ text: "edited while uploading" });
    expect(f.api.port.submit).not.toHaveBeenCalled();
    await f.controller.saveCanvas(canvasId);
    expect(f.api.port.upload).toHaveBeenCalledTimes(1);
    expect(f.controller.getSnapshot().active?.document.cloudState).toBe("saved");
  });

  it("a stale uploaded original never overwrites a replacement or discards captured bytes", async () => {
    const f = fixture();
    const { canvasId } = await f.newGraph();
    const referenceId = f.controller.importReference(canvasId, file("old.png"), { x: 0, y: 0 });
    const oldSource = f.controller.getSnapshot().active!.scene.nodes.find((node) => node.id === referenceId);
    const gate = deferred<void>();
    const upload = vi.mocked(f.api.port.upload).getMockImplementation()!;
    vi.mocked(f.api.port.upload).mockImplementationOnce(async (...args) => { await gate.promise; return upload(...args); });
    const saving = f.controller.saveCanvas(canvasId);
    await vi.waitFor(() => expect(f.api.port.upload).toHaveBeenCalledTimes(1));
    f.controller.replaceReference(canvasId, referenceId, file("replacement.png", "new"));
    const replacement = f.controller.getSnapshot().active!.scene.nodes.find((node) => node.id === referenceId);
    expect(replacement).not.toEqual(oldSource);
    gate.resolve();
    await saving;
    expect(f.controller.getSnapshot().active!.scene.nodes.find((node) => node.id === referenceId)).toEqual(replacement);
    expect(f.controller.getSnapshot().active?.document.cloudState).toBe("dirty");
    const row = f.store.row("owner-one", canvasId)!;
    expect(row.blobs.map((blob) => blob.fileName)).toEqual(["old.png", "replacement.png"]);
    expect(row.blobs[0].assetId).not.toBeNull();
    expect(row.blobs[1].assetId).toBeNull();
  });

  it("keeps local scene/originals on failed uploads and allows a new explicit capture", async () => {
    const f = fixture();
    const { canvasId } = await f.newGraph();
    const reference = f.controller.importReference(canvasId, file(), { x: 0, y: 0 });
    vi.mocked(f.api.port.upload).mockRejectedValueOnce(new CanvasContractError("CANVAS_STORAGE_UNAVAILABLE"));
    await expect(f.controller.saveCanvas(canvasId)).rejects.toMatchObject({ code: "CANVAS_STORAGE_UNAVAILABLE" });
    expect(f.api.port.save).not.toHaveBeenCalled();
    expect(f.controller.getSnapshot().active?.scene.nodes.find((node) => node.id === reference)).toBeDefined();
    expect(f.controller.getSnapshot().active?.document.cloudState).toBe("failed");
    await f.controller.saveCanvas(canvasId);
    expect(f.api.port.upload).toHaveBeenCalledTimes(2);
    const uploads = vi.mocked(f.api.port.upload).mock.calls;
    expect(uploads[1][0].uploadId).toBe(uploads[0][0].uploadId);
    expect(f.controller.getSnapshot().active?.document.cloudState).toBe("saved");
  });

  it("lost Save ACK replays the exact resolved scene/saveId after later replacement", async () => {
    const f = fixture();
    const { canvasId } = await f.newGraph();
    const reference = f.controller.importReference(canvasId, file(), { x: 0, y: 0 });
    const save = vi.mocked(f.api.port.save).getMockImplementation()!;
    vi.mocked(f.api.port.save).mockImplementationOnce(async (...args) => { await save(...args); throw new CanvasTransportError(); });
    await expect(f.controller.saveCanvas(canvasId)).rejects.toBeInstanceOf(CanvasTransportError);
    f.controller.replaceReference(canvasId, reference, file("new.png", "new"));
    await f.controller.saveCanvas(canvasId);
    const requests = vi.mocked(f.api.port.save).mock.calls;
    expect(requests[1][1]).toEqual(requests[0][1]);
    expect(f.api.port.upload).toHaveBeenCalledTimes(1);
    expect(f.controller.getSnapshot().active?.document.cloudState).toBe("dirty");
    await f.controller.saveCanvas(canvasId);
    expect(vi.mocked(f.api.port.save).mock.calls[2][1].saveId).not.toBe(requests[0][1].saveId);
    expect(f.api.port.upload).toHaveBeenCalledTimes(2);
  });

  it("a timed-out Save JSON releases its queue and retries only the captured scene despite a late first ACK", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const { canvasId, promptId } = await f.newGraph();
    const firstJson = deferred<unknown>();
    const retryResponse = deferred<Response>();
    const firstResponse = Response.json({});
    vi.spyOn(firstResponse, "json").mockReturnValueOnce(firstJson.promise);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(firstResponse).mockReturnValueOnce(retryResponse.promise);
    vi.mocked(f.api.port.save).mockImplementation(createCanvasClientApi(fetcher).save);
    const revision = f.controller.getSnapshot().active!.document.editRevision;
    const saving = f.controller.saveCanvas(canvasId).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const captured = f.store.row("owner-one", canvasId)!.envelope.pendingSave!;
    const receipt = { canvas: metadata(canvasId, { revision: 1, hasSavedSnapshot: true, lastSavedAt: canvasDate }), saveId: captured.saveId, sceneHash: canvasDigest, acknowledgedRevision: 1 };
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await saving).toBeInstanceOf(CanvasTransportError);
    f.controller.updatePrompt(canvasId, promptId, "newer edit after timeout");
    const retrying = f.controller.saveCanvas(canvasId);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][1]?.body).toBe(fetcher.mock.calls[0][1]?.body);
    firstJson.resolve({ data: receipt });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.controller.getSnapshot().active?.document).toMatchObject({ cloudState: "saving", savedEditRevision: null });
    retryResponse.resolve(Response.json({ data: receipt }));
    await retrying;
    expect(f.controller.getSnapshot().active?.document).toMatchObject({ cloudState: "dirty", savedEditRevision: revision, cloud: { revision: 1 } });
    expect(f.controller.getSnapshot().active?.scene.nodes.find((node) => node.id === promptId)).toMatchObject({ text: "newer edit after timeout" });
    expect(f.api.port.submit).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("cloud conflict preserves local changes until explicitly warned account reload", async () => {
    const f = fixture();
    const { canvasId, promptId } = await f.newGraph();
    await f.controller.saveCanvas(canvasId);
    f.controller.updatePrompt(canvasId, promptId, "local conflict text");
    f.api.documents.get(canvasId)!.canvas.revision += 1;
    await expect(f.controller.saveCanvas(canvasId)).rejects.toMatchObject({ code: "CANVAS_REVISION_CONFLICT" });
    expect(f.controller.getSnapshot().active?.document.cloudState).toBe("conflict");
    await expect(f.controller.reloadAccountCanvas(canvasId, false)).rejects.toMatchObject({ code: "confirmation" });
    expect(f.controller.getSnapshot().active?.scene.nodes.find((node) => node.id === promptId)).toMatchObject({ text: "local conflict text" });
    await f.controller.flushLocal(canvasId);
    const before = f.store.row("owner-one", canvasId)!.envelope.editRevision;
    await f.controller.reloadAccountCanvas(canvasId, true);
    expect(f.controller.getSnapshot().active?.scene.nodes.find((node) => node.id === promptId)).toMatchObject({ text: "frozen prompt" });
    expect(f.controller.getSnapshot().active?.document).toMatchObject({ cloudState: "saved", localState: "saved", editRevision: before + 1, savedEditRevision: before + 1 });
    expect(f.store.row("owner-one", canvasId)!.envelope.editRevision).toBe(before + 1);
    expect(f.api.port.submit).not.toHaveBeenCalled();
  });

  it("same-browser local drafts win over a newer metadata response without silent rebasing", async () => {
    const f = fixture();
    const { canvasId, promptId } = await f.newGraph();
    await f.controller.saveCanvas(canvasId);
    f.controller.updatePrompt(canvasId, promptId, "browser-only draft");
    await f.controller.flushLocal();
    f.controller.dispose();
    f.api.documents.get(canvasId)!.canvas.revision += 1;
    const reopened = createCanvasController(f.options);
    controllers.push(reopened);
    await reopened.start();
    expect(reopened.getSnapshot().active?.scene.nodes.find((node) => node.id === promptId)).toMatchObject({ text: "browser-only draft" });
    expect(reopened.getSnapshot().active?.document).toMatchObject({ cloudState: "conflict", cloud: { revision: 1 } });
    expect(f.api.port.submit).not.toHaveBeenCalled();
  });

  it("account Save uses memory originals despite a local storage failure; does not fake durability", async () => {
    const f = fixture();
    const { canvasId } = await f.newGraph();
    f.controller.importReference(canvasId, file(), { x: 0, y: 0 });
    f.store.setFailure(new CanvasDraftStoreError("quota"));
    expect(await f.controller.flushLocal()).toBe(false);
    await f.controller.saveCanvas(canvasId);
    expect(f.controller.getSnapshot().active?.document).toMatchObject({ cloudState: "saved", localState: "failed" });
    expect(f.controller.getSnapshot().active?.document.warning).toBeTruthy();
    expect(f.api.documents.get(canvasId)?.scene?.nodes.some((node) => node.kind === "reference" && node.source.kind === "imported")).toBe(true);
  });

  it("only transaction ACK advances local durability and delayed writes remain monotonic", async () => {
    const f = fixture();
    const { canvasId, promptId } = await f.newGraph();
    const gate = deferred<void>();
    const commit = vi.mocked(f.store.port.commit).getMockImplementation()!;
    vi.mocked(f.store.port.commit).mockImplementationOnce(async (input) => { await gate.promise; return commit(input); });
    const flushing = f.controller.flushLocal();
    expect(f.controller.getSnapshot().active?.document.localState).toBe("pending");
    f.controller.updatePrompt(canvasId, promptId, "newer than queued write");
    gate.resolve();
    expect(await flushing).toBe(true);
    expect(f.controller.getSnapshot().active?.document.localState).toBe("saved");
    expect(f.store.row("owner-one", canvasId)?.envelope.scene.nodes.find((node) => node.id === promptId)).toMatchObject({ text: "newer than queued write" });
    expect(vi.mocked(f.store.port.commit).mock.calls.map(([input]) => input.envelope.editRevision)).toEqual([3, 4]);
  });

  it("local multi-writer conflict never retries with another writer's stamp", async () => {
    const f = fixture();
    const { canvasId, promptId } = await f.newGraph();
    await f.controller.flushLocal();
    const row = f.store.row("owner-one", canvasId)!;
    row.stamp = { writerId: canvasUuid(888), writeRevision: row.stamp.writeRevision + 1 };
    f.controller.updatePrompt(canvasId, promptId, "keep in memory");
    expect(await f.controller.flushLocal()).toBe(false);
    const attempts = vi.mocked(f.store.port.commit).mock.calls.length;
    expect(await f.controller.flushLocal()).toBe(false);
    expect(vi.mocked(f.store.port.commit).mock.calls).toHaveLength(attempts);
    expect(f.controller.getSnapshot().active?.document.localState).toBe("conflict");
    expect(f.controller.getSnapshot().active?.scene.nodes.find((node) => node.id === promptId)).toMatchObject({ text: "keep in memory" });
  });

  it("corrupt scoped local data does not silently fall back to a cloud or empty scene", async () => {
    const f = fixture();
    const id = canvasUuid(20);
    f.api.seed(id);
    vi.mocked(f.store.port.list).mockRejectedValueOnce(new CanvasDraftStoreError("corrupt", { key: ["owner-one", id] }));
    vi.mocked(f.store.port.read).mockRejectedValueOnce(new CanvasDraftStoreError("corrupt", { key: ["owner-one", id] }));
    await f.controller.start();
    expect(f.controller.getSnapshot()).toMatchObject({ activeCanvasId: id, active: null, ready: true });
    expect(f.controller.getSnapshot().error).toBeTruthy();
    expect(f.api.port.read).not.toHaveBeenCalled();
    expect(f.store.port.commit).not.toHaveBeenCalled();
  });

  it("an expired import reuploads its available original under a fresh identity", async () => {
    const f = fixture();
    const { canvasId } = await f.newGraph();
    f.controller.importReference(canvasId, file(), { x: 0, y: 0 });
    await f.controller.saveCanvas(canvasId);
    const first = [...f.api.assets.values()][0];
    f.api.assets.set(first.id, { ...first, state: "DELETED", url: null });
    await f.controller.saveCanvas(canvasId);
    const requests = vi.mocked(f.api.port.upload).mock.calls;
    expect(requests).toHaveLength(2);
    expect(requests[1][0].uploadId).not.toBe(requests[0][0].uploadId);
    expect(f.controller.getSnapshot().active?.scene.nodes).toHaveLength(3);
    expect(f.controller.getSnapshot().active?.document.cloudState).toBe("saved");
    expect(f.store.row("owner-one", canvasId)?.blobs).toHaveLength(1);
  });

  it("retained originals stay attached after account reload and an expired imported identity is replaced", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    const referenceId = f.controller.importReference(canvasId, file(), { x: 0, y: 0 });
    const reusedId = f.controller.reuseReference(canvasId, referenceId, { x: 0, y: 100 });
    f.controller.connect(canvasId, referenceId, nodeId);
    await f.controller.saveCanvas(canvasId);
    const originalAsset = [...f.api.assets.values()][0];
    await f.controller.reloadAccountCanvas(canvasId, true);
    expect(f.controller.getSnapshot().active?.scene.nodes.find((node) => node.id === referenceId)).toMatchObject({ source: { kind: "imported", assetId: originalAsset.id } });
    f.api.assets.clear();
    const revision = f.controller.getSnapshot().active!.document.editRevision;
    await f.controller.saveCanvas(canvasId);
    const replacement = [...f.api.assets.values()][0];
    expect(replacement.id).not.toBe(originalAsset.id);
    expect(f.controller.getSnapshot().active?.document).toMatchObject({ cloudState: "dirty", editRevision: revision + 1, savedEditRevision: revision });
    for (const id of [referenceId, reusedId]) {
      expect(f.controller.getSnapshot().active?.references[id]).toMatchObject({ assetId: replacement.id, state: "ready" });
    }
    await f.controller.saveCanvas(canvasId);
    await f.controller.runNode(canvasId, nodeId);
    const request = vi.mocked(f.api.port.submit).mock.calls[0][0];
    expect(request.references).toMatchObject([{ assetId: replacement.id }]);
    expect(f.api.port.upload).toHaveBeenCalledTimes(2);
    expect(f.store.row("owner-one", canvasId)?.blobs).toHaveLength(1);
    expect(f.api.documents.get(canvasId)?.scene?.nodes.filter((node) => node.kind === "reference")).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: referenceId, source: { kind: "imported", assetId: replacement.id } }),
      expect.objectContaining({ id: reusedId, source: { kind: "imported", assetId: replacement.id } }),
    ]));
  });

  it("a reload between expired-asset replacement and its upload ACK retains the original locator", async () => {
    const f = fixture();
    const { canvasId } = await f.newGraph();
    const referenceId = f.controller.importReference(canvasId, file(), { x: 0, y: 0 });
    await f.controller.saveCanvas(canvasId);
    await f.controller.reloadAccountCanvas(canvasId, true);
    f.api.assets.clear();
    const upload = vi.mocked(f.api.port.upload).getMockImplementation()!;
    vi.mocked(f.api.port.upload).mockImplementationOnce(async (...args) => { await upload(...args); throw new CanvasTransportError(); });
    await expect(f.controller.saveCanvas(canvasId)).rejects.toBeInstanceOf(CanvasTransportError);
    await f.controller.flushLocal(canvasId);
    const original = f.store.row("owner-one", canvasId)!.blobs[0];
    expect(original.assetId).toBeNull();
    expect(f.store.row("owner-one", canvasId)!.envelope.scene.nodes.find((node) => node.id === referenceId)).toMatchObject({ source: { kind: "local", blobId: original.blobId, uploadId: original.uploadId } });
    f.controller.dispose();
    const reopened = createCanvasController(f.options);
    controllers.push(reopened);
    await reopened.start();
    await reopened.saveCanvas(canvasId);
    const replacement = [...f.api.assets.values()][0];
    expect(reopened.getSnapshot().active?.references[referenceId]).toMatchObject({ assetId: replacement.id, state: "ready" });
    expect(f.api.port.uploadStatus).toHaveBeenCalledWith(original.uploadId, expect.any(AbortSignal));
    expect(f.api.port.upload).toHaveBeenCalledTimes(2);
    expect(f.api.port.submit).not.toHaveBeenCalled();
  });

  it("restores a saved reference on another device without local original or upload", async () => {
    const f = fixture();
    const id = canvasUuid(20);
    const asset = canvasAsset("asset-saved", canvasUuid(30));
    f.api.assets.set(asset.id, asset);
    f.api.documents.set(id, { canvas: metadata(id, { hasSavedSnapshot: true, lastSavedAt: canvasDate, revision: 1 }), scene: {
      schemaVersion: 1, nodes: [{ id: canvasUuid(40), kind: "reference", position: { x: 0, y: 0 }, source: { kind: "imported", assetId: asset.id } }], edges: [], runBindings: [], viewport: { x: 0, y: 0, zoom: 1 },
    } });
    await f.controller.start();
    expect(f.controller.getSnapshot().active?.references[canvasUuid(40)]).toMatchObject({ state: "ready", blobId: null, assetId: asset.id });
    await f.controller.saveCanvas(id);
    expect(f.api.port.upload).not.toHaveBeenCalled();
    expect(f.api.documents.get(id)?.scene?.nodes).toHaveLength(1);
    f.api.assets.delete(asset.id);
    await expect(f.controller.saveCanvas(id)).rejects.toMatchObject({ code: "CANVAS_INPUT_UNAVAILABLE" });
    expect(f.controller.getSnapshot().active?.scene.nodes).toHaveLength(1);
  });

  it("an account-backed Delete preserves the draft until ACK then commits a permanent tombstone", async () => {
    const f = fixture();
    const { canvasId } = await f.newGraph();
    f.controller.importReference(canvasId, file(), { x: 0, y: 0 });
    await f.controller.saveCanvas(canvasId);
    const gate = deferred<void>();
    const remove = vi.mocked(f.api.port.delete).getMockImplementation()!;
    vi.mocked(f.api.port.delete).mockImplementationOnce(async (...args) => { await gate.promise; return remove(...args); });
    const deleting = f.controller.deleteCanvas(canvasId, true);
    await vi.waitFor(() => expect(f.api.port.delete).toHaveBeenCalled());
    expect(f.controller.getSnapshot().active?.document.deleting).toBe(true);
    expect(f.controller.getSnapshot().active?.scene.nodes).toHaveLength(3);
    expect(f.store.row("owner-one", canvasId)?.envelope.deletedAt).toBeNull();
    gate.resolve();
    await deleting;
    expect(f.controller.getSnapshot().documents).toHaveLength(0);
    expect(f.controller.getSnapshot().activeCanvasId).toBeNull();
    const persisted = f.store.row("owner-one", canvasId)!;
    expect(persisted.envelope).toMatchObject({ deletedAt: canvasDate, savedEditRevision: null, pendingSave: null, scene: { nodes: [] }, cloud: { hasSavedSnapshot: false, revision: 2 } });
    expect(persisted.blobs).toHaveLength(0);
    await expect(f.controller.selectCanvas(canvasId)).rejects.toMatchObject({ code: "CANVAS_DELETED" });
  });

  it("resolves uncertain shell creation before Delete instead of pretending it was local-only", async () => {
    const f = fixture();
    await f.controller.start();
    const create = vi.mocked(f.api.port.create).getMockImplementation()!;
    vi.mocked(f.api.port.create).mockImplementationOnce(async (...args) => { await create(...args); throw new CanvasTransportError(); });
    await expect(f.controller.newCanvas()).rejects.toBeInstanceOf(CanvasTransportError);
    const id = f.controller.getSnapshot().activeCanvasId!;
    await f.controller.deleteCanvas(id, true);
    expect(f.api.port.create).toHaveBeenCalledTimes(2);
    expect(f.api.port.delete).toHaveBeenCalledWith(id, 0, expect.any(AbortSignal));
    expect(f.api.deleted.has(id)).toBe(true);
    expect(f.store.row("owner-one", id)?.envelope.deletedAt).toBe(canvasDate);
  });

  it("deletion storage conflict remains an explicit warning after server ACK", async () => {
    const f = fixture();
    const { canvasId } = await f.newGraph();
    await f.controller.flushLocal();
    f.store.setFailure(new CanvasDraftStoreError("conflict"));
    await f.controller.deleteCanvas(canvasId, true);
    expect(f.api.deleted.has(canvasId)).toBe(true);
    expect(f.controller.getSnapshot().warning).toBeTruthy();
    expect(f.controller.getSnapshot().documents).toHaveLength(0);
  });

  it("checks an uncertain shell's authoritative deletion before restoring its local draft", async () => {
    const f = fixture();
    await f.controller.start();
    const create = vi.mocked(f.api.port.create).getMockImplementation()!;
    vi.mocked(f.api.port.create).mockImplementationOnce(async (...args) => { await create(...args); throw new CanvasTransportError(); });
    await expect(f.controller.newCanvas()).rejects.toBeInstanceOf(CanvasTransportError);
    const canvasId = f.controller.getSnapshot().activeCanvasId!;
    f.controller.addPrompt(canvasId, { x: 0, y: 0 }, "uncertain local graph");
    await f.controller.flushLocal();
    f.store.setFailure(new CanvasDraftStoreError("quota"));
    await f.controller.deleteCanvas(canvasId, true);
    expect(f.store.row("owner-one", canvasId)?.envelope).toMatchObject({ shell: "uncertain", cloud: null, deletedAt: null });
    f.controller.dispose();
    f.store.setFailure(null);
    const reopened = createCanvasController(f.options);
    controllers.push(reopened);
    await reopened.start();
    expect(reopened.getSnapshot()).toMatchObject({ active: null, activeCanvasId: null, documents: [] });
    expect(f.store.row("owner-one", canvasId)?.envelope.deletedAt).not.toBeNull();
    expect(f.api.port.delete).toHaveBeenCalledTimes(1);
  });

  it("does not clear a newer selected canvas when an older load confirms deletion", async () => {
    const f = fixture();
    const { canvasId } = await f.newGraph();
    const otherId = await f.controller.newCanvas("Keep selected");
    const otherPrompt = f.controller.addPrompt(otherId, { x: 0, y: 0 }, "independent graph");
    await f.controller.flushLocal();
    f.controller.dispose();
    const gate = deferred<never>();
    vi.mocked(f.api.port.read).mockImplementationOnce(() => gate.promise);
    const reopened = createCanvasController(f.options);
    controllers.push(reopened);
    const starting = reopened.start();
    await vi.waitFor(() => expect(f.api.port.read).toHaveBeenCalledWith(canvasId, expect.any(AbortSignal)));
    await reopened.selectCanvas(otherId);
    gate.reject(new CanvasContractError("CANVAS_DELETED"));
    await starting;
    expect(reopened.getSnapshot()).toMatchObject({ activeCanvasId: otherId, loading: false, error: null });
    expect(reopened.getSnapshot().active?.scene.nodes).toMatchObject([{ id: otherPrompt, text: "independent graph" }]);
    expect(reopened.getSnapshot().documents.map((document) => document.id)).toEqual([otherId]);
  });

  it("explicitly read-only commands reject mutations while selection and camera inspection stay runtime-only", async () => {
    const f = fixture();
    const { canvasId, promptId, nodeId } = await f.newGraph();
    const reference = f.controller.importReference(canvasId, file(), { x: 0, y: 0 });
    await f.controller.flushLocal();
    const before = f.controller.getSnapshot().active!.scene;
    const writes = vi.mocked(f.store.port.commit).mock.calls.length;
    f.controller.setReadOnly(true);
    const commands = [
      () => f.controller.addPrompt(canvasId, { x: 0, y: 0 }), () => f.controller.addGeneration(canvasId, { x: 0, y: 0 }),
      () => f.controller.importReference(canvasId, file(), { x: 0, y: 0 }), () => f.controller.replaceReference(canvasId, reference, file()),
      () => f.controller.reuseReference(canvasId, reference, { x: 0, y: 0 }), () => f.controller.moveNode(canvasId, nodeId, { x: 4, y: 5 }),
      () => f.controller.updatePrompt(canvasId, promptId, "no"), () => f.controller.updateParameters(canvasId, nodeId, { count: 4 }),
      () => f.controller.removeNode(canvasId, promptId), () => f.controller.connect(canvasId, reference, nodeId),
      () => f.controller.disconnect(canvasId, before.edges[0].id), () => f.controller.reorderInputs(canvasId, nodeId, []),
    ];
    for (const command of commands) expect(command).toThrow(expect.objectContaining({ code: "readOnly" }));
    for (const command of [() => f.controller.newCanvas(), () => f.controller.renameCanvas(canvasId, "no"), () => f.controller.deleteCanvas(canvasId, true),
      () => f.controller.saveCanvas(canvasId), () => f.controller.reloadAccountCanvas(canvasId, true), () => f.controller.registerCanvas(canvasId),
      () => f.controller.runNode(canvasId, nodeId), () => f.controller.retryTransport(canvasId, canvasUuid(22))]) await expect(command()).rejects.toMatchObject({ code: "readOnly" });
    f.controller.selectNode(canvasId, nodeId);
    f.controller.setViewport(canvasId, { x: -240, y: 50, zoom: 0.25 });
    await f.controller.selectCanvas(canvasId);
    expect(f.controller.getSnapshot().active).toMatchObject({ selectedNodeId: nodeId, viewport: { x: -240, y: 50, zoom: 0.25 }, scene: before });
    await f.controller.flushLocal();
    expect(f.store.port.commit).toHaveBeenCalledTimes(writes);
    expect(f.api.port.submit).not.toHaveBeenCalled();
  });

  it("previews are leased/revoked without deleting original bytes or serializing URLs", async () => {
    const createObjectURL = vi.fn(() => "blob:canvas-preview");
    const revokeObjectURL = vi.fn();
    const f = fixture({ objectUrls: { createObjectURL, revokeObjectURL } });
    const { canvasId } = await f.newGraph();
    const id = f.controller.importReference(canvasId, file(), { x: 0, y: 0 });
    const first = f.controller.acquirePreview(canvasId, id)!;
    const second = f.controller.acquirePreview(canvasId, id)!;
    expect(first.url).toBe(second.url);
    first.release();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    second.release();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:canvas-preview");
    await f.controller.flushLocal();
    const row = f.store.row("owner-one", canvasId)!;
    expect(row.blobs).toHaveLength(1);
    expect(JSON.stringify(row.envelope)).not.toContain("blob:");
    expect(row.blobs[0]).toMatchObject({ sha256: null, assetId: null });
    const third = f.controller.acquirePreview(canvasId, id)!;
    f.controller.dispose();
    third.release();
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it("snapshot consumers cannot mutate live scene state through renderer references", async () => {
    const f = fixture();
    const { canvasId } = await f.newGraph();
    const leaked = f.controller.getSnapshot().active!.scene;
    leaked.nodes.splice(0);
    f.controller.setViewport(canvasId, { x: 1, y: 0, zoom: 1 });
    expect(f.controller.getSnapshot().active?.scene.nodes).toHaveLength(2);
  });

  it("coalesces simultaneous same-document loads so a late read cannot overwrite edits", async () => {
    const f = fixture({ initialCanvases: [] });
    await f.controller.start();
    const id = canvasUuid(80);
    f.api.seed(id);
    const gate = deferred<void>();
    const read = vi.mocked(f.api.port.read).getMockImplementation()!;
    vi.mocked(f.api.port.read).mockImplementationOnce(async (...args) => { await gate.promise; return read(...args); });
    const first = f.controller.selectCanvas(id);
    const second = f.controller.selectCanvas(id);
    await vi.waitFor(() => expect(f.api.port.read).toHaveBeenCalledTimes(1));
    gate.resolve();
    await Promise.all([first, second]);
    const prompt = f.controller.addPrompt(id, { x: 0, y: 0 }, "keep after load");
    await f.controller.selectCanvas(id);
    expect(f.api.port.read).toHaveBeenCalledTimes(1);
    expect(f.controller.getSnapshot().active?.scene.nodes.find((node) => node.id === prompt)).toMatchObject({ text: "keep after load" });
  });

  it("a failed Delete does not strand an exact pending Save replay behind its old source epoch", async () => {
    const f = fixture();
    const { canvasId } = await f.newGraph();
    const save = vi.mocked(f.api.port.save).getMockImplementation()!;
    vi.mocked(f.api.port.save).mockImplementationOnce(async (...args) => { await save(...args); throw new CanvasTransportError(); });
    await expect(f.controller.saveCanvas(canvasId)).rejects.toBeInstanceOf(CanvasTransportError);
    await expect(f.controller.deleteCanvas(canvasId, true)).rejects.toMatchObject({ code: "CANVAS_REVISION_CONFLICT" });
    await f.controller.saveCanvas(canvasId);
    expect(vi.mocked(f.api.port.save).mock.calls[1][1]).toEqual(vi.mocked(f.api.port.save).mock.calls[0][1]);
    expect(f.controller.getSnapshot().active?.document.cloudState).toBe("saved");
  });

  it("owner disposal during IndexedDB bootstrap stops later requests and callbacks", async () => {
    const f = fixture();
    const gate = deferred<Awaited<ReturnType<typeof f.store.port.list>>>();
    vi.mocked(f.store.port.list).mockImplementationOnce(() => gate.promise);
    const starting = f.controller.start();
    f.controller.dispose();
    gate.resolve([]);
    await starting;
    expect(f.api.port.list).not.toHaveBeenCalled();
    expect(f.jobs.subscribers.size).toBe(0);
  });

  it("successful Delete exposes an existing local CAS conflict after removing the local view", async () => {
    const f = fixture();
    const { canvasId, promptId } = await f.newGraph();
    await f.controller.flushLocal();
    f.store.setFailure(new CanvasDraftStoreError("conflict"));
    f.controller.updatePrompt(canvasId, promptId, "local-only conflict");
    await f.controller.flushLocal();
    await f.controller.deleteCanvas(canvasId, true);
    expect(f.controller.getSnapshot().documents).toHaveLength(0);
    expect(f.controller.getSnapshot().warning).toBeTruthy();
  });

  it("failed warned reload retains pending exact Save and restores its live source guard", async () => {
    const f = fixture();
    const { canvasId } = await f.newGraph();
    const save = vi.mocked(f.api.port.save).getMockImplementation()!;
    vi.mocked(f.api.port.save).mockImplementationOnce(async (...args) => { await save(...args); throw new CanvasTransportError(); });
    await expect(f.controller.saveCanvas(canvasId)).rejects.toBeInstanceOf(CanvasTransportError);
    vi.mocked(f.api.port.read).mockRejectedValueOnce(new CanvasTransportError());
    await expect(f.controller.reloadAccountCanvas(canvasId, true)).rejects.toBeInstanceOf(CanvasTransportError);
    await f.controller.saveCanvas(canvasId);
    expect(vi.mocked(f.api.port.save).mock.calls[1][1]).toEqual(vi.mocked(f.api.port.save).mock.calls[0][1]);
    expect(f.controller.getSnapshot().active?.document).toMatchObject({ deleting: false, cloudState: "saved" });
  });

  it("pending Delete still permits read-only selection, previews, and runtime camera without editing the draft", async () => {
    const f = fixture({ objectUrls: { createObjectURL: () => "blob:pending-delete", revokeObjectURL: vi.fn() } });
    const { canvasId } = await f.newGraph();
    const nodeId = f.controller.importReference(canvasId, file(), { x: 0, y: 0 });
    const gate = deferred<void>();
    const remove = vi.mocked(f.api.port.delete).getMockImplementation()!;
    vi.mocked(f.api.port.delete).mockImplementationOnce(async (...args) => { await gate.promise; return remove(...args); });
    const deleting = f.controller.deleteCanvas(canvasId, true);
    await vi.waitFor(() => expect(f.api.port.delete).toHaveBeenCalled());
    const before = f.controller.getSnapshot().active!.document.editRevision;
    const preview = f.controller.acquirePreview(canvasId, nodeId)!;
    expect(preview.url).toBe("blob:pending-delete");
    f.controller.selectNode(canvasId, nodeId);
    f.controller.setViewport(canvasId, { x: -30, y: 40, zoom: 0.5 });
    expect(f.controller.getSnapshot().active?.document.editRevision).toBe(before);
    expect(() => f.controller.moveNode(canvasId, nodeId, { x: 3, y: 4 })).toThrow(expect.objectContaining({ code: "CANVAS_DELETED" }));
    gate.resolve();
    await deleting;
    preview.release();
  });
});
