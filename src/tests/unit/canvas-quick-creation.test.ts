import { afterEach, describe, expect, it, vi } from "vitest";

import { applyCanvasEdit, emptyCanvasScene } from "@/components/create/canvas/commands";
import type { CanvasController } from "@/components/create/canvas/controller";
import { CANVAS_LIMITS, CanvasContractError, canvasJsonByteLength } from "@/lib/canvas/contracts";

import { canvasControllerFixture, canvasUuid, completedJob } from "./helpers/canvas-controller-fixtures";

const controllers: CanvasController[] = [];
function fixture() { const f = canvasControllerFixture(); controllers.push(f.controller); return f; }
function image(name = "original.png") { return new File(["image"], name, { type: "image/png" }); }
afterEach(() => { controllers.splice(0).forEach((controller) => controller.dispose()); vi.restoreAllMocks(); });

describe("atomic image-first canvas commands", () => {
  it("prepares a complete private prompt/generator in one publication without submitting or uploading", async () => {
    const f = fixture();
    await f.controller.start();
    const canvasId = await f.controller.newCanvas();
    const before = f.controller.getSnapshot().active!;
    const changed = vi.fn();
    const off = f.controller.subscribe(changed);
    const created = f.controller.createQuickGeneration(canvasId, { position: { x: -80, y: 40 }, promptText: "a warm landscape" });
    off();
    const active = f.controller.getSnapshot().active!;
    expect(changed).toHaveBeenCalledTimes(1);
    expect(active.document.editRevision).toBe(before.document.editRevision + 1);
    expect(active.selectedNodeId).toBe(created.generationNodeId);
    expect(active.scene.nodes).toEqual([
      { id: created.promptNodeId, kind: "prompt", text: "a warm landscape", position: { x: -460, y: 40 } },
      { id: created.generationNodeId, kind: "generation", parameters: f.options.defaultParameters, position: { x: -80, y: 40 } },
    ]);
    expect(active.scene.edges).toEqual([{ id: created.promptEdgeId, kind: "prompt-input", source: created.promptNodeId, target: created.generationNodeId }]);
    const other = f.controller.createQuickGeneration(canvasId, { position: { x: 400, y: 40 } });
    expect(other.promptNodeId).not.toBe(created.promptNodeId);
    expect(f.api.port.submit).not.toHaveBeenCalled();
    expect(f.api.port.upload).not.toHaveBeenCalled();
    expect(f.api.port.save).not.toHaveBeenCalled();
  });

  it("continues from an immutable result with explicit ordered inputs and one later manual run", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    await f.controller.runNode(canvasId, nodeId);
    const binding = f.controller.getSnapshot().active!.scene.runBindings[0];
    f.jobs.push({ ownerId: "owner-one", canvasId, nodeId, runId: binding.runId }, completedJob(binding.jobId));
    const before = f.controller.getSnapshot().active!.scene;
    const result = before.nodes.find((node) => node.kind === "result")!;
    const reference = f.controller.importReference(canvasId, image(), { x: 0, y: 400 });
    const created = f.controller.createQuickGeneration(canvasId, { position: { x: 800, y: 0 }, promptText: "make it brighter", sourceNodeIds: [result.id, reference] });
    expect(f.controller.getSnapshot().active!.scene.nodes.find((node) => node.id === result.id)).toEqual(result);
    expect(f.controller.getSnapshot().active!.scene.edges.filter((edge) => edge.target === created.generationNodeId && edge.kind === "image-input").map((edge) => [edge.source, edge.kind === "image-input" && edge.ordinal])).toEqual([[result.id, 1], [reference, 2]]);
    expect(f.api.port.submit).toHaveBeenCalledTimes(1);
    await f.controller.runNode(canvasId, created.generationNodeId);
    expect(f.api.port.submit).toHaveBeenCalledTimes(2);
    const submission = vi.mocked(f.api.port.submit).mock.calls[1][0];
    expect(submission.nodeId).toBe(created.generationNodeId);
    expect(submission.prompt.text).toBe("make it brighter");
    expect(submission.references.map((source) => source.sourceNodeId)).toEqual([result.id, reference]);
  });

  it("rejects canonical duplicates, invalid sources and oversized prompt without a partial group or selection", async () => {
    const f = fixture();
    const { canvasId, promptId } = await f.newGraph();
    const reference = f.controller.importReference(canvasId, image(), { x: 0, y: 400 });
    const duplicate = f.controller.reuseReference(canvasId, reference, { x: 0, y: 800 });
    for (const input of [
      { sourceNodeIds: [reference, duplicate] }, { sourceNodeIds: [promptId] },
      { sourceNodeIds: [canvasUuid(900)] }, { promptText: "x".repeat(9000) },
      { position: { x: NaN, y: 0 } },
      { placementBounds: { minX: 10, maxX: 0, minY: 0, maxY: 10 } },
    ]) {
      const before = f.controller.getSnapshot();
      expect(() => f.controller.createQuickGeneration(canvasId, { position: { x: 800, y: 0 }, ...input })).toThrow(CanvasContractError);
      expect(f.controller.getSnapshot()).toBe(before);
    }
    expect(f.api.port.submit).not.toHaveBeenCalled();
  });

  it("repairs a missing prompt atomically, preserves shared prompts and rejects a stale expected binding", async () => {
    const f = fixture();
    const { canvasId, nodeId, promptId } = await f.newGraph();
    const other = f.controller.addGeneration(canvasId, { x: 800, y: 0 });
    f.controller.connect(canvasId, promptId, other);
    f.controller.updateGenerationPrompt(canvasId, other, { text: "shared edit", expectedPromptNodeId: promptId });
    expect(f.controller.getSnapshot().active!.scene.edges.filter((edge) => edge.kind === "prompt-input").map((edge) => edge.source)).toEqual([promptId, promptId]);
    const edge = f.controller.getSnapshot().active!.scene.edges.find((item) => item.target === other)!;
    f.controller.disconnect(canvasId, edge.id);
    const before = f.controller.getSnapshot();
    expect(() => f.controller.updateGenerationPrompt(canvasId, other, { text: "stale edit", expectedPromptNodeId: promptId })).toThrow(CanvasContractError);
    expect(f.controller.getSnapshot()).toBe(before);
    const repaired = f.controller.updateGenerationPrompt(canvasId, other, { text: "a", expectedPromptNodeId: null });
    f.controller.updateGenerationPrompt(canvasId, other, { text: "ab", expectedPromptNodeId: repaired.promptNodeId });
    expect(f.controller.getSnapshot().active!.scene.nodes.find((node) => node.id === repaired.promptNodeId)).toMatchObject({ text: "ab" });
    expect(f.controller.getSnapshot().active!.scene.edges.find((item) => item.target === nodeId)).toMatchObject({ source: promptId });
    expect(f.api.port.submit).not.toHaveBeenCalled();
  });

  it("accepts imports and appended edges together, preserving previous ordinals and target selection", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    const first = f.controller.importReference(canvasId, image(), { x: 0, y: 400 });
    const edge = f.controller.connect(canvasId, first, nodeId);
    f.controller.selectNode(canvasId, nodeId);
    const changed = vi.fn();
    const off = f.controller.subscribe(changed);
    const imported = f.controller.importReferences(canvasId, { files: [image("two.png"), image("three.png")], position: { x: -500, y: 0 }, attachToGenerationNodeId: nodeId });
    off();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(f.controller.getSnapshot().active!.selectedNodeId).toBe(nodeId);
    expect(f.controller.getSnapshot().active!.scene.edges.filter((item) => item.kind === "image-input")).toEqual([
      { id: edge, kind: "image-input", source: first, target: nodeId, ordinal: 1 },
      ...imported.referenceNodeIds.map((source, index) => ({ id: imported.imageEdgeIds[index], kind: "image-input", source, target: nodeId, ordinal: index + 2 })),
    ]);
    expect(f.api.port.upload).not.toHaveBeenCalled();
    expect(f.api.port.submit).not.toHaveBeenCalled();
  });

  it("rejects an invalid final file or deleted import target without publishing any originals or nodes", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    const before = f.controller.getSnapshot();
    expect(() => f.controller.importReferences(canvasId, { files: [image(), new File(["text"], "bad.txt", { type: "text/plain" })], position: { x: 0, y: 400 } })).toThrow(CanvasContractError);
    expect(() => f.controller.importReferences(canvasId, { files: [image()], position: { x: 0, y: 400 }, placementBounds: { minX: 0, maxX: 10, minY: 20, maxY: 10 } })).toThrow(CanvasContractError);
    expect(f.controller.getSnapshot()).toBe(before);
    f.controller.removeNode(canvasId, nodeId);
    const removed = f.controller.getSnapshot();
    expect(() => f.controller.importReferences(canvasId, { files: [image()], position: { x: 0, y: 400 }, attachToGenerationNodeId: nodeId })).toThrow(CanvasContractError);
    expect(f.controller.getSnapshot()).toBe(removed);
    await f.controller.saveCanvas(canvasId);
    expect(f.api.port.upload).not.toHaveBeenCalled();
  });

  it("rejects combined scene growth and unknown output reservations before adding part of a group", () => {
    const scene = emptyCanvasScene();
    scene.nodes = Array.from({ length: CANVAS_LIMITS.sceneNodes - 1 }, (_, index) => ({ id: canvasUuid(index + 100), kind: "prompt", text: "", position: { x: 0, y: index * 360 } }));
    const command = { kind: "creation-group" as const, nodes: [
      { id: canvasUuid(500), kind: "prompt" as const, text: "new", position: { x: 800, y: 0 } },
      { id: canvasUuid(501), kind: "prompt" as const, text: "new", position: { x: 800, y: 400 } },
    ], connections: [] };
    const before = JSON.stringify(scene);
    expect(() => applyCanvasEdit(scene, command, [])).toThrow(new CanvasContractError("CANVAS_OUTPUT_CAPACITY_EXCEEDED"));
    expect(JSON.stringify(scene)).toBe(before);
    expect(() => applyCanvasEdit(emptyCanvasScene(), command, [{ runId: canvasUuid(600), nodeId: canvasUuid(601), count: null, outputsHandled: false }])).toThrow(CanvasContractError);
  });

  it("uses refined scene-byte validation for composite edits and preserves the input scene", () => {
    const scene = emptyCanvasScene();
    const text = "x".repeat(8000);
    for (let index = 0; ; index++) {
      const node = { id: canvasUuid(index + 100), kind: "prompt" as const, text, position: { x: 0, y: index * 360 } };
      if (canvasJsonByteLength({ ...scene, nodes: [...scene.nodes, node] }) > CANVAS_LIMITS.sceneBytes) break;
      scene.nodes.push(node);
    }
    const before = JSON.stringify(scene);
    expect(() => applyCanvasEdit(scene, { kind: "creation-group", nodes: [{ id: canvasUuid(700), kind: "prompt", text, position: { x: 800, y: 0 } }], connections: [] }, [])).toThrow(CanvasContractError);
    expect(JSON.stringify(scene)).toBe(before);
  });

  it("keeps expected-edge replacement and true readOnly/owner fencing", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    const first = f.controller.importReference(canvasId, image(), { x: 0, y: 400 });
    const next = f.controller.importReference(canvasId, image("next.png"), { x: 0, y: 800 });
    const edge = f.controller.connect(canvasId, first, nodeId);
    f.controller.replaceConnection(canvasId, edge, next, first);
    const before = f.controller.getSnapshot();
    expect(() => f.controller.replaceConnection(canvasId, edge, first, first)).toThrow(CanvasContractError);
    expect(f.controller.getSnapshot()).toBe(before);
    f.controller.setReadOnly(true);
    expect(() => f.controller.createQuickGeneration(canvasId, { position: { x: 0, y: 0 } })).toThrow(/仅支持查看/);
    expect(() => f.controller.importReferences(canvasId, { files: [image()], position: { x: 0, y: 0 } })).toThrow(/仅支持查看/);
    f.controller.dispose();
    expect(() => f.controller.updateGenerationPrompt(canvasId, nodeId, { text: "forbidden", expectedPromptNodeId: null })).toThrow(/账户已切换/);
  });
});
