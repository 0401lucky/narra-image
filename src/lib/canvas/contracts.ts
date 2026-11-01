import capabilityFixture from "../../../contracts/canvas/v1/capability.json";
import errorsFixture from "../../../contracts/canvas/v1/errors.json";
import inputFixture from "../../../contracts/canvas/v1/input.json";
import limitsFixture from "../../../contracts/canvas/v1/limits.json";
import retentionFixture from "../../../contracts/canvas/v1/retention.json";
import runFixture from "../../../contracts/canvas/v1/run.json";
import sceneFixture from "../../../contracts/canvas/v1/scene.json";
import statesFixture from "../../../contracts/canvas/v1/states.json";

import type {
  GenerationModeration,
  GenerationOutputFormat,
  GenerationQuality,
  GenerationSizeToken,
  ProviderMode,
} from "@/lib/types";
import type { SerializedGeneration } from "@/lib/prisma-mappers";

for (const fixture of [capabilityFixture, errorsFixture, inputFixture, limitsFixture, retentionFixture, runFixture, sceneFixture, statesFixture]) {
  if (fixture.version !== 1) throw new Error("Canvas contract fixture version is unsupported");
}

export const CANVAS_CONTRACT_VERSION = 1 as const;
export const CANVAS_LIMITS = Object.freeze(limitsFixture.limits);
export const CANVAS_ERRORS = errorsFixture.errors;
export const CANVAS_SCENE_CONTRACT = sceneFixture;
export const CANVAS_CLIENT_ID_PATTERN = new RegExp(sceneFixture.clientIdPattern, "i");
export const CANVAS_INPUT_CONTRACT = inputFixture;
export const CANVAS_RUN_CONTRACT = runFixture;
export const CANVAS_STATE_CONTRACT = statesFixture;
export const CANVAS_RETENTION_CONTRACT = retentionFixture;
export const CANVAS_CAPABILITY_CONTRACT = capabilityFixture;
export const CANVAS_IMPORT_IMAGE_TYPES = limitsFixture.verifiedImageTypes;
export const CANVAS_IMPORT_GRACE_MS = retentionFixture.graceSeconds * 1000;
export const CANVAS_RUN_OPT_IN_HEADER = inputFixture.transport.header;
export const CANVAS_RUN_OPT_IN_VALUE = inputFixture.transport.value;
export const CANVAS_RUN_REQUEST_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Content-Type": inputFixture.transport.contentType,
  [CANVAS_RUN_OPT_IN_HEADER]: CANVAS_RUN_OPT_IN_VALUE,
});

export type CanvasErrorCode = keyof typeof errorsFixture.errors;
export type CanvasAssetState = "UPLOADING" | "READY" | "QUARANTINED" | "DELETING" | "DELETED";
export type CanvasRunState = "PREPARING" | "COMMITTED" | "REJECTED";
export type CanvasPutOutcome = "NOT_STARTED" | "CONFIRMED" | "UNKNOWN";
export type CanvasDeleteOutcome = "NOT_STARTED" | "DELETED" | "MISSING" | "FAILED" | "UNKNOWN";
export type CanvasPositionV1 = { x: number; y: number };
export type CanvasViewportV1 = CanvasPositionV1 & { zoom: number };

export class CanvasContractError extends Error {
  readonly code: CanvasErrorCode;
  readonly status: number;

  constructor(code: CanvasErrorCode, options: { cause?: unknown } = {}) {
    super(CANVAS_ERRORS[code].userMessage, { cause: options.cause });
    this.name = "CanvasContractError";
    this.code = code;
    this.status = CANVAS_ERRORS[code].status;
  }
}

export function isCanvasErrorCode(value: unknown): value is CanvasErrorCode {
  return typeof value === "string" && Object.hasOwn(CANVAS_ERRORS, value);
}

export type CanvasGenerationParametersV1 = {
  providerMode: ProviderMode;
  channelId: string | null;
  model: string;
  size: GenerationSizeToken;
  quality: GenerationQuality;
  outputFormat: GenerationOutputFormat;
  outputCompression: number | null;
  moderation: GenerationModeration;
  count: number;
  negativePrompt: string | null;
  seed: number | null;
};

export type CanvasRunParametersV1 = CanvasGenerationParametersV1 & {
  generationType: "text_to_image" | "image_to_image";
};

type CanvasNodeBaseV1 = { id: string; position: CanvasPositionV1 };
export type CanvasPromptNodeV1 = CanvasNodeBaseV1 & { kind: "prompt"; text: string };
export type CanvasImportedSourceV1 = { kind: "imported"; assetId: string };
export type CanvasLocalSourceV1 = { kind: "local"; blobId: string; uploadId: string };
export type CanvasReferenceNodeV1 = CanvasNodeBaseV1 & { kind: "reference"; source: CanvasImportedSourceV1 };
export type CanvasLocalReferenceNodeV1 = CanvasNodeBaseV1 & { kind: "reference"; source: CanvasImportedSourceV1 | CanvasLocalSourceV1 };
export type CanvasGenerationNodeV1 = CanvasNodeBaseV1 & { kind: "generation"; parameters: CanvasGenerationParametersV1 };
export type CanvasResultNodeV1 = CanvasNodeBaseV1 & { kind: "result"; jobId: string; imageId: string; runId?: string };
export type CanvasNodeV1 = CanvasPromptNodeV1 | CanvasReferenceNodeV1 | CanvasGenerationNodeV1 | CanvasResultNodeV1;
export type CanvasLocalNodeV1 = CanvasPromptNodeV1 | CanvasLocalReferenceNodeV1 | CanvasGenerationNodeV1 | CanvasResultNodeV1;

type CanvasEdgeBaseV1 = { id: string; source: string; target: string };
export type CanvasEdgeV1 =
  | (CanvasEdgeBaseV1 & { kind: "prompt-input" })
  | (CanvasEdgeBaseV1 & { kind: "image-input"; ordinal: number })
  | (CanvasEdgeBaseV1 & { kind: "output-provenance" });

export type AcceptedCanvasRunBindingV1 = { runId: string; nodeId: string; jobId: string; outputsHandled: boolean };
type CanvasSceneBaseV1 = {
  schemaVersion: 1;
  edges: CanvasEdgeV1[];
  viewport: CanvasViewportV1;
  runBindings: AcceptedCanvasRunBindingV1[];
};
export type CanvasSceneV1 = CanvasSceneBaseV1 & { nodes: CanvasNodeV1[] };
export type CanvasLocalSceneV1 = CanvasSceneBaseV1 & { nodes: CanvasLocalNodeV1[] };

type CanvasRunReferenceBaseV1 = { sourceNodeId: string; ordinal: number };
export type CanvasRunReferenceV1 =
  | (CanvasRunReferenceBaseV1 & CanvasImportedSourceV1)
  | (CanvasRunReferenceBaseV1 & { kind: "result"; jobId: string; imageId: string });
export type CanvasLocalRunReferenceV1 = CanvasRunReferenceV1 | (CanvasRunReferenceBaseV1 & CanvasLocalSourceV1);

type CanvasRunProjectionBaseV1 = {
  canvasId: string;
  nodeId: string;
  runId: string;
  prompt: { sourceNodeId: string; text: string };
  params: CanvasGenerationParametersV1;
};
export type CanvasRunProjectionV1 = CanvasRunProjectionBaseV1 & { references: CanvasRunReferenceV1[] };
export type CanvasLocalRunProjectionV1 = CanvasRunProjectionBaseV1 & { references: CanvasLocalRunReferenceV1[] };
export type CanvasRunWireV1 = {
  canvasId: string;
  nodeId: string;
  runId: string;
  input: { prompt: CanvasRunProjectionV1["prompt"]; references: CanvasRunReferenceV1[] };
  parameters: CanvasRunParametersV1;
};

export type CanvasRunTransientFieldsV1 = {
  turnstileToken?: string;
  customProvider?: {
    apiKey: string;
    baseUrl: string;
    label?: string | null;
    model: string;
    models?: string[];
    remember?: boolean;
  } | null;
};
export type CanvasGenerateRequestV1 = { canvasRun: CanvasRunWireV1 } & CanvasRunTransientFieldsV1;

export type CanvasRunOutboxEntryV1 = {
  storageVersion: 1;
  ownerId: string;
  canvasId: string;
  nodeId: string;
  runId: string;
  projection: CanvasLocalRunProjectionV1;
} & (
  | { phase: "prepared" | "uncertain" | "rejected"; jobId: null }
  | { phase: "accepted"; jobId: string }
);

export type CanvasMetadataDtoV1 = {
  id: string;
  title: string;
  revision: number;
  lastSavedAt: string | null;
  hasSavedSnapshot: boolean;
  createdAt: string;
  updatedAt: string;
};
export type CanvasDocumentDtoV1 = { canvas: CanvasMetadataDtoV1; scene: CanvasSceneV1 | null };
export type CanvasSaveReceiptDtoV1 = {
  canvas: CanvasMetadataDtoV1;
  saveId: string;
  sceneHash: string;
  acknowledgedRevision: number;
};
export type CanvasAssetDtoV1 = {
  id: string;
  uploadId: string;
  state: CanvasAssetState;
  byteLength: number;
  mimeType: string;
  sha256: string;
  readyAt: string | null;
  url: string | null;
};
export type CanvasApiSuccessV1<T> = { data: T };
export type CanvasApiErrorV1 = { code: CanvasErrorCode; error: string };
export type CanvasMetadataPageDtoV1 = { canvases: CanvasMetadataDtoV1[]; nextCursor: string | null };
export type CanvasRunOriginV1 = { canvasId: string; nodeId: string; runId: string };
export type CanvasRunLookupDtoV1 =
  | { state: "COMMITTED"; origin: CanvasRunOriginV1; jobId: string; generation: SerializedGeneration | null; unavailable: "CANVAS_JOB_UNAVAILABLE" | null }
  | { state: "PREPARING"; origin: CanvasRunOriginV1; retryAfterMs: number }
  | { state: "REJECTED"; origin: CanvasRunOriginV1; code: CanvasErrorCode };
export type CanvasRunSubmissionDtoV1 = { generation: SerializedGeneration; canvasRun: CanvasRunOriginV1 & { jobId: string } };
export type CanvasRuntimeImageDtoV1 = { id: string; jobId: string; url: string; actualWidth: number | null; actualHeight: number | null; actualSize: string | null };
export type CanvasRuntimeResolveDtoV1 = {
  canvasId: string;
  generations: Record<string, SerializedGeneration>;
  images: Record<string, CanvasRuntimeImageDtoV1>;
  assets: Record<string, CanvasAssetDtoV1>;
  runs: Record<string, CanvasRunLookupDtoV1>;
  missing: Array<{ kind: "job" | "image" | "asset" | "run"; id: string; code: CanvasErrorCode }>;
};

export function canvasResultNodeId(imageId: string): string {
  return `${CANVAS_SCENE_CONTRACT.resultIdPrefix}${imageId}`;
}

export function canTransitionCanvasAsset(from: CanvasAssetState, to: CanvasAssetState): boolean {
  const transitions: Readonly<Record<CanvasAssetState, readonly string[]>> = CANVAS_STATE_CONTRACT.assetTransitions;
  return from === to || transitions[from].includes(to);
}

export function canTransitionCanvasRun(from: CanvasRunState, to: CanvasRunState): boolean {
  const transitions: Readonly<Record<CanvasRunState, readonly string[]>> = CANVAS_STATE_CONTRACT.runTransitions;
  return from === to || transitions[from].includes(to);
}

export function normalizeCanvasRunParametersV1(parameters: CanvasGenerationParametersV1, references: number): CanvasRunParametersV1 {
  const imageInput = references > 0;
  return {
    providerMode: parameters.providerMode,
    channelId: parameters.channelId,
    model: parameters.model,
    size: parameters.size,
    quality: parameters.quality,
    outputFormat: parameters.outputFormat,
    outputCompression: parameters.outputFormat === "png" ? null : parameters.outputCompression ?? 100,
    moderation: parameters.moderation,
    count: imageInput ? CANVAS_LIMITS.imageOutputCount : parameters.count,
    negativePrompt: imageInput ? null : parameters.negativePrompt,
    seed: imageInput ? null : parameters.seed,
    generationType: imageInput ? "image_to_image" : "text_to_image",
  };
}

// Build only the canonical wire projection; durable local fields are never spread into it.
export function encodeCanvasRunRequestV1(projection: CanvasRunProjectionV1, transient: CanvasRunTransientFieldsV1 = {}): CanvasGenerateRequestV1 {
  const request: CanvasGenerateRequestV1 = {
    canvasRun: {
      canvasId: projection.canvasId,
      nodeId: projection.nodeId,
      runId: projection.runId,
      input: {
        prompt: { sourceNodeId: projection.prompt.sourceNodeId, text: projection.prompt.text },
        references: projection.references.map((reference) => reference.kind === "imported"
          ? { sourceNodeId: reference.sourceNodeId, ordinal: reference.ordinal, kind: reference.kind, assetId: reference.assetId }
          : { sourceNodeId: reference.sourceNodeId, ordinal: reference.ordinal, kind: reference.kind, jobId: reference.jobId, imageId: reference.imageId }),
      },
      parameters: normalizeCanvasRunParametersV1(projection.params, projection.references.length),
    },
  };
  if (transient.turnstileToken !== undefined) request.turnstileToken = transient.turnstileToken;
  if (transient.customProvider !== undefined) {
    const provider = transient.customProvider;
    request.customProvider = provider === null ? null : {
      apiKey: provider.apiKey,
      baseUrl: provider.baseUrl,
      label: provider.label,
      model: provider.model,
      models: provider.models?.slice(),
      remember: provider.remember,
    };
  }
  return request;
}

export function canvasJsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function canonicalCanvasJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalCanvasJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalCanvasJson(item)}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new CanvasContractError("CANVAS_INVALID_INPUT");
  return encoded;
}

export type CanvasAssetRetentionFactsV1 = {
  kind: "IMPORT" | "GENERATED" | "LEGACY";
  registered: boolean;
  knownKey: boolean;
  state: CanvasAssetState;
  savedRoots: number;
  jobRoots: number;
  detachedAtMs: number | null;
  uploadExpiresAtMs: number | null;
  preparationExpiresAtMs: number | null;
  deleteExpiresAtMs: number | null;
  nextDeleteAtMs: number | null;
  needsReconciliation: boolean;
};

export function isCanvasAssetCleanupEligibleV1(facts: CanvasAssetRetentionFactsV1, databaseNowMs: number): boolean {
  if (!Number.isFinite(databaseNowMs) || facts.kind !== "IMPORT" || !facts.registered || !facts.knownKey || facts.savedRoots !== 0 || facts.jobRoots !== 0) return false;
  const active = (expiry: number | null) => expiry !== null && (!Number.isFinite(expiry) || expiry > databaseNowMs);
  if (active(facts.uploadExpiresAtMs) || active(facts.preparationExpiresAtMs) || active(facts.deleteExpiresAtMs) || active(facts.nextDeleteAtMs)) return false;
  if (facts.state === "DELETING" || (facts.state === "DELETED" && facts.needsReconciliation)) return true;
  if (facts.state !== "READY" && facts.state !== "QUARANTINED") return false;
  return facts.detachedAtMs !== null && Number.isFinite(facts.detachedAtMs) && databaseNowMs - facts.detachedAtMs >= CANVAS_IMPORT_GRACE_MS;
}

export function isCanvasStorageCapabilityV1(input: {
  verified: boolean;
  locationMatched: boolean;
  versioning: "UNVERSIONED" | "ENABLED" | "SUSPENDED" | "UNKNOWN";
  putVersionId?: string | null;
}): boolean {
  return input.verified && input.locationMatched && input.versioning === CANVAS_CAPABILITY_CONTRACT.requiredStorageVersioning && !input.putVersionId;
}

export type CanvasStorageLocationInputV1 = { endpoint: string; region: string; bucket: string };

// Hash this exact nonsecret material in the Node/Go storage adapter, not a display URL.
export function canvasStorageLocationMaterialV1(input: CanvasStorageLocationInputV1): string {
  const rawEndpoint = input.endpoint.trim();
  const authority = /^https?:\/\/([^/?#\\]+)\/?$/i.exec(rawEndpoint)?.[1];
  const authorityParts = authority && /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::([1-9][0-9]{0,4}))?$/i.exec(authority);
  let endpoint: URL;
  try { endpoint = new URL(rawEndpoint); } catch {
    throw new CanvasContractError("CANVAS_STORAGE_CAPABILITY_INVALID");
  }
  const region = input.region.trim();
  const bucket = input.bucket.trim();
  if (!authorityParts || authorityParts[1].toLowerCase() !== endpoint.hostname || !["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.pathname !== "/" || endpoint.search || endpoint.hash
    || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(region) || region.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(bucket) || bucket.length > 255 || endpoint.origin.length > 512) {
    throw new CanvasContractError("CANVAS_STORAGE_CAPABILITY_INVALID");
  }
  return JSON.stringify([endpoint.origin, region, bucket]);
}
