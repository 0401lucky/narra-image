// @vitest-environment node

import graphFixture from "../../../contracts/canvas/v1/scenarios/graph.json";
import {
  CANVAS_ERRORS,
  CANVAS_LIMITS,
  type CanvasLocalSceneV1,
  type CanvasSceneV1,
} from "@/lib/canvas/contracts";
import {
  assertCanvasOutputCapacityV1,
  collectCanvasSavedAssetIdsV1,
  removeCanvasNodeV1,
  resolveCanvasProjectionAssetsV1,
  resolveCanvasRunProjectionV1,
  validateCanvasGraphV1,
} from "@/lib/canvas/graph";
import { canvasSceneSchema } from "@/lib/validators";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scene = () => canvasSceneSchema.parse(structuredClone(graphFixture.scene));

function patch(value: unknown, path: Array<string | number>, replacement: unknown) {
  let target = value;
  for (const segment of path.slice(0, -1)) {
    if (target === null || typeof target !== "object") throw new Error("invalid fixture patch");
    target = (target as Record<string | number, unknown>)[segment];
  }
  if (target === null || typeof target !== "object") throw new Error("invalid fixture patch");
  (target as Record<string | number, unknown>)[path[path.length - 1]] = replacement;
}

describe("canvas direct graph contracts", () => {
  it("shares typed edge/origin vectors without imposing a DAG ban", () => {
    for (const vector of graphFixture.vectors) {
      const candidate = scene();
      for (const change of vector.patches) patch(candidate, change.path, change.value);
      const issues = validateCanvasGraphV1(candidate);
      expect(issues.length === 0, vector.id).toBe(vector.valid);
      if ("errorCode" in vector) expect(issues.map((item) => item.code), vector.id).toContain(vector.errorCode);
    }
    expect(resolveCanvasRunProjectionV1(scene(), graphFixture.origin, graphFixture.runtime).projection.references.map((reference) => reference.kind)).toEqual(["imported", "result"]);
  });

  it("resolves one prompt and zero through sixteen references, not node position or array order", () => {
    for (const vector of graphFixture.cardinalityVectors) {
      const base = scene();
      const references = Array.from({ length: vector.count }, (_, index) => ({ id: uuid(200 + index), kind: "reference" as const, position: { x: -index, y: index }, source: { kind: "imported" as const, assetId: `asset-${index}` } }));
      const candidate: CanvasSceneV1 = { ...base, nodes: [...base.nodes.filter((node) => node.kind === "prompt" || node.kind === "generation"), ...references.reverse()], edges: [base.edges[0], ...references.map((node, index) => ({ id: uuid(400 + index), kind: "image-input" as const, source: node.id, target: uuid(3), ordinal: vector.count - index }))], runBindings: [] };
      const assets = Object.fromEntries(references.map((node) => [node.source.assetId, { assetId: node.source.assetId, ownerId: "fixture-owner", state: "READY", byteLength: 1 }]));
      if (vector.valid) expect(resolveCanvasRunProjectionV1(candidate, graphFixture.origin, { ownerId: "fixture-owner", images: {}, assets }).projection.references.map((reference) => reference.ordinal)).toEqual(Array.from({ length: vector.count }, (_, index) => index + 1));
      else expect(() => resolveCanvasRunProjectionV1(candidate, graphFixture.origin, { ownerId: "fixture-owner", images: {}, assets })).toThrow();
    }
  });

  it("rejects duplicate prompt, typed source, canonical asset and ordinal identities", () => {
    const base = scene();
    const secondPrompt = { id: uuid(6), kind: "prompt" as const, position: { x: 0, y: 0 }, text: "second prompt" };
    expect(validateCanvasGraphV1({ ...base, nodes: [...base.nodes, secondPrompt], edges: [...base.edges, { id: uuid(106), kind: "prompt-input", source: secondPrompt.id, target: uuid(3) }] }).map((item) => item.code)).toContain("CANVAS_DUPLICATE_INPUT");
    const duplicateAsset = { id: uuid(7), kind: "reference" as const, position: { x: 0, y: 0 }, source: { kind: "imported" as const, assetId: "fixture-asset-1" } };
    expect(validateCanvasGraphV1({ ...base, nodes: [...base.nodes, duplicateAsset], edges: [...base.edges, { id: uuid(107), kind: "image-input", source: duplicateAsset.id, target: uuid(3), ordinal: 3 }] }).map((item) => item.code)).toContain("CANVAS_DUPLICATE_INPUT");
    expect(validateCanvasGraphV1({ ...base, edges: [...base.edges, { id: uuid(108), kind: "image-input", source: uuid(2), target: uuid(3), ordinal: 1 }] }).map((item) => item.code)).toContain("CANVAS_REFERENCE_ORDER_INVALID");
  });

  it("blocks foreign, pending, missing and expired inputs and reports unknown generated sizes honestly", () => {
    const base = scene();
    for (const runtime of [
      { ...graphFixture.runtime, ownerId: "foreign-owner" },
      { ...graphFixture.runtime, assets: {} },
      { ...graphFixture.runtime, assets: { "fixture-asset-1": { ...graphFixture.runtime.assets["fixture-asset-1"], state: "DELETING" } } },
      { ...graphFixture.runtime, images: { "fixture-image-1": { ...graphFixture.runtime.images["fixture-image-1"], status: "PROCESSING" } } },
    ]) expect(() => resolveCanvasRunProjectionV1(base, graphFixture.origin, runtime)).toThrow(CANVAS_ERRORS.CANVAS_INPUT_UNAVAILABLE.userMessage);
    const resolved = resolveCanvasRunProjectionV1(base, graphFixture.origin, graphFixture.runtime);
    expect(resolved.hasUnknownInputBytes).toBe(true);
    expect(resolved.knownInputBytes).toBe(1024);
    expect(() => resolveCanvasRunProjectionV1(base, graphFixture.origin, { ...graphFixture.runtime, assets: { "fixture-asset-1": { ...graphFixture.runtime.assets["fixture-asset-1"], byteLength: CANVAS_LIMITS.decodedInputBytes + 1 } } })).toThrow(CANVAS_ERRORS.CANVAS_LIMIT_EXCEEDED.userMessage);
  });

  it("freezes local originals and maps only their captured ready owner/upload identities", () => {
    const base = scene();
    const local: CanvasLocalSceneV1 = { ...base, nodes: base.nodes.map((node) => node.id === uuid(2) ? { id: node.id, kind: "reference", position: node.position, source: { kind: "local", blobId: uuid(701), uploadId: uuid(702) } } : node) };
    const captured = resolveCanvasRunProjectionV1(local, graphFixture.origin, { ...graphFixture.runtime, localBlobs: { [uuid(701)]: { available: true, byteLength: 1024 } } }).projection;
    const ready = { assetId: "uploaded-original", uploadId: uuid(702), ownerId: "fixture-owner", state: "READY", byteLength: 1024 };
    expect(resolveCanvasProjectionAssetsV1(captured, "fixture-owner", { [uuid(702)]: ready }).references[0]).toMatchObject({ kind: "imported", assetId: "uploaded-original", sourceNodeId: uuid(2), ordinal: 1 });
    expect(() => resolveCanvasProjectionAssetsV1(captured, "fixture-owner", { [uuid(702)]: { ...ready, uploadId: uuid(703) } })).toThrow();
    expect(() => resolveCanvasProjectionAssetsV1(captured, "fixture-owner", { [uuid(702)]: { ...ready, ownerId: "foreign" } })).toThrow();
    expect(captured.references[0].kind).toBe("local");
  });

  it("removes organization only, compacts input order and never resets durable output suppression", () => {
    const base = scene();
    const withoutInput = removeCanvasNodeV1(base, uuid(2));
    expect(withoutInput.edges.filter((edge) => edge.kind === "image-input")).toMatchObject([{ ordinal: 1 }]);
    const withoutResult = removeCanvasNodeV1(base, "result:fixture-image-1");
    expect(withoutResult.runBindings[0].outputsHandled).toBe(true);
    const withoutGeneration = removeCanvasNodeV1(base, uuid(3));
    expect(withoutGeneration.runBindings).toEqual([]);
    expect(withoutGeneration.nodes.some((node) => node.kind === "result")).toBe(true);
    expect(base.nodes).toHaveLength(5);
    expect(collectCanvasSavedAssetIdsV1(base)).toEqual(["fixture-asset-1", "fixture-unused-asset"]);
  });

  it("reserves restored immutable output count before edits, not edited generation parameters", () => {
    const base = scene();
    const full: CanvasSceneV1 = { ...base, nodes: [...base.nodes, ...Array.from({ length: 191 }, (_, index) => ({ id: uuid(800 + index), kind: "prompt" as const, position: { x: 0, y: 0 }, text: "" }))] };
    expect(() => assertCanvasOutputCapacityV1(full, [{ count: 4, outputsHandled: false }])).not.toThrow();
    expect(() => assertCanvasOutputCapacityV1(full, [{ count: 4, outputsHandled: false }], { nodes: 1 })).toThrow();
    expect(() => assertCanvasOutputCapacityV1(full, [{ count: null, outputsHandled: false }], { nodes: 1 })).toThrow();
    expect(() => assertCanvasOutputCapacityV1(full, [{ count: 4, outputsHandled: true }], { nodes: 4 })).not.toThrow();
  });
});
