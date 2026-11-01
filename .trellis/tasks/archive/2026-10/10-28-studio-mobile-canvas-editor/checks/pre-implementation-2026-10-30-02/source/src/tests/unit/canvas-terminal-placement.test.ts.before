import { afterEach, describe, expect, it } from "vitest";

import { CANVAS_LIMITS, canvasResultNodeId, type AcceptedCanvasRunBindingV1, type CanvasLocalNodeV1, type CanvasLocalSceneV1, type CanvasPositionV1 } from "@/lib/canvas/contracts";
import { canvasLocalSceneSchema } from "@/lib/validators";
import { canvasInsertionPosition, emptyCanvasScene, materializeCanvasTerminal } from "@/components/create/canvas/commands";
import type { CanvasController } from "@/components/create/canvas/controller";

import { canvasControllerFixture, canvasDefaults, canvasUuid, completedJob } from "./helpers/canvas-controller-fixtures";

const controllers: CanvasController[] = [];
afterEach(() => { for (const controller of controllers.splice(0)) controller.dispose(); });

function fixture(position: CanvasPositionV1 = { x: 0, y: 0 }) {
  const binding: AcceptedCanvasRunBindingV1 = { nodeId: canvasUuid(1), runId: canvasUuid(2), jobId: "first-job", outputsHandled: false };
  const scene: CanvasLocalSceneV1 = {
    ...emptyCanvasScene(),
    nodes: [{ id: binding.nodeId, kind: "generation", parameters: { ...canvasDefaults, count: 4 }, position }],
    runBindings: [binding],
  };
  return { binding, scene };
}

function materialize(scene: CanvasLocalSceneV1, binding: AcceptedCanvasRunBindingV1, count = 4) {
  let sequence = 1000;
  return materializeCanvasTerminal(scene, binding, completedJob(binding.jobId, count), [], () => canvasUuid(++sequence));
}

function expectSeparated(left: CanvasPositionV1, right: CanvasPositionV1) {
  // Default cards are 288px wide; unavailable result content also needs >320px height.
  expect(Math.abs(left.x - right.x) >= 320 || Math.abs(left.y - right.y) >= 360).toBe(true);
}

function expectNewCardsClear(scene: CanvasLocalSceneV1, original: readonly CanvasLocalNodeV1[]) {
  const originalIds = new Set(original.map((node) => node.id));
  const results = scene.nodes.filter((node) => !originalIds.has(node.id));
  for (const result of results) {
    for (const other of scene.nodes) if (other.id !== result.id) expectSeparated(result.position, other.position);
  }
}

describe("canvas terminal result placement", () => {
  it("uses the same deterministic insertion scan regardless of scene node order", () => {
    const occupied = Object.freeze([{ x: -300, y: 400 }, { x: -300, y: -100 }, { x: -300, y: 800 }]);
    const before = JSON.stringify(occupied);
    const preferred = { x: -300, y: -100 };
    const position = canvasInsertionPosition(occupied, preferred);
    expect(position).toEqual({ x: -300, y: 1160 });
    expect(canvasInsertionPosition([...occupied].reverse(), preferred)).toEqual(position);
    expect(canvasInsertionPosition(occupied, { x: 20, y: -100 })).toEqual({ x: 20, y: -100 });
    for (const other of occupied) expectSeparated(position, other);
    expect(preferred).toEqual({ x: -300, y: -100 });
    expect(JSON.stringify(occupied)).toBe(before);
  });

  it.each([-1000.1, -0.1, 0.1, 1e20, -1e20])("accounts for floating-point clearance at %s", (y) => {
    const occupied = [{ x: 0, y }];
    const position = canvasInsertionPosition(occupied, { x: 0, y });
    expectSeparated(position, occupied[0]);
    expect(Number.isFinite(position.y)).toBe(true);
  });

  it("rejects invalid insertion coordinates without silently corrupting a scene", () => {
    for (const preferred of [{ x: Infinity, y: 0 }, { x: 0, y: NaN }]) {
      expect(() => canvasInsertionPosition([], preferred)).toThrow(expect.objectContaining({ code: "CANVAS_INVALID_INPUT" }));
    }
  });

  it("places a complete four-image batch with enough default-card clearance", () => {
    const { scene, binding } = fixture();
    const before = JSON.stringify(scene);
    const result = materialize(scene, binding);
    expect(result.nodes.filter((node) => node.kind === "result").map((node) => node.id)).toEqual(
      completedJob(binding.jobId, 4).images.map((image) => canvasResultNodeId(image.id)),
    );
    expectNewCardsClear(result, scene.nodes);
    expect(result.edges).toHaveLength(4);
    expect(result.runBindings).toEqual([{ ...binding, outputsHandled: true }]);
    expect(JSON.stringify(scene)).toBe(before);
  });

  it("avoids each nearby node kind rather than testing only prior results or equal coordinates", () => {
    const { scene, binding } = fixture();
    scene.nodes.push(
      { id: canvasUuid(3), kind: "prompt", text: "nearby prompt", position: { x: 440, y: -50 } },
      { id: canvasUuid(4), kind: "reference", source: { kind: "imported", assetId: "existing-asset" }, position: { x: 355, y: 430 } },
      { id: canvasUuid(5), kind: "generation", parameters: canvasDefaults, position: { x: 405, y: 900 } },
      { id: canvasResultNodeId("existing-image"), kind: "result", jobId: "existing-job", imageId: "existing-image", position: { x: 370, y: 1360 } },
    );
    const before = JSON.stringify(scene);
    const result = materialize(scene, binding);
    expectNewCardsClear(result, scene.nodes);
    expect(result.nodes.slice(0, scene.nodes.length)).toEqual(scene.nodes);
    expect(JSON.stringify(scene)).toBe(before);
    expect(materialize(scene, binding).nodes).toEqual(result.nodes);
  });

  it("preserves negative fractional world coordinates and the camera", () => {
    const { scene, binding } = fixture({ x: -1832.5, y: -2750.25 });
    scene.viewport = { x: -500.75, y: 30.5, zoom: 0.25 };
    const result = materialize(scene, binding);
    const results = result.nodes.filter((node) => node.kind === "result");
    expect(results[0].position).toEqual({ x: -1452.5, y: -2750.25 });
    expect(results.every((node) => node.position.x < 0 && node.position.y < 0)).toBe(true);
    expectNewCardsClear(result, scene.nodes);
    expect(result.nodes[0]).toEqual(scene.nodes[0]);
    expect(result.viewport).toEqual(scene.viewport);
    expect(canvasLocalSceneSchema.parse(JSON.parse(JSON.stringify(result)))).toEqual(result);
  });

  it("fits the reserved four-image batch at the 200-node limit without dropping or moving cards", () => {
    const { scene, binding } = fixture();
    for (let index = 1; index < CANVAS_LIMITS.sceneNodes - 4; index += 1) {
      scene.nodes.push({ id: canvasUuid(index + 10), kind: "prompt", text: "occupied", position: { x: 380, y: (index - 1) * 360 } });
    }
    const result = materialize(scene, binding);
    expect(result.nodes).toHaveLength(CANVAS_LIMITS.sceneNodes);
    expectNewCardsClear(result, scene.nodes);
    expect(result.nodes.slice(0, scene.nodes.length)).toEqual(scene.nodes);
    expect(result.runBindings[0].outputsHandled).toBe(true);
  });

  it.each([Number.MAX_VALUE, -Number.MAX_VALUE])("keeps accepted finite extreme coordinates finite (%s)", (coordinate) => {
    const { scene, binding } = fixture({ x: coordinate, y: coordinate });
    const result = materialize(scene, binding);
    expectNewCardsClear(result, scene.nodes);
    expect(result.nodes.every((node) => Number.isFinite(node.position.x) && Number.isFinite(node.position.y))).toBe(true);
    expect(result.nodes[0].position).toEqual({ x: coordinate, y: coordinate });
    expect(result.nodes).toHaveLength(5);
  });

  it("preserves capacity errors without partially appending or marking the output handled", () => {
    const { scene, binding } = fixture();
    for (let index = 1; index < CANVAS_LIMITS.sceneNodes - 3; index += 1) {
      scene.nodes.push({ id: canvasUuid(index + 10), kind: "prompt", text: "occupied", position: { x: -400, y: index * 400 } });
    }
    const before = JSON.stringify(scene);
    expect(() => materialize(scene, binding)).toThrow(expect.objectContaining({ code: "CANVAS_OUTPUT_CAPACITY_EXCEEDED" }));
    expect(JSON.stringify(scene)).toBe(before);
  });

  it("never allocates a replacement for handled or removed results", () => {
    const { scene, binding } = fixture();
    const first = materialize(scene, binding);
    const removedId = canvasResultNodeId(completedJob(binding.jobId).images[0].id);
    const removed = { ...first, nodes: first.nodes.filter((node) => node.id !== removedId), edges: first.edges.filter((edge) => edge.target !== removedId) };
    expect(materialize(removed, removed.runBindings[0])).toBe(removed);
    expect(removed.nodes.some((node) => node.id === removedId)).toBe(false);
  });

  it("manual reruns append separate stable cards while preserving old downstream input and durable positions", async () => {
    const f = canvasControllerFixture();
    controllers.push(f.controller);
    const { canvasId, nodeId, promptId } = await f.newGraph();
    f.controller.updateParameters(canvasId, nodeId, { count: 2 });
    const firstRun = await f.controller.runNode(canvasId, nodeId);
    const firstBinding = f.controller.getSnapshot().active!.scene.runBindings[0];
    const firstJob = completedJob(firstBinding.jobId, 2);
    f.jobs.push({ ownerId: f.options.ownerId, canvasId, nodeId, runId: firstRun }, firstJob);
    const firstResults = f.controller.getSnapshot().active!.scene.nodes.filter((node) => node.kind === "result");
    const downstream = f.controller.addGeneration(canvasId, { x: 820, y: 10 });
    f.controller.connect(canvasId, promptId, downstream);
    const downstreamEdge = f.controller.connect(canvasId, firstResults[0].id, downstream);
    const beforeRerun = f.controller.getSnapshot().active!.scene;
    const secondRun = await f.controller.runNode(canvasId, nodeId);
    const secondBinding = f.controller.getSnapshot().active!.scene.runBindings.find((entry) => entry.nodeId === nodeId)!;
    f.jobs.push({ ownerId: f.options.ownerId, canvasId, nodeId, runId: secondRun }, completedJob(secondBinding.jobId, 2));
    const result = f.controller.getSnapshot().active!.scene;
    expect(secondRun).not.toBe(firstRun);
    expect(result.nodes.filter((node) => node.kind === "result")).toHaveLength(4);
    expectNewCardsClear(result, beforeRerun.nodes);
    for (const node of beforeRerun.nodes) expect(result.nodes.find((entry) => entry.id === node.id)).toEqual(node);
    expect(result.edges.find((edge) => edge.id === downstreamEdge)).toMatchObject({ source: firstResults[0].id, target: downstream, kind: "image-input", ordinal: 1 });
    expect(result.runBindings.find((entry) => entry.nodeId === nodeId)?.outputsHandled).toBe(true);
    await f.controller.flushLocal();
    expect(f.store.row(f.options.ownerId, canvasId)?.envelope.scene).toEqual(result);
    expect(f.api.runs.size).toBe(2);
  });
});
