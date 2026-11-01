import type {
  CanvasAssetDtoV1, CanvasGenerationParametersV1, CanvasLocalSceneV1,
  CanvasMetadataDtoV1, CanvasRuntimeImageDtoV1, CanvasViewportV1,
} from "@/lib/canvas/contracts";
import { CanvasContractError } from "@/lib/canvas/contracts";

import type { GenerationItem } from "../types";
import { canvasClientErrorMessage, type CanvasClientApi } from "./client-api";
import type { CanvasCapacityReservation } from "./commands";
import {
  CanvasDraftStoreError, type CanvasDraftBlobV1, type CanvasDraftEnvelopeV1,
  type CanvasDraftStore, type CanvasWriteStamp,
} from "./draft-types";
import type { CanvasReferenceRuntime, CanvasReferenceRuntimeOptions } from "./reference-runtime";
import type { AcquireCanvasTransientLease, CanvasJobOrigin, CanvasJobsPort } from "./studio-bridge";

type LocalState = "pending" | "saved" | "failed" | "conflict";
type CloudState = "local" | "dirty" | "saving" | "saved" | "failed" | "conflict";
export type CanvasRunView = { runId: string; nodeId: string; jobId: string | null; phase: "preparing" | "submitting" | "uncertain" | "pending" | "succeeded" | "failed" | "rejected" | "unavailable"; error: string | null };
export type CanvasDocumentView = {
  id: string;
  title: string;
  cloud: CanvasMetadataDtoV1 | null;
  shell: CanvasDraftEnvelopeV1["shell"];
  editRevision: number;
  savedEditRevision: number | null;
  localState: LocalState;
  cloudState: CloudState;
  deleting: boolean;
  loaded: boolean;
  error: string | null;
  warning: string | null;
};
export type CanvasReferenceView = { state: "local" | "ready" | "missing" | "uploading"; assetId: string | null; blobId: string | null; url: string | null };
export type CanvasActiveView = {
  document: CanvasDocumentView;
  scene: CanvasLocalSceneV1;
  selectedNodeId: string | null;
  viewport: CanvasViewportV1;
  references: Record<string, CanvasReferenceView>;
  images: Record<string, CanvasRuntimeImageDtoV1>;
  jobs: Record<string, GenerationItem>;
  runs: CanvasRunView[];
  reservations: CanvasCapacityReservation[];
  hydrating: boolean;
};
export type CanvasControllerSnapshot = {
  ownerId: string;
  enabled: boolean;
  ready: boolean;
  readOnly: boolean;
  activeCanvasId: string | null;
  active: CanvasActiveView | null;
  documents: CanvasDocumentView[];
  nextCursor: string | null;
  loading: boolean;
  error: string | null;
  warning: string | null;
};
export type CanvasControllerOptions = {
  ownerId: string;
  enabled: boolean;
  readOnly: boolean;
  defaultParameters: CanvasGenerationParametersV1;
  jobs: CanvasJobsPort;
  acquireTransientLease: AcquireCanvasTransientLease;
  api?: CanvasClientApi;
  store?: CanvasDraftStore | null;
  preferences?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  initialCanvases?: CanvasMetadataDtoV1[];
  uuid?: () => string;
  now?: () => string;
  debounceMs?: number;
  digest?: CanvasReferenceRuntimeOptions["digest"];
  objectUrls?: CanvasReferenceRuntimeOptions["objectUrls"];
};

const COMMAND_MESSAGES = {
  readOnly: "\u5f53\u524d\u753b\u5e03\u4ec5\u652f\u6301\u67e5\u770b\uff0c\u6682\u65f6\u65e0\u6cd5\u7f16\u8f91\u548c\u751f\u6210",
  inactive: "\u753b\u5e03\u5c1a\u672a\u5c31\u7eea\u6216\u8d26\u6237\u5df2\u5207\u6362",
  loading: "\u6b63\u5728\u8bfb\u53d6\u6b64\u753b\u5e03\uff0c\u8bf7\u7a0d\u540e",
  confirmation: "\u6b64\u64cd\u4f5c\u4f1a\u653e\u5f03\u5f53\u524d\u672c\u5730\u753b\u5e03\uff0c\u8bf7\u5148\u786e\u8ba4",
  storage: "\u672c\u5730\u8fd0\u884c\u8bb0\u5f55\u672a\u6210\u529f\u4fdd\u5b58\uff0c\u672a\u53d1\u9001\u751f\u6210\u8bf7\u6c42\u3002\u8bf7\u4fdd\u6301\u9875\u9762\u6253\u5f00\uff0c\u6062\u590d\u6d4f\u89c8\u5668\u5b58\u50a8\u540e\u91cd\u8bd5\uff1b\u4ecd\u53ef\u624b\u52a8\u4fdd\u5b58\u5230\u8d26\u6237",
  cancelled: "\u672a\u53d1\u9001\u751f\u6210\u8bf7\u6c42\uff0c\u8bf7\u786e\u8ba4\u9a8c\u8bc1\u548c\u6e20\u9053\u8bbe\u7f6e\u540e\u91cd\u8bd5",
} as const;
export class CanvasCommandError extends Error {
  constructor(readonly code: keyof typeof COMMAND_MESSAGES) { super(COMMAND_MESSAGES[code]); this.name = "CanvasCommandError"; }
}
export function canvasControllerErrorMessage(error: unknown): string {
  return error instanceof CanvasDraftStoreError || error instanceof CanvasCommandError ? error.message : canvasClientErrorMessage(error);
}
export function isCanvasCloudConflict(error: unknown): boolean {
  return error instanceof CanvasContractError && ["CANVAS_REVISION_CONFLICT", "CANVAS_SAVE_CONFLICT", "CANVAS_DELETED"].includes(error.code);
}

export type CanvasPreparation = { origin: CanvasJobOrigin; epoch: number; count: number; phase: "preparing" | "submitting"; abort: AbortController };
export type CanvasControllerEntry = {
  envelope: CanvasDraftEnvelopeV1;
  stamp: CanvasWriteStamp | null;
  originals: Map<string, CanvasDraftBlobV1>;
  references: CanvasReferenceRuntime;
  assets: Map<string, CanvasAssetDtoV1>;
  images: Map<string, CanvasRuntimeImageDtoV1>;
  preparations: Map<string, CanvasPreparation>;
  runErrors: Map<string, string>;
  version: number;
  durableVersion: number;
  flushPromise: Promise<boolean> | null;
  timer: ReturnType<typeof setTimeout> | null;
  metadataTail: Promise<unknown>;
  savePromise: Promise<void> | null;
  loaded: boolean;
  invalidated: boolean;
  deleting: boolean;
  hydrating: boolean;
  hydrateEpoch: number;
  selectedNodeId: string | null;
  camera: CanvasViewportV1;
  localState: LocalState;
  cloudState: "saving" | "failed" | "conflict" | null;
  error: string | null;
  warning: string | null;
  deleteBlobIds: string[];
};

export function emptyCanvasControllerSnapshot(options: Pick<CanvasControllerOptions, "ownerId" | "enabled" | "readOnly">): CanvasControllerSnapshot {
  return { ownerId: options.ownerId, enabled: options.enabled, readOnly: options.readOnly, ready: false, activeCanvasId: null, active: null, documents: [], nextCursor: null, loading: false, error: null, warning: null };
}
