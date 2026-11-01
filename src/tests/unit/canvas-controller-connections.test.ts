import { afterEach, describe, expect, it, vi } from "vitest";

import { applyCanvasEdit } from "@/components/create/canvas/commands";
import type { CanvasController } from "@/components/create/canvas/controller";
import { CanvasContractError, type CanvasLocalSceneV1 } from "@/lib/canvas/contracts";

import { canvasControllerFixture, canvasUuid, completedJob, metadata } from "./helpers/canvas-controller-fixtures";

const controllers: CanvasController[] = [];
function fixture() { const f = canvasControllerFixture(); controllers.push(f.controller); return f; }
function original(name: string) { return new File(["png"], name, { type: "image/png" }); }
afterEach(() => { controllers.splice(0).forEach((controller) => controller.dispose()); vi.restoreAllMocks(); });

describe("atomic captured input replacement", () => {
  it("publishes one validated prompt replacement while retaining edge identity and pending output reservation", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    const other = f.controller.addPrompt(canvasId, { x: 0, y: 400 }, "next prompt");
    await f.controller.runNode(canvasId, nodeId);
    const before = f.controller.getSnapshot().active!;
    const edge = before.scene.edges[0];
    const published: CanvasLocalSceneV1[] = [];
    const unsubscribe = f.controller.subscribe(() => published.push(f.controller.getSnapshot().active!.scene));
    f.controller.replaceConnection(canvasId, edge.id, other);
    unsubscribe();
    expect(published).toHaveLength(1);
    expect(published[0].edges).toEqual([{ ...edge, source: other }]);
    expect(f.controller.getSnapshot().active!.reservations).toEqual(before.reservations);
    expect(f.controller.getSnapshot().active!.document.editRevision).toBe(before.document.editRevision + 1);
    expect(f.api.port.submit).toHaveBeenCalledTimes(1);
    expect(vi.mocked(f.api.port.submit).mock.calls[0][0].prompt.text).toBe("frozen prompt");
  });

  it("replaces an ordered image with a local original before upload and submits the new frozen order only on Run", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    const first = f.controller.importReference(canvasId, original("one.png"), { x: 0, y: 400 });
    const second = f.controller.importReference(canvasId, original("two.png"), { x: 0, y: 800 });
    const next = f.controller.importReference(canvasId, original("three.png"), { x: 0, y: 1200 });
    const edgeId = f.controller.connect(canvasId, first, nodeId);
    const secondEdge = f.controller.connect(canvasId, second, nodeId);
    f.controller.replaceConnection(canvasId, edgeId, next);
    expect(f.controller.getSnapshot().active!.scene.edges.filter((edge) => edge.kind === "image-input")).toEqual([
      { id: edgeId, kind: "image-input", source: next, target: nodeId, ordinal: 1 },
      { id: secondEdge, kind: "image-input", source: second, target: nodeId, ordinal: 2 },
    ]);
    expect(f.api.port.upload).not.toHaveBeenCalled();
    expect(f.api.port.submit).not.toHaveBeenCalled();
    await f.controller.runNode(canvasId, nodeId);
    expect(vi.mocked(f.api.port.submit).mock.calls[0][0].references.map((input) => [input.sourceNodeId, input.ordinal])).toEqual([[next, 1], [second, 2]]);
  });

  it("rejects canonical duplicates and wrong-kind sources without publishing a disconnect or changing order", async () => {
    const f = fixture();
    const { canvasId, nodeId, promptId } = await f.newGraph();
    const first = f.controller.importReference(canvasId, original("one.png"), { x: 0, y: 400 });
    const second = f.controller.importReference(canvasId, original("two.png"), { x: 0, y: 800 });
    const duplicate = f.controller.reuseReference(canvasId, second, { x: 0, y: 1200 });
    const edge = f.controller.connect(canvasId, first, nodeId);
    f.controller.connect(canvasId, second, nodeId);
    const before = f.controller.getSnapshot();
    const changed = vi.fn();
    const unsubscribe = f.controller.subscribe(changed);
    for (const candidate of [duplicate, second, promptId, nodeId, canvasUuid(900)]) expect(() => f.controller.replaceConnection(canvasId, edge, candidate)).toThrow(CanvasContractError);
    unsubscribe();
    expect(f.controller.getSnapshot()).toBe(before);
    expect(changed).not.toHaveBeenCalled();
    expect(f.api.port.submit).not.toHaveBeenCalled();
    expect(f.api.port.save).not.toHaveBeenCalled();
  });

  it.each(["missing", "mismatched"])("retains the original edge for a %s canonical result", async (availability) => {
    const f = fixture();
    const canvasId = canvasUuid(100);
    const promptId = canvasUuid(101);
    const nodeId = canvasUuid(102);
    const resultId = "result:unavailable-image";
    f.api.documents.set(canvasId, { canvas: metadata(canvasId, { hasSavedSnapshot: true }), scene: {
      schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, runBindings: [],
      nodes: [{ id: promptId, kind: "prompt", text: "saved prompt", position: { x: 0, y: 0 } },
        { id: nodeId, kind: "generation", parameters: f.options.defaultParameters, position: { x: 400, y: 0 } },
        { id: resultId, kind: "result", imageId: "unavailable-image", jobId: "expected-job", position: { x: 800, y: 0 } }],
      edges: [{ id: canvasUuid(103), kind: "prompt-input", source: promptId, target: nodeId }],
    } });
    if (availability === "mismatched") {
      const resolve = vi.mocked(f.api.port.resolve).getMockImplementation()!;
      vi.mocked(f.api.port.resolve).mockImplementation(async (...args) => ({ ...await resolve(...args), images: {
        "unavailable-image": { id: "unavailable-image", jobId: "foreign-job", url: "https://images.invalid/foreign.png", actualWidth: 1, actualHeight: 1, actualSize: "1x1" },
      } }));
    }
    await f.controller.start();
    const ref = f.controller.importReference(canvasId, original("local.png"), { x: 0, y: 400 });
    const edge = f.controller.connect(canvasId, ref, nodeId);
    const before = f.controller.getSnapshot().active!;
    expect(() => f.controller.replaceConnection(canvasId, edge, resultId)).toThrow(new CanvasContractError("CANVAS_INPUT_UNAVAILABLE"));
    expect(f.controller.getSnapshot().active).toEqual(before);
    expect(f.api.port.submit).not.toHaveBeenCalled();
  });

  it("keeps provenance immutable while permitting a ready old result to feed its generator", async () => {
    const f = fixture();
    const { canvasId, nodeId, promptId } = await f.newGraph();
    await f.controller.runNode(canvasId, nodeId);
    const binding = f.controller.getSnapshot().active!.scene.runBindings[0];
    f.jobs.push({ ownerId: "owner-one", canvasId, nodeId, runId: binding.runId }, completedJob(binding.jobId));
    const source = f.controller.importReference(canvasId, original("local.png"), { x: 0, y: 400 });
    const input = f.controller.connect(canvasId, source, nodeId);
    const before = f.controller.getSnapshot().active!.scene;
    const provenance = before.edges.find((edge) => edge.kind === "output-provenance")!;
    expect(() => f.controller.replaceConnection(canvasId, provenance.id, promptId)).toThrow(CanvasContractError);
    expect(f.controller.getSnapshot().active!.scene).toEqual(before);
    f.controller.replaceConnection(canvasId, input, provenance.target);
    expect(f.controller.getSnapshot().active!.scene.edges.find((edge) => edge.id === input)).toMatchObject({ source: provenance.target, ordinal: 1 });
    expect(f.api.port.submit).toHaveBeenCalledTimes(1);
  });

  it("does not consume/release unknown reserved output capacity for a pure zero-growth replacement", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    const next = f.controller.addPrompt(canvasId, { x: 0, y: 400 }, "next prompt");
    const scene = f.controller.getSnapshot().active!.scene;
    const held = [{ nodeId, runId: canvasUuid(900), count: null, outputsHandled: false }];
    const changed = applyCanvasEdit(scene, { kind: "replace-connection", edgeId: scene.edges[0].id, source: next }, held);
    expect(scene.edges[0].source).not.toBe(next);
    expect(changed.edges[0]).toEqual({ ...scene.edges[0], source: next });
    expect(held).toEqual([{ nodeId, runId: canvasUuid(900), count: null, outputsHandled: false }]);
  });

  it("retains true read-only and disposed-owner rejection for the new command", async () => {
    const f = fixture();
    const { canvasId, promptId } = await f.newGraph();
    const edgeId = f.controller.getSnapshot().active!.scene.edges[0].id;
    f.controller.setReadOnly(true);
    expect(() => f.controller.replaceConnection(canvasId, edgeId, promptId)).toThrow(/仅支持查看/);
    f.controller.dispose();
    expect(() => f.controller.replaceConnection(canvasId, edgeId, promptId)).toThrow(/账户已切换/);
  });
});
