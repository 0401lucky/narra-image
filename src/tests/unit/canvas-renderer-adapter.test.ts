import { describe, expect, it } from "vitest";
import type { Connection } from "@xyflow/react";

import { canvasFlowEdges, canvasFlowNodes, canvasGenerationPrompt, canvasInsertionPosition, canvasNodeViewChanges, canvasVisibleNodeId, isCanvasPortConnection, isCanvasSaveShortcut, updateCanvasNodeMeasurements } from "@/components/create/canvas/renderer-adapter";
import { CANVAS_PORTS } from "@/components/create/canvas/renderer-constants";
import type { CanvasActiveView } from "@/components/create/canvas/controller-types";
import type { CanvasLocalSceneV1 } from "@/lib/canvas/contracts";

import { canvasDefaults, canvasUuid, metadata } from "./helpers/canvas-controller-fixtures";
import { canvasNodeActions } from "./helpers/canvas-renderer-fixtures";

const promptId = canvasUuid(1);
const referenceId = canvasUuid(2);
const generationId = canvasUuid(3);
const canvasId = canvasUuid(4);
const resultId = "result:image-one";
function scene(): CanvasLocalSceneV1 {
  return {
    schemaVersion: 1, viewport: { x: -140, y: -100, zoom: 0.25 },
    nodes: [
      { id: promptId, kind: "prompt", position: { x: -400, y: -50 }, text: "原始提示词" },
      { id: referenceId, kind: "reference", position: { x: -400, y: 250 }, source: { kind: "imported", assetId: "asset-one" } },
      { id: generationId, kind: "generation", position: { x: 0, y: 0 }, parameters: canvasDefaults },
      { id: resultId, kind: "result", position: { x: 380, y: -20 }, imageId: "image-one", jobId: "job-one", runId: canvasUuid(5) },
    ],
    edges: [
      { id: canvasUuid(6), kind: "prompt-input", source: promptId, target: generationId },
      { id: canvasUuid(7), kind: "output-provenance", source: generationId, target: resultId },
      { id: canvasUuid(8), kind: "image-input", source: resultId, target: generationId, ordinal: 1 },
      { id: canvasUuid(9), kind: "image-input", source: referenceId, target: generationId, ordinal: 2 },
    ],
    runBindings: [{ nodeId: generationId, runId: canvasUuid(5), jobId: "job-one", outputsHandled: true }],
  };
}
function active(): CanvasActiveView {
  return { document: { id: canvasId, title: "独立画布", cloud: metadata(canvasId), shell: "registered", editRevision: 8, savedEditRevision: 2, localState: "saved", cloudState: "dirty", deleting: false, loaded: true, error: null, warning: null },
    scene: scene(), viewport: scene().viewport, selectedNodeId: resultId, references: {}, images: {}, jobs: {}, runs: [], reservations: [], hydrating: false };
}
function connection(source: string, target: string, sourceHandle: string, targetHandle: string): Connection { return { source, target, sourceHandle, targetHandle }; }

describe("controlled canvas renderer adapter", () => {
  it("recognizes only explicit Ctrl/Cmd+S as the shared save shortcut", () => {
    expect(isCanvasSaveShortcut({ key: "s", ctrlKey: true, metaKey: false })).toBe(true);
    expect(isCanvasSaveShortcut({ key: "S", ctrlKey: false, metaKey: true })).toBe(true);
    expect(isCanvasSaveShortcut({ key: "s", ctrlKey: false, metaKey: false })).toBe(false);
    expect(isCanvasSaveShortcut({ key: "Delete", ctrlKey: true, metaKey: true })).toBe(false);
  });
  it("places new cards apart without rearranging existing negative-world geometry", () => {
    const occupied = [{ x: -150, y: -200 }, { x: -150, y: 120 }];
    expect(canvasInsertionPosition(occupied, { x: -150, y: -200 })).toEqual({ x: -150, y: 480 });
    expect(canvasInsertionPosition(occupied, { x: 210, y: -200 })).toEqual({ x: 210, y: -200 });
    expect(occupied).toEqual([{ x: -150, y: -200 }, { x: -150, y: 120 }]);
  });
  it("projects all four node kinds with stable result IDs, negative positions, selection and no source mutation", () => {
    const view = active();
    const original = JSON.stringify(view);
    const projected = canvasFlowNodes(view, false, canvasNodeActions());
    expect(projected.map((node) => node.type)).toEqual(["prompt", "reference", "generation", "result"]);
    expect(projected[0]).toMatchObject({ position: { x: -400, y: -50 }, draggable: true, dragHandle: ".canvas-node-drag-handle" });
    expect(projected[3]).toMatchObject({ id: resultId, selected: true, data: { node: { jobId: "job-one", imageId: "image-one" } } });
    expect(projected[2].data).toMatchObject({ referenceCount: 2, hasPrompt: true });
    expect(JSON.stringify(view)).toBe(original);
    view.scene.runBindings = [{ nodeId: generationId, runId: canvasUuid(10), jobId: "new-job", outputsHandled: false }];
    expect(canvasFlowNodes(view, false, canvasNodeActions())[3].data.node).toMatchObject({ imageId: "image-one", jobId: "job-one" });
  });

  it("retains measurement copies only in Flow projections, never in the controller scene", () => {
    const view = active();
    const original = JSON.stringify(view);
    const measurements = new Map([[promptId, { width: 288, height: 260 }], [resultId, { width: 288, height: 304 }]]);
    const projected = canvasFlowNodes(view, false, canvasNodeActions(), measurements);
    expect(projected[0].measured).toEqual({ width: 288, height: 260 });
    expect(projected[3].measured).toEqual({ width: 288, height: 304 });
    expect(projected[1]).not.toHaveProperty("measured");
    projected[0].measured!.height = 500;
    expect(measurements.get(promptId)).toEqual({ width: 288, height: 260 });
    expect(JSON.stringify(view)).toBe(original);
  });

  it("folds only presentation and derives prompt/shared context without changing old graph identities", () => {
    const view = active();
    const second = canvasUuid(20), note = canvasUuid(21);
    view.scene.nodes.push({ id: second, kind: "generation", parameters: canvasDefaults, position: { x: 1300, y: -700 } }, { id: note, kind: "prompt", text: "standalone", position: { x: -900, y: 1400 } });
    view.scene.edges.push({ id: canvasUuid(22), kind: "prompt-input", source: promptId, target: second });
    const before = JSON.stringify(view);
    const measurements = new Map([[promptId, { width: 288, height: 260 }]]);
    const folded = canvasFlowNodes(view, false, canvasNodeActions(), measurements, { touch: false, view: "creation" });
    expect(folded.map((node) => node.id)).toEqual([referenceId, generationId, resultId, second]);
    expect(folded.find((node) => node.id === generationId)?.data).toMatchObject({ prompt: { id: promptId, text: "原始提示词" }, sharedPromptCount: 2 });
    expect(folded.every((node) => !node.connectable)).toBe(true);
    expect(canvasFlowEdges(view.scene, true, null, null, "creation").map((edge) => edge.id)).toEqual(view.scene.edges.filter((edge) => edge.kind !== "prompt-input").map((edge) => edge.id));
    const full = canvasFlowNodes(view, false, canvasNodeActions(), measurements, { touch: false, view: "graph" });
    expect(full.map((node) => node.id)).toEqual(view.scene.nodes.map((node) => node.id));
    expect(full[0].measured).toEqual({ width: 288, height: 260 });
    expect(canvasGenerationPrompt(view.scene, second).prompt?.id).toBe(promptId);
    expect(canvasVisibleNodeId(view.scene, promptId, "creation")).toBeNull();
    expect(canvasVisibleNodeId(view.scene, note, "creation")).toBeNull();
    expect(canvasVisibleNodeId(view.scene, note, "graph")).toBe(note);
    expect(JSON.stringify(view)).toBe(before);
  });

  it("resolves a private folded source to its generator and leaves absent prompts empty", () => {
    const view = active();
    expect(canvasVisibleNodeId(view.scene, promptId, "creation")).toBe(generationId);
    view.scene.edges = view.scene.edges.filter((edge) => edge.kind !== "prompt-input");
    expect(canvasGenerationPrompt(view.scene, generationId)).toEqual({ sourceId: null, prompt: null, sharedPromptCount: 0 });
    expect(canvasVisibleNodeId(view.scene, promptId, "creation")).toBeNull();
    expect(canvasVisibleNodeId(view.scene, "missing", "graph")).toBeNull();
    const pan = canvasFlowNodes(view, false, canvasNodeActions(), undefined, { touch: false, capturedDrag: true, view: "graph", tool: "pan" });
    expect(pan.every((node) => !node.draggable && !node.selectable && !node.connectable && node.focusable)).toBe(true);
  });

  it("makes the replaced generation wrapper noninteractive without losing measurements or graph identity", () => {
    const view = active();
    const measurements = new Map([[generationId, { width: 320, height: 310 }]]);
    const before = JSON.stringify(view);
    const replaced = canvasFlowNodes(view, false, canvasNodeActions(), measurements, { touch: false, editorNodeId: generationId, view: "creation" }).find((node) => node.id === generationId)!;
    expect(replaced).toMatchObject({
      id: generationId, measured: { width: 320, height: 310 }, focusable: false, selectable: false, draggable: false, connectable: false,
      domAttributes: { inert: true, "aria-hidden": true }, style: { pointerEvents: "none" }, data: { editorReplacesCard: true },
    });
    const closed = canvasFlowNodes(view, false, canvasNodeActions(), measurements, { touch: false, view: "creation" }).find((node) => node.id === generationId)!;
    expect(closed).toMatchObject({ focusable: true, selectable: true, measured: { width: 320, height: 310 } });
    expect(closed.domAttributes?.inert).not.toBe(true);
    expect(closed.style?.pointerEvents).not.toBe("none");
    const touch = canvasFlowNodes(view, false, canvasNodeActions(), measurements, { touch: true, editorNodeId: generationId, view: "creation" }).find((node) => node.id === generationId)!;
    expect(touch).toMatchObject({ focusable: true, selectable: true, data: { editorReplacesCard: false } });
    expect(JSON.stringify(view)).toBe(before);
  });

  it("prunes removed measurements and ignores stale-node, malformed and nonmeasurement changes", () => {
    const current = new Map([[promptId, { width: 288, height: 260 }], ["removed", { width: 1, height: 1 }]]);
    const liveIds = new Set([promptId, generationId, resultId]);
    const next = updateCanvasNodeMeasurements(current, liveIds, [
      { type: "dimensions", id: generationId, dimensions: { width: 288, height: 315 } },
      { type: "dimensions", id: "late-removed-node", dimensions: { width: 300, height: 400 } },
      { type: "dimensions", id: resultId, dimensions: { width: Infinity, height: 300 } },
      { type: "dimensions", id: resultId, dimensions: { width: 288, height: 0 } },
      { type: "position", id: resultId, position: { x: -300, y: 50 } },
      { type: "remove", id: promptId },
    ]);
    expect([...next]).toEqual([[generationId, { width: 288, height: 315 }]]);
    expect([...current]).toEqual([[promptId, { width: 288, height: 260 }], ["removed", { width: 1, height: 1 }]]);
    expect(updateCanvasNodeMeasurements(next, new Set()).size).toBe(0);
  });

  it("keeps the measurement state identity stable when sizes and live membership do not change", () => {
    const current = new Map([[promptId, { width: 288, height: 260 }]]);
    const liveIds = new Set([promptId, generationId]);
    expect(updateCanvasNodeMeasurements(current, liveIds)).toBe(current);
    expect(updateCanvasNodeMeasurements(current, liveIds, [
      { type: "dimensions", id: promptId, dimensions: { width: 288, height: 260 } },
      { type: "select", id: generationId, selected: true },
    ])).toBe(current);
    expect(updateCanvasNodeMeasurements(current, liveIds, [{ type: "dimensions", id: promptId, dimensions: { width: 288, height: 400 } }]).get(promptId)).toEqual({ width: 288, height: 400 });
  });

  it("disables every per-node and edge mutation override in read-only mode", () => {
    for (const node of canvasFlowNodes(active(), true, canvasNodeActions())) expect(node).toMatchObject({ draggable: false, connectable: false, deletable: false, focusable: true, selectable: true });
    for (const edge of canvasFlowEdges(scene(), true, null)) expect(edge).toMatchObject({ deletable: false, reconnectable: false, selectable: false, focusable: false });
  });

  it("labels edges by their explicit ordinal, preserves provenance, and never orders by geometry", () => {
    const edges = canvasFlowEdges(scene(), false, canvasUuid(8));
    expect(edges[2]).toMatchObject({ label: "参考 1", selected: true, source: resultId, sourceHandle: CANVAS_PORTS.imageOutput, targetHandle: CANVAS_PORTS.imageInput });
    expect(edges[3]).toMatchObject({ label: "参考 2", source: referenceId });
    expect(edges[1]).toMatchObject({ sourceHandle: CANVAS_PORTS.provenanceOutput, targetHandle: CANVAS_PORTS.provenanceInput, deletable: false, reconnectable: false });
  });

  it.each([
    ["prompt", connection(promptId, generationId, CANVAS_PORTS.promptOutput, CANVAS_PORTS.promptInput), true],
    ["reference", connection(referenceId, generationId, CANVAS_PORTS.imageOutput, CANVAS_PORTS.imageInput), true],
    ["prior result feedback", connection(resultId, generationId, CANVAS_PORTS.imageOutput, CANVAS_PORTS.imageInput), true],
    ["wrong prompt port", connection(promptId, generationId, CANVAS_PORTS.promptOutput, CANVAS_PORTS.imageInput), false],
    ["wrong reference port", connection(referenceId, generationId, CANVAS_PORTS.imageOutput, CANVAS_PORTS.promptInput), false],
    ["manufactured provenance", connection(generationId, resultId, CANVAS_PORTS.provenanceOutput, CANVAS_PORTS.provenanceInput), false],
    ["generation is not an image", connection(generationId, generationId, CANVAS_PORTS.imageOutput, CANVAS_PORTS.imageInput), false],
    ["missing source", connection("missing", generationId, CANVAS_PORTS.imageOutput, CANVAS_PORTS.imageInput), false],
    ["literal self", connection(promptId, promptId, CANVAS_PORTS.promptOutput, CANVAS_PORTS.promptInput), false],
  ])("handles %s without a competing graph scheduler", (_, proposed, valid) => { expect(isCanvasPortConnection(scene(), proposed)).toBe(valid); });

  it("drops all measurements/library replacements and permits only explicit domain movement/removal", () => {
    const changes = canvasNodeViewChanges([
      { type: "dimensions", id: promptId, dimensions: { width: 500, height: 200 }, setAttributes: true },
      { type: "replace", id: promptId, item: canvasFlowNodes(active(), false, canvasNodeActions())[0] },
      { type: "position", id: promptId, position: { x: -222, y: -111 }, dragging: true },
      { type: "remove", id: referenceId },
    ], resultId, false);
    expect(changes).toEqual([{ kind: "move", nodeId: promptId, position: { x: -222, y: -111 } }, { kind: "remove", nodeId: referenceId }]);
  });

  it("keeps selection but filters movement/removal/addition even if a library callback fires on a phone", () => {
    expect(canvasNodeViewChanges([
      { type: "select", id: promptId, selected: true }, { type: "select", id: resultId, selected: false },
      { type: "position", id: promptId, position: { x: 800, y: 400 } }, { type: "remove", id: referenceId },
    ], resultId, true)).toEqual([{ kind: "select", nodeId: promptId }]);
    expect(canvasNodeViewChanges([{ type: "select", id: resultId, selected: false }], resultId, true)).toEqual([{ kind: "select", nodeId: null }]);
  });
});
