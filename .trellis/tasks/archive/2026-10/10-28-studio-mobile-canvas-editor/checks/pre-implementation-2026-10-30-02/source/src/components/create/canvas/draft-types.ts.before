import type {
  CanvasLocalSceneV1,
  CanvasMetadataDtoV1,
  CanvasRunOutboxEntryV1,
  CanvasSceneV1,
} from "@/lib/canvas/contracts";

export type CanvasDraftKey = readonly [ownerId: string, canvasId: string];

export type CanvasWriteStamp = Readonly<{
  writerId: string;
  writeRevision: number;
}>;

export type CanvasPendingSaveV1 = {
  saveId: string;
  expectedRevision: number;
  editRevision: number;
  deletionEpoch: number;
  scene: CanvasLocalSceneV1;
  // Once a PUT may have started, retries must use these exact asset identities.
  resolvedScene: CanvasSceneV1 | null;
};

export type CanvasDraftEnvelopeV1 = {
  storageVersion: 1;
  ownerId: string;
  canvasId: string;
  title: string;
  scene: CanvasLocalSceneV1;
  editRevision: number;
  cloud: CanvasMetadataDtoV1 | null;
  savedEditRevision: number | null;
  shell: "local" | "uncertain" | "registered";
  deletionEpoch: number;
  deletedAt: string | null;
  pendingSave: CanvasPendingSaveV1 | null;
  outbox: CanvasRunOutboxEntryV1[];
  updatedAt: string;
};

// Original bytes are structured-cloned in a separate object store, never JSON.
export type CanvasDraftBlobV1 = {
  blobId: string;
  uploadId: string;
  blob: Blob;
  fileName: string;
  lastModified: number;
  sha256: string | null;
  assetId: string | null;
};

export type CanvasDraftListEntryV1 = {
  envelope: CanvasDraftEnvelopeV1;
  stamp: CanvasWriteStamp;
};

export type CanvasDraftReadResultV1 = CanvasDraftListEntryV1 & {
  blobs: CanvasDraftBlobV1[];
};

export type CanvasDraftCommitV1 = {
  key: CanvasDraftKey;
  expected: CanvasWriteStamp | null;
  envelope: CanvasDraftEnvelopeV1;
  putBlobs?: readonly CanvasDraftBlobV1[];
  deleteBlobIds?: readonly string[];
};

export type CanvasDraftStore = {
  list: (ownerId: string) => Promise<CanvasDraftListEntryV1[]>;
  read: (key: CanvasDraftKey) => Promise<CanvasDraftReadResultV1 | null>;
  commit: (input: CanvasDraftCommitV1) => Promise<CanvasWriteStamp>;
  close: () => void;
};

export type CanvasDraftStoreErrorCode =
  | "invalid"
  | "conflict"
  | "deleted"
  | "corrupt"
  | "version"
  | "unavailable"
  | "quota"
  | "blocked"
  | "timeout"
  | "aborted"
  | "closed"
  | "limit";

const ERROR_MESSAGES: Record<CanvasDraftStoreErrorCode, string> = {
  invalid: "\u753b\u5e03\u672c\u5730\u6570\u636e\u4e0d\u6b63\u786e\uff0c\u8bf7\u4fdd\u7559\u5f53\u524d\u7f16\u8f91\u5e76\u91cd\u8bd5\u3002",
  conflict: "\u753b\u5e03\u5df2\u5728\u5176\u4ed6\u6807\u7b7e\u9875\u66f4\u6539\uff0c\u672a\u8986\u76d6\u672c\u5730\u8349\u7a3f\uff1b\u8bf7\u786e\u8ba4\u540e\u91cd\u65b0\u8f7d\u5165\u3002",
  deleted: "\u6b64\u753b\u5e03\u5df2\u5220\u9664\uff0c\u672c\u6b21\u5199\u5165\u672a\u6062\u590d\u5b83\uff1b\u8bf7\u9009\u62e9\u5176\u4ed6\u753b\u5e03\u3002",
  corrupt: "\u672c\u5730\u753b\u5e03\u6570\u636e\u635f\u574f\uff0c\u539f\u8bb0\u5f55\u5df2\u4fdd\u7559\uff1b\u8bf7\u52ff\u6e05\u9664\u6d4f\u89c8\u5668\u6570\u636e\u5e76\u5c1d\u8bd5\u91cd\u65b0\u8f7d\u5165\u8d26\u6237\u5feb\u7167\u3002",
  version: "\u672c\u5730\u753b\u5e03\u7248\u672c\u4e0d\u517c\u5bb9\uff0c\u539f\u8bb0\u5f55\u5df2\u4fdd\u7559\uff1b\u8bf7\u66f4\u65b0\u9875\u9762\u540e\u91cd\u8bd5\u3002",
  unavailable: "\u6d4f\u89c8\u5668\u672c\u5730\u5b58\u50a8\u4e0d\u53ef\u7528\uff0c\u5f53\u524d\u7f16\u8f91\u672a\u786e\u8ba4\u4fdd\u5b58\uff1b\u8bf7\u4fdd\u6301\u9875\u9762\u6253\u5f00\u5e76\u91cd\u8bd5\u3002",
  quota: "\u6d4f\u89c8\u5668\u5b58\u50a8\u7a7a\u95f4\u4e0d\u8db3\uff0c\u5f53\u524d\u7f16\u8f91\u672a\u786e\u8ba4\u4fdd\u5b58\uff1b\u8bf7\u4fdd\u6301\u9875\u9762\u6253\u5f00\u5e76\u624b\u52a8\u4fdd\u5b58\u5230\u8d26\u6237\u3002",
  blocked: "\u5176\u4ed6\u6807\u7b7e\u9875\u963b\u6b62\u4e86\u672c\u5730\u5b58\u50a8\u6253\u5f00\uff0c\u8bf7\u5173\u95ed\u65e7\u9875\u9762\u540e\u91cd\u8bd5\u3002",
  timeout: "\u672c\u5730\u4fdd\u5b58\u8d85\u65f6\uff0c\u672a\u786e\u8ba4\u6301\u4e45\u5316\uff1b\u8bf7\u4fdd\u7559\u5f53\u524d\u7f16\u8f91\u5e76\u91cd\u8bd5\u3002",
  aborted: "\u672c\u5730\u4fdd\u5b58\u5df2\u4e2d\u6b62\uff0c\u672a\u8986\u76d6\u539f\u8349\u7a3f\uff1b\u8bf7\u4fdd\u7559\u5f53\u524d\u7f16\u8f91\u5e76\u91cd\u8bd5\u3002",
  closed: "\u672c\u5730\u753b\u5e03\u5b58\u50a8\u5df2\u5173\u95ed\uff0c\u8bf7\u91cd\u65b0\u6253\u5f00\u753b\u5e03\u540e\u91cd\u8bd5\u3002",
  limit: "\u672c\u5730\u753b\u5e03\u6570\u636e\u8d85\u51fa\u5b89\u5168\u9650\u5236\uff0c\u539f\u8bb0\u5f55\u5df2\u4fdd\u7559\uff1b\u8bf7\u4fdd\u7559\u5f53\u524d\u7f16\u8f91\u5e76\u51cf\u5c11\u672c\u6b21\u6570\u636e\u3002",
};

export class CanvasDraftStoreError extends Error {
  readonly code: CanvasDraftStoreErrorCode;
  readonly key?: CanvasDraftKey;

  constructor(code: CanvasDraftStoreErrorCode, options: { key?: CanvasDraftKey; cause?: unknown } = {}) {
    super(ERROR_MESSAGES[code], { cause: options.cause });
    this.name = "CanvasDraftStoreError";
    this.code = code;
    this.key = options.key && [options.key[0], options.key[1]];
  }
}
