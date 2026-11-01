import { describe, expect, it } from "vitest";
import type { Connection } from "@xyflow/react";

import { canvasFlowEdges, canvasFlowNodes, canvasInsertionPosition, canvasNodeViewChanges, isCanvasPortConnection, isCanvasSaveShortcut, updateCanvasNodeMeasurements } from "@/components/create/canvas/renderer-adapter";
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
