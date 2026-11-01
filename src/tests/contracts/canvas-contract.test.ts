// @vitest-environment node

import graphFixture from "../../../contracts/canvas/v1/scenarios/graph.json";
import storageFixture from "../../../contracts/canvas/v1/scenarios/storage-location.json";
import { createHash } from "node:crypto";
import lifecycleFixture from "../../../contracts/canvas/v1/scenarios/lifecycle.json";
import retentionFixture from "../../../contracts/canvas/v1/scenarios/retention.json";
import {
  CANVAS_ERRORS,
  CANVAS_INPUT_CONTRACT,
  CANVAS_LIMITS,
  CANVAS_RETENTION_CONTRACT,
  CANVAS_RUN_REQUEST_HEADERS,
  CANVAS_SCENE_CONTRACT,
  canTransitionCanvasAsset,
  canTransitionCanvasRun,
  canonicalCanvasJson,
  canvasStorageLocationMaterialV1,
  encodeCanvasRunRequestV1,
  isCanvasAssetCleanupEligibleV1,
  isCanvasStorageCapabilityV1,
  type CanvasAssetRetentionFactsV1,
  type CanvasAssetState,
  type CanvasRunState,
  type CanvasSceneV1,
} from "@/lib/canvas/contracts";
import { resolveCanvasProjectionAssetsV1, resolveCanvasRunProjectionV1 } from "@/lib/canvas/graph";
import {
  canvasDocumentDtoSchema,
  canvasGenerateRequestSchema,
  canvasLocalSceneSchema,
  canvasRunOutboxSchema,
  canvasSceneSchema,
  canvasSnapshotSchema,
  canvasUploadDeclarationSchema,
  canvasClientIdSchema,
} from "@/lib/validators";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scene = () => canvasSceneSchema.parse(structuredClone(graphFixture.scene));
const projection = () => resolveCanvasProjectionAssetsV1(resolveCanvasRunProjectionV1(scene(), graphFixture.origin, graphFixture.runtime).projection, graphFixture.runtime.ownerId, {});

describe("canvas shared contract v1", () => {
  it("round-trips only domain scene fields and accepts bounded opaque canonical IDs", () => {
    const parsed: CanvasSceneV1 = scene();
    expect(canvasSceneSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
    expect(Object.keys(parsed).sort()).toEqual([...CANVAS_SCENE_CONTRACT.fields].sort());
    expect(parsed.nodes[0].position.x).toBeLessThan(0);
    expect(parsed.nodes[3].id).toBe("result:fixture-image-1");
  });

  it("rejects unknown versions, non-finite geometry, editor fields and durable secrets", () => {
    expect(canvasSceneSchema.safeParse({ ...scene(), schemaVersion: 2 }).success).toBe(false);
    for (const coordinate of [NaN, Infinity, -Infinity]) {
      const candidate = scene();
      candidate.nodes[0].position.x = coordinate;
      expect(canvasSceneSchema.safeParse(candidate).success).toBe(false);
    }
    for (const field of ["apiKey", "url", "status", "selected", "measured", "data", "callbacks", "ownerId", "title"]) {
      expect(canvasSceneSchema.safeParse({ ...scene(), [field]: "transient" }).success).toBe(false);
      const candidate = scene();
      candidate.nodes[2] = { ...candidate.nodes[2], [field]: "transient" };
      expect(canvasSceneSchema.safeParse(candidate).success).toBe(false);
    }
    const candidate = scene();
    const node = candidate.nodes[2];
    if (node.kind !== "generation") throw new Error("fixture generation missing");
    expect(canvasSceneSchema.safeParse({ ...candidate, nodes: candidate.nodes.map((item) => item.id === node.id ? { ...node, parameters: { ...node.parameters, apiKey: "secret", baseUrl: "https://provider.invalid" } } : item) }).success).toBe(false);
  });

  it("keeps incomplete prompts savable and local blob locators out of cloud scenes", () => {
    const candidate = scene();
    const prompt = candidate.nodes[0];
    if (prompt.kind !== "prompt") throw new Error("fixture prompt missing");
    prompt.text = "";
    expect(canvasSnapshotSchema.safeParse({ expectedRevision: 0, saveId: uuid(200), scene: candidate }).success).toBe(true);
    expect(() => resolveCanvasRunProjectionV1(candidate, graphFixture.origin, graphFixture.runtime)).toThrow(CANVAS_ERRORS.CANVAS_PROMPT_REQUIRED.userMessage);
    const local = { ...candidate, nodes: candidate.nodes.map((node) => node.kind === "reference" && node.id === uuid(2) ? { ...node, source: { kind: "local", blobId: uuid(201), uploadId: uuid(202) } } : node) };
    expect(canvasLocalSceneSchema.safeParse(local).success).toBe(true);
    expect(canvasSceneSchema.safeParse(local).success).toBe(false);
    for (const source of [{ kind: "imported", assetId: "blob:preview" , url: "blob:preview" }, { kind: "url", url: "data:image/png;base64,aA==" }]) {
      expect(canvasLocalSceneSchema.safeParse({ ...candidate, nodes: candidate.nodes.map((node) => node.id === uuid(2) ? { ...node, source } : node) }).success).toBe(false);
    }
  });

  it("never mistakes provisional outbox identity for an acknowledged cloud binding", () => {
    const frozen = projection();
    const outbox = { storageVersion: 1, ownerId: "fixture-owner", ...graphFixture.origin, projection: frozen, phase: "uncertain", jobId: null };
    expect(canvasRunOutboxSchema.safeParse(outbox).success).toBe(true);
    expect(canvasRunOutboxSchema.safeParse({ ...outbox, turnstileToken: "secret" }).success).toBe(false);
    expect(canvasRunOutboxSchema.safeParse({ ...outbox, phase: "accepted" }).success).toBe(false);
    expect(canvasRunOutboxSchema.safeParse({ ...outbox, runId: uuid(999) }).success).toBe(false);
    expect(canvasSceneSchema.safeParse({ ...scene(), runBindings: [{ runId: uuid(51), nodeId: uuid(3), jobId: null, outputsHandled: false }] }).success).toBe(false);
  });

  it("has exactly one strict nested encoder, freezes inputs and normalizes image-edit count", () => {
    const frozen = projection();
    const request = encodeCanvasRunRequestV1(frozen, { turnstileToken: "runtime-only", customProvider: { apiKey: "runtime-key", baseUrl: "https://provider.invalid/v1", model: "gpt-image-2" } });
    expect(Object.keys(request.canvasRun).sort()).toEqual([...CANVAS_INPUT_CONTRACT.wireFields].sort());
    expect(CANVAS_RUN_REQUEST_HEADERS).toMatchObject({ "Content-Type": "application/json", "X-Narra-Canvas-Run": "1" });
    expect(canvasGenerateRequestSchema.parse(request).canvasRun.parameters).toMatchObject({ generationType: "image_to_image", count: 1, negativePrompt: null, seed: null });
    expect(JSON.stringify(request.canvasRun)).not.toContain("runtime-key");
    frozen.prompt.text = "new edit";
    frozen.references.reverse();
    expect(request.canvasRun.input.prompt.text).toBe("fixture prompt");
    expect(request.canvasRun.input.references.map((reference) => reference.ordinal)).toEqual([1, 2]);
    for (const field of ["prompt", "imageUrls", "referenceImageUrls", "conversationId", "replaceGenerationId", "images"]) expect(canvasGenerateRequestSchema.safeParse({ ...request, [field]: "mixed legacy body" }).success).toBe(false);
    expect(canvasGenerateRequestSchema.safeParse({ ...request, canvasRun: { ...request.canvasRun, prompt: request.canvasRun.input.prompt } }).success).toBe(false);
    expect(canvasGenerateRequestSchema.safeParse({ ...request, canvasRun: { ...request.canvasRun, parameters: { ...request.canvasRun.parameters, generationType: "text_to_video" } } }).success).toBe(false);
    expect(canvasGenerateRequestSchema.safeParse({ ...request, canvasRun: { ...request.canvasRun, parameters: { ...request.canvasRun.parameters, count: 4 } } }).success).toBe(false);
  });

  it("bounds normalized UTF-8 scenes, bodies and upload declarations", () => {
    const oversized = { ...scene(), edges: [], runBindings: [], nodes: Array.from({ length: 100 }, (_, index) => ({ id: uuid(300 + index), kind: "prompt", position: { x: 0, y: 0 }, text: "汉".repeat(2000) })) };
    expect(canvasSceneSchema.safeParse(oversized).success).toBe(false);
    expect(canvasUploadDeclarationSchema.safeParse({ uploadId: uuid(900), byteLength: CANVAS_LIMITS.importBytes, mimeType: "image/png", sha256: "a".repeat(64) }).success).toBe(true);
    for (const changes of [{ byteLength: CANVAS_LIMITS.importBytes + 1 }, { mimeType: "image/svg+xml" }, { sha256: "not-a-digest" }, { ownerId: "foreign" }, { key: "user-selected" }]) expect(canvasUploadDeclarationSchema.safeParse({ uploadId: uuid(900), byteLength: 8, mimeType: "image/png", sha256: "a".repeat(64), ...changes }).success).toBe(false);
  });

  it("distinguishes scene-null metadata shells from saved snapshots", () => {
    const metadata = { id: graphFixture.origin.canvasId, title: "Canvas", revision: 0, lastSavedAt: null, hasSavedSnapshot: false, createdAt: "2026-10-29T00:00:00.000Z", updatedAt: "2026-10-29T00:00:00.000Z" };
    expect(canvasDocumentDtoSchema.safeParse({ canvas: metadata, scene: null }).success).toBe(true);
    expect(canvasDocumentDtoSchema.safeParse({ canvas: { ...metadata, hasSavedSnapshot: true }, scene: null }).success).toBe(false);
    expect(canvasDocumentDtoSchema.safeParse({ canvas: metadata, scene: scene() }).success).toBe(false);
    expect(canonicalCanvasJson({ b: 2, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":2}');
  });

  it("consumes shared monotonic lifecycle and verified-unversioned capability vectors", () => {
    for (const vector of lifecycleFixture.assetVectors) expect(canTransitionCanvasAsset(vector.from as CanvasAssetState, vector.to as CanvasAssetState), JSON.stringify(vector)).toBe(vector.allowed);
    for (const vector of lifecycleFixture.runVectors) expect(canTransitionCanvasRun(vector.from as CanvasRunState, vector.to as CanvasRunState), JSON.stringify(vector)).toBe(vector.allowed);
    for (const vector of lifecycleFixture.capabilityVectors) expect(isCanvasStorageCapabilityV1({ ...vector, versioning: vector.versioning as "UNVERSIONED" | "ENABLED" | "SUSPENDED" | "UNKNOWN" }), JSON.stringify(vector)).toBe(vector.allowed);
    expect(CANVAS_RETENTION_CONTRACT.clock).toBe("database");
    expect(CANVAS_RETENTION_CONTRACT.jobRootsSurvive).toContain("userDelete");
  });

  it("uses the exact seven-day database-clock boundary and retains every authoritative root", () => {
    for (const vector of retentionFixture.vectors) expect(isCanvasAssetCleanupEligibleV1({ ...retentionFixture.facts, ...vector.changes } as CanvasAssetRetentionFactsV1, retentionFixture.databaseNowMs), vector.id).toBe(vector.eligible);
    expect(isCanvasAssetCleanupEligibleV1(retentionFixture.facts as CanvasAssetRetentionFactsV1, NaN)).toBe(false);
  });

  it("shares a conservative storage identity recipe across Node and Go", () => {
    for (const vector of storageFixture.vectors) {
      if (vector.valid) {
        const material = canvasStorageLocationMaterialV1(vector.input);
        expect(material, vector.id).toBe(vector.material);
        expect(`s3-v1:${createHash("sha256").update(material, "utf8").digest("hex")}`, vector.id).toBe(vector.storageLocation);
      } else expect(() => canvasStorageLocationMaterialV1(vector.input), vector.id).toThrow();
    }
  });

  it("rejects sentinel UUIDs and a single source claimed as both prompt and image", () => {
    expect(canvasClientIdSchema.safeParse("00000000-0000-0000-0000-000000000000").success).toBe(false);
    expect(canvasClientIdSchema.safeParse("ffffffff-ffff-ffff-ffff-ffffffffffff").success).toBe(false);
    const request = encodeCanvasRunRequestV1(projection());
    request.canvasRun.input.references[0].sourceNodeId = request.canvasRun.input.prompt.sourceNodeId;
    expect(canvasGenerateRequestSchema.safeParse(request).success).toBe(false);
  });
});
