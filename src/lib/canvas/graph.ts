import {
  CANVAS_ERRORS,
  CANVAS_LIMITS,
  CanvasContractError,
  canvasResultNodeId,
  type CanvasEdgeV1,
  type CanvasErrorCode,
  type CanvasLocalRunProjectionV1,
  type CanvasLocalRunReferenceV1,
  type CanvasLocalSceneV1,
  type CanvasRunProjectionV1,
  type CanvasSceneV1,
} from "./contracts";

import { GENERATION_PROMPT_MAX_LENGTH } from "@/lib/generation/limits";

export type CanvasGraphIssueV1 = { code: CanvasErrorCode; path: Array<string | number>; message: string };
function issue(code: CanvasErrorCode, path: Array<string | number>): CanvasGraphIssueV1 {
  return { code, path, message: CANVAS_ERRORS[code].userMessage };
}

function sourceIdentity(reference: CanvasLocalRunReferenceV1): string {
  switch (reference.kind) {
    case "imported": return `imported:${reference.assetId}`;
    case "result": return `result:${reference.imageId}`;
    case "local": return `local:${reference.blobId}`;
  }
}

export function validateCanvasRunReferencesV1(references: readonly CanvasLocalRunReferenceV1[]): CanvasGraphIssueV1[] {
  const issues: CanvasGraphIssueV1[] = [];
  const sources = new Set<string>();
  const identities = new Set<string>();
  const ordinals = new Set<number>();
  if (references.length > CANVAS_LIMITS.referencesPerRun) issues.push(issue("CANVAS_LIMIT_EXCEEDED", ["references"]));
  references.forEach((reference, index) => {
    const identity = sourceIdentity(reference);
    if (sources.has(reference.sourceNodeId) || identities.has(identity)) issues.push(issue("CANVAS_DUPLICATE_INPUT", ["references", index]));
    if (!Number.isInteger(reference.ordinal) || reference.ordinal < 1 || reference.ordinal > references.length || ordinals.has(reference.ordinal)) issues.push(issue("CANVAS_REFERENCE_ORDER_INVALID", ["references", index, "ordinal"]));
    if (reference.kind === "result" && reference.sourceNodeId !== canvasResultNodeId(reference.imageId)) issues.push(issue("CANVAS_ORIGIN_MISMATCH", ["references", index, "sourceNodeId"]));
    sources.add(reference.sourceNodeId);
    identities.add(identity);
    ordinals.add(reference.ordinal);
  });
  return issues;
}

export function validateCanvasGraphV1(scene: CanvasLocalSceneV1): CanvasGraphIssueV1[] {
  const issues: CanvasGraphIssueV1[] = [];
  const nodes = new Map(scene.nodes.map((node) => [node.id, node]));
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const edgeIdentities = new Set<string>();
  const promptCounts = new Map<string, number>();
  const imageInputs = new Map<string, CanvasLocalRunReferenceV1[]>();
  scene.nodes.forEach((node, index) => {
    if (nodeIds.has(node.id)) issues.push(issue("CANVAS_DUPLICATE_INPUT", ["nodes", index, "id"]));
    if (node.kind === "result" && node.id !== canvasResultNodeId(node.imageId)) issues.push(issue("CANVAS_ORIGIN_MISMATCH", ["nodes", index, "id"]));
    nodeIds.add(node.id);
  });
  scene.edges.forEach((edge, index) => {
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    const identity = `${edge.kind}:${edge.source}:${edge.target}`;
    if (edgeIds.has(edge.id) || edgeIdentities.has(identity)) issues.push(issue("CANVAS_DUPLICATE_INPUT", ["edges", index]));
    edgeIds.add(edge.id);
    edgeIdentities.add(identity);
    if (!source || !target || edge.source === edge.target) {
      issues.push(issue("CANVAS_INVALID_CONNECTION", ["edges", index]));
      return;
    }
    switch (edge.kind) {
      case "prompt-input": {
        if (source.kind !== "prompt" || target.kind !== "generation") issues.push(issue("CANVAS_INVALID_CONNECTION", ["edges", index]));
        const count = (promptCounts.get(edge.target) ?? 0) + 1;
        promptCounts.set(edge.target, count);
        if (count > 1) issues.push(issue("CANVAS_DUPLICATE_INPUT", ["edges", index]));
        break;
      }
      case "image-input": {
        if (target.kind !== "generation" || (source.kind !== "reference" && source.kind !== "result")) {
          issues.push(issue("CANVAS_INVALID_CONNECTION", ["edges", index]));
          break;
        }
        const reference: CanvasLocalRunReferenceV1 = source.kind === "reference"
          ? { sourceNodeId: source.id, ordinal: edge.ordinal, ...source.source }
          : { sourceNodeId: source.id, ordinal: edge.ordinal, kind: "result", imageId: source.imageId, jobId: source.jobId };
        imageInputs.set(edge.target, [...(imageInputs.get(edge.target) ?? []), reference]);
        break;
      }
      case "output-provenance": {
        if (source.kind !== "generation" || target.kind !== "result" || !target.runId) {
          issues.push(issue("CANVAS_INVALID_CONNECTION", ["edges", index]));
          break;
        }
        const binding = scene.runBindings.find((item) => item.runId === target.runId);
        // Older immutable outputs need not be the generation's current binding.
        if (binding && (binding.nodeId !== source.id || binding.jobId !== target.jobId)) issues.push(issue("CANVAS_ORIGIN_MISMATCH", ["edges", index]));
        break;
      }
    }
  });
  for (const [target, references] of imageInputs) {
    for (const problem of validateCanvasRunReferencesV1(references)) issues.push({ ...problem, path: ["edges", target, ...problem.path] });
  }
  const bindingNodes = new Set<string>();
  const bindingRuns = new Set<string>();
  scene.runBindings.forEach((binding, index) => {
    if (nodes.get(binding.nodeId)?.kind !== "generation") issues.push(issue("CANVAS_ORIGIN_MISMATCH", ["runBindings", index, "nodeId"]));
    if (bindingNodes.has(binding.nodeId) || bindingRuns.has(binding.runId)) issues.push(issue("CANVAS_DUPLICATE_INPUT", ["runBindings", index]));
    bindingNodes.add(binding.nodeId);
    bindingRuns.add(binding.runId);
  });
  return issues;
}

export type CanvasAssetInputV1 = { assetId: string; ownerId: string; state: string; byteLength: number; uploadId?: string };
export type CanvasResultInputV1 = { imageId: string; jobId: string; ownerId: string; status: string; available: boolean; byteLength?: number };
export type CanvasInputRuntimeV1 = {
  ownerId: string;
  assets: Readonly<Record<string, CanvasAssetInputV1 | undefined>>;
  images: Readonly<Record<string, CanvasResultInputV1 | undefined>>;
  localBlobs?: Readonly<Record<string, { available: boolean; byteLength: number } | undefined>>;
};
export type CanvasProjectionResultV1 = {
  projection: CanvasLocalRunProjectionV1;
  knownInputBytes: number;
  hasUnknownInputBytes: boolean;
};

// Only direct edges are resolved. Provenance feedback never traverses or schedules a graph.
export function resolveCanvasRunProjectionV1(scene: CanvasLocalSceneV1, origin: { canvasId: string; nodeId: string; runId: string }, runtime: CanvasInputRuntimeV1): CanvasProjectionResultV1 {
  const problems = validateCanvasGraphV1(scene);
  if (problems.length > 0) throw new CanvasContractError(problems[0].code);
  const target = scene.nodes.find((node) => node.id === origin.nodeId);
  if (target?.kind !== "generation") throw new CanvasContractError("CANVAS_INVALID_CONNECTION");
  const prompts = scene.edges.filter((edge) => edge.target === target.id && edge.kind === "prompt-input");
  const prompt = scene.nodes.find((node) => node.id === prompts[0]?.source);
  if (prompts.length !== 1 || prompt?.kind !== "prompt" || prompt.text.trim().length < 2 || prompt.text.trim().length > GENERATION_PROMPT_MAX_LENGTH) throw new CanvasContractError("CANVAS_PROMPT_REQUIRED");
  const references: CanvasLocalRunReferenceV1[] = [];
  let knownInputBytes = 0;
  let hasUnknownInputBytes = false;
  const countBytes = (bytes: number | undefined) => {
    if (bytes === undefined) { hasUnknownInputBytes = true; return; }
    if (!Number.isSafeInteger(bytes) || bytes < 1) throw new CanvasContractError("CANVAS_INPUT_UNAVAILABLE");
    knownInputBytes += bytes;
    if (knownInputBytes > CANVAS_LIMITS.decodedInputBytes) throw new CanvasContractError("CANVAS_LIMIT_EXCEEDED");
  };
  const inputs = scene.edges.filter((edge): edge is Extract<CanvasEdgeV1, { kind: "image-input" }> => edge.target === target.id && edge.kind === "image-input").sort((a, b) => a.ordinal - b.ordinal);
  for (const edge of inputs) {
    const source = scene.nodes.find((node) => node.id === edge.source);
    if (source?.kind === "reference") {
      if (source.source.kind === "local") {
        const blob = runtime.localBlobs?.[source.source.blobId];
        if (!blob?.available) throw new CanvasContractError("CANVAS_INPUT_UNAVAILABLE");
        countBytes(blob.byteLength);
      } else {
        const asset = runtime.assets[source.source.assetId];
        if (!asset || asset.assetId !== source.source.assetId || asset.ownerId !== runtime.ownerId || asset.state !== "READY") throw new CanvasContractError("CANVAS_INPUT_UNAVAILABLE");
        countBytes(asset.byteLength);
      }
      references.push({ sourceNodeId: source.id, ordinal: edge.ordinal, ...source.source });
    } else if (source?.kind === "result") {
      const image = runtime.images[source.imageId];
      if (!image || image.imageId !== source.imageId || image.jobId !== source.jobId || image.ownerId !== runtime.ownerId || image.status !== "SUCCEEDED" || !image.available) throw new CanvasContractError("CANVAS_INPUT_UNAVAILABLE");
      countBytes(image.byteLength);
      references.push({ sourceNodeId: source.id, ordinal: edge.ordinal, kind: "result", jobId: source.jobId, imageId: source.imageId });
    } else throw new CanvasContractError("CANVAS_INVALID_CONNECTION");
  }
  return {
    projection: { ...origin, prompt: { sourceNodeId: prompt.id, text: prompt.text.trim() }, references, params: { ...target.parameters } },
    knownInputBytes,
    hasUnknownInputBytes,
  };
}

export function resolveCanvasProjectionAssetsV1(projection: CanvasLocalRunProjectionV1, ownerId: string, uploads: Readonly<Record<string, CanvasAssetInputV1 | undefined>>): CanvasRunProjectionV1 {
  return {
    ...projection,
    references: projection.references.map((reference) => {
      if (reference.kind !== "local") return { ...reference };
      const asset = uploads[reference.uploadId];
      if (!asset || asset.ownerId !== ownerId || asset.state !== "READY" || asset.uploadId !== reference.uploadId) throw new CanvasContractError("CANVAS_INPUT_UNAVAILABLE");
      return { kind: "imported", assetId: asset.assetId, sourceNodeId: reference.sourceNodeId, ordinal: reference.ordinal };
    }),
  };
}

export function collectCanvasSavedAssetIdsV1(scene: CanvasSceneV1): string[] {
  return [...new Set(scene.nodes.flatMap((node) => node.kind === "reference" ? [node.source.assetId] : []))].sort();
}

export function compactCanvasImageOrdinalsV1(edges: readonly CanvasEdgeV1[]): CanvasEdgeV1[] {
  const ordered = new Map<string, Map<string, number>>();
  for (const edge of edges) {
    if (edge.kind !== "image-input" || ordered.has(edge.target)) continue;
    const inputs = edges.filter((item): item is Extract<CanvasEdgeV1, { kind: "image-input" }> => item.kind === "image-input" && item.target === edge.target).sort((a, b) => a.ordinal - b.ordinal);
    ordered.set(edge.target, new Map(inputs.map((item, index) => [item.id, index + 1])));
  }
  return edges.map((edge) => edge.kind === "image-input" ? { ...edge, ordinal: ordered.get(edge.target)?.get(edge.id) ?? edge.ordinal } : { ...edge });
}

export function removeCanvasNodeV1<T extends CanvasLocalSceneV1>(scene: T, nodeId: string): T {
  return {
    ...scene,
    nodes: scene.nodes.filter((node) => node.id !== nodeId),
    edges: compactCanvasImageOrdinalsV1(scene.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId)),
    runBindings: scene.runBindings.filter((binding) => binding.nodeId !== nodeId),
  };
}

export function assertCanvasOutputCapacityV1(scene: CanvasLocalSceneV1, reservations: readonly { count: number | null; outputsHandled: boolean }[], additions: { nodes?: number; edges?: number } = {}): void {
  if ([additions.nodes ?? 0, additions.edges ?? 0].some((count) => !Number.isSafeInteger(count) || count < 0)) throw new CanvasContractError("CANVAS_OUTPUT_CAPACITY_EXCEEDED");
  if (reservations.some((item) => !item.outputsHandled && item.count === null)) throw new CanvasContractError("CANVAS_OUTPUT_CAPACITY_EXCEEDED");
  const reserved = reservations.reduce((sum, item) => sum + (item.outputsHandled ? 0 : item.count ?? 0), 0);
  if (reservations.some((item) => item.count !== null && (!Number.isInteger(item.count) || item.count < 1 || item.count > CANVAS_LIMITS.textOutputCount)) || scene.nodes.length + reserved + (additions.nodes ?? 0) > CANVAS_LIMITS.sceneNodes || scene.edges.length + reserved + (additions.edges ?? 0) > CANVAS_LIMITS.sceneEdges) throw new CanvasContractError("CANVAS_OUTPUT_CAPACITY_EXCEEDED");
}
