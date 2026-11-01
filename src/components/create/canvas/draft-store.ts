import { z } from "zod";

import { CANVAS_IMPORT_IMAGE_TYPES, CANVAS_LIMITS, canonicalCanvasJson, canvasJsonByteLength } from "@/lib/canvas/contracts";
import {
  canvasCanonicalIdSchema,
  canvasClientIdSchema,
  canvasLocalSceneSchema,
  canvasMetadataDtoSchema,
  canvasRevisionSchema,
  canvasRunOutboxSchema,
  canvasSceneSchema,
  canvasTitleSchema,
} from "@/lib/validators";

import {
  CanvasDraftStoreError,
  type CanvasDraftBlobV1,
  type CanvasDraftCommitV1,
  type CanvasDraftEnvelopeV1,
  type CanvasDraftKey,
  type CanvasDraftListEntryV1,
  type CanvasDraftReadResultV1,
  type CanvasDraftStore,
  type CanvasDraftStoreErrorCode,
  type CanvasWriteStamp,
} from "./draft-types";

export { CanvasDraftStoreError } from "./draft-types";

export const CANVAS_DRAFT_DATABASE_NAME = "narra-canvas-drafts";
const DATABASE_VERSION = 1;
const DRAFTS = "drafts";
const BLOBS = "blobs";
const OWNER_INDEX = "owner";
const CANVAS_INDEX = "canvas";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;
// Include permanent tombstones without turning a corrupt store into an unbounded scan.
const MAX_LIST_RECORDS = CANVAS_LIMITS.liveCanvasesPerOwner * CANVAS_LIMITS.maximumPageSize;
const MAX_BLOB_RECORDS = CANVAS_LIMITS.ownerAccountedImports;
const MAX_ENVELOPE_BYTES = CANVAS_LIMITS.sceneBytes * 2 + CANVAS_LIMITS.sceneNodes * CANVAS_LIMITS.runSnapshotBytes + CANVAS_LIMITS.metadataBodyBytes;

export type OpenCanvasDraftStoreOptions = {
  writerId: string;
  idbFactory?: IDBFactory;
  databaseName?: string;
  timeoutMs?: number;
};

const localRevisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const stampSchema = z.object({ writerId: canvasClientIdSchema, writeRevision: localRevisionSchema.positive() }).strict();
const keySchema = z.tuple([canvasCanonicalIdSchema, canvasClientIdSchema]);
const pendingSaveSchema = z.object({
  saveId: canvasClientIdSchema,
  expectedRevision: canvasRevisionSchema,
  editRevision: localRevisionSchema,
  deletionEpoch: localRevisionSchema,
  scene: canvasLocalSceneSchema,
  resolvedScene: canvasSceneSchema.nullable(),
}).strict();
const envelopeSchema: z.ZodType<CanvasDraftEnvelopeV1> = z.object({
  storageVersion: z.literal(1),
  ownerId: canvasCanonicalIdSchema,
  canvasId: canvasClientIdSchema,
  title: canvasTitleSchema,
  scene: canvasLocalSceneSchema,
  editRevision: localRevisionSchema,
  cloud: canvasMetadataDtoSchema.nullable(),
  savedEditRevision: localRevisionSchema.nullable(),
  shell: z.enum(["local", "uncertain", "registered"]),
  deletionEpoch: localRevisionSchema,
  deletedAt: z.iso.datetime().nullable(),
  pendingSave: pendingSaveSchema.nullable(),
  outbox: z.array(canvasRunOutboxSchema).max(CANVAS_LIMITS.sceneNodes),
  updatedAt: z.iso.datetime(),
}).strict().superRefine((value, context) => {
  const invalid = (message: string) => context.addIssue({ code: "custom", message });
  if ((value.shell === "registered") !== (value.cloud !== null)) invalid("Shell certainty and cloud acknowledgement disagree");
  if (value.cloud && (value.cloud.id !== value.canvasId || value.cloud.hasSavedSnapshot !== (value.cloud.lastSavedAt !== null))) invalid("Cloud metadata does not describe this canvas");
  if (value.savedEditRevision !== null && (value.savedEditRevision > value.editRevision || !value.cloud?.hasSavedSnapshot)) invalid("Saved edit revision has no matching acknowledgement");
  if (value.pendingSave && (value.pendingSave.editRevision > value.editRevision || value.pendingSave.deletionEpoch > value.deletionEpoch || value.deletedAt !== null)) invalid("Save capture is not a live prior revision");
  const runs = new Set<string>();
  for (const entry of value.outbox) {
    if (entry.ownerId !== value.ownerId || entry.canvasId !== value.canvasId || runs.has(entry.runId)) invalid("Outbox identity does not match this canvas");
    if (canvasJsonByteLength(entry.projection) > CANVAS_LIMITS.runSnapshotBytes) invalid("Outbox projection exceeds its bound");
    runs.add(entry.runId);
  }
});
const draftRecordSchema = z.object({
  ownerId: canvasCanonicalIdSchema,
  canvasId: canvasClientIdSchema,
  stamp: stampSchema,
  envelope: z.unknown(),
}).strict();
const blobSchema: z.ZodType<CanvasDraftBlobV1> = z.object({
  blobId: canvasClientIdSchema,
  uploadId: canvasClientIdSchema,
  blob: z.custom<Blob>((value) => typeof Blob !== "undefined" && value instanceof Blob
    && value.size > 0 && value.size <= CANVAS_LIMITS.importBytes && CANVAS_IMPORT_IMAGE_TYPES.includes(value.type)),
  fileName: z.string().max(1024),
  lastModified: localRevisionSchema,
  sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  assetId: canvasCanonicalIdSchema.nullable(),
}).strict();
const blobRecordSchema = z.object({
  storageVersion: z.literal(1),
  ownerId: canvasCanonicalIdSchema,
  canvasId: canvasClientIdSchema,
  original: blobSchema,
  blobId: canvasClientIdSchema,
}).strict();

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function assertKnownVersion(value: unknown, field: string, key?: CanvasDraftKey): void {
  const object = objectValue(value);
  if (object && Object.hasOwn(object, field) && object[field] !== 1) throw new CanvasDraftStoreError("version", { key });
}

function parseKey(value: unknown): CanvasDraftKey {
  const parsed = keySchema.safeParse(value);
  if (!parsed.success) throw new CanvasDraftStoreError("invalid");
  return parsed.data;
}

function parseStoredKey(value: unknown, ownerId: string): CanvasDraftKey {
  const parsed = keySchema.safeParse(value);
  if (!parsed.success) throw new CanvasDraftStoreError("corrupt");
  if (!Array.isArray(value) || value[0] !== ownerId || value[0] !== parsed.data[0] || value[1] !== parsed.data[1]) {
    throw new CanvasDraftStoreError("corrupt", { key: parsed.data });
  }
  return parsed.data;
}

function parseEnvelope(value: unknown, key: CanvasDraftKey, code: "invalid" | "corrupt"): CanvasDraftEnvelopeV1 {
  assertKnownVersion(value, "storageVersion", key);
  const raw = objectValue(value);
  assertKnownVersion(raw?.scene, "schemaVersion", key);
  const capture = objectValue(raw?.pendingSave);
  assertKnownVersion(capture?.scene, "schemaVersion", key);
  assertKnownVersion(capture?.resolvedScene, "schemaVersion", key);
  if (Array.isArray(raw?.outbox)) for (const entry of raw.outbox) assertKnownVersion(entry, "storageVersion", key);
  const parsed = envelopeSchema.safeParse(value);
  if (!parsed.success || parsed.data.ownerId !== key[0] || parsed.data.canvasId !== key[1]) throw new CanvasDraftStoreError(code, { key });
  if (canvasJsonByteLength(parsed.data) > MAX_ENVELOPE_BYTES) throw new CanvasDraftStoreError("limit", { key });
  return parsed.data;
}

function parseDraftRecord(value: unknown, key: CanvasDraftKey): CanvasDraftListEntryV1 {
  const parsed = draftRecordSchema.safeParse(value);
  if (!parsed.success || parsed.data.ownerId !== key[0] || parsed.data.canvasId !== key[1]) throw new CanvasDraftStoreError("corrupt", { key });
  return { envelope: parseEnvelope(parsed.data.envelope, key, "corrupt"), stamp: parsed.data.stamp };
}

function parseBlobRecord(value: unknown, key: CanvasDraftKey, blobId?: string): CanvasDraftBlobV1 {
  assertKnownVersion(value, "storageVersion", key);
  const parsed = blobRecordSchema.safeParse(value);
  if (!parsed.success || parsed.data.ownerId !== key[0] || parsed.data.canvasId !== key[1]
    || parsed.data.blobId !== parsed.data.original.blobId || (blobId !== undefined && parsed.data.blobId !== blobId)) {
    throw new CanvasDraftStoreError("corrupt", { key });
  }
  return parsed.data.original;
}

function storageError(error: unknown, key?: CanvasDraftKey): CanvasDraftStoreError {
  if (error instanceof CanvasDraftStoreError) return error;
  const name = objectValue(error)?.name ?? (error instanceof Error ? error.name : undefined);
  const code: CanvasDraftStoreErrorCode = name === "QuotaExceededError" ? "quota"
    : name === "VersionError" ? "version"
      : name === "AbortError" ? "aborted"
        : name === "DataCloneError" || name === "DataError" ? "invalid"
          : "unavailable";
  return new CanvasDraftStoreError(code, { key, cause: error });
}

function sameStamp(left: CanvasWriteStamp | null, right: CanvasWriteStamp | null): boolean {
  return left === null ? right === null : right !== null && left.writerId === right.writerId && left.writeRevision === right.writeRevision;
}

function assertProgress(previous: CanvasDraftEnvelopeV1, next: CanvasDraftEnvelopeV1, key: CanvasDraftKey): void {
  if (previous.deletedAt !== null) throw new CanvasDraftStoreError("deleted", { key });
  const deletion = next.deletedAt !== null && next.deletionEpoch > previous.deletionEpoch;
  if (next.editRevision < previous.editRevision || next.deletionEpoch < previous.deletionEpoch
    || (next.deletedAt !== null && !deletion)
    || (previous.cloud && (!next.cloud || next.cloud.revision < previous.cloud.revision))
    || (previous.savedEditRevision !== null && !(deletion && next.savedEditRevision === null)
      && (next.savedEditRevision === null || next.savedEditRevision < previous.savedEditRevision))
    || (next.editRevision === previous.editRevision && canonicalCanvasJson(next.scene) !== canonicalCanvasJson(previous.scene))) {
    throw new CanvasDraftStoreError("conflict", { key });
  }
}

function referencedBlobIds(envelope: CanvasDraftEnvelopeV1): Set<string> {
  const ids = new Set<string>();
  const scenes = [envelope.scene, ...(envelope.pendingSave ? [envelope.pendingSave.scene] : [])];
  for (const scene of scenes) for (const node of scene.nodes) {
    if (node.kind === "reference" && node.source.kind === "local") ids.add(node.source.blobId);
  }
  for (const entry of envelope.outbox) for (const source of entry.projection.references) {
    if (source.kind === "local") ids.add(source.blobId);
  }
  return ids;
}

function assertSameOriginal(previous: CanvasDraftBlobV1, next: CanvasDraftBlobV1, key: CanvasDraftKey): void {
  // Hashing belongs to reference preparation, outside the live IDB transaction.
  if (previous.blob.size !== next.blob.size || previous.blob.type !== next.blob.type
    || previous.fileName !== next.fileName || previous.lastModified !== next.lastModified
    || (previous.sha256 !== null && previous.sha256 !== next.sha256)
    || (previous.uploadId === next.uploadId && previous.assetId !== null && previous.assetId !== next.assetId)) {
    throw new CanvasDraftStoreError("conflict", { key });
  }
}

function validateDatabase(database: IDBDatabase): void {
  if (database.version !== DATABASE_VERSION || database.objectStoreNames.length !== 2
    || !database.objectStoreNames.contains(DRAFTS) || !database.objectStoreNames.contains(BLOBS)) {
    throw new CanvasDraftStoreError("version");
  }
  const transaction = database.transaction([DRAFTS, BLOBS], "readonly");
  for (const [name, keyPath, indexName, indexKey] of [
    [DRAFTS, ["ownerId", "canvasId"], OWNER_INDEX, "ownerId"],
    [BLOBS, ["ownerId", "canvasId", "blobId"], CANVAS_INDEX, ["ownerId", "canvasId"]],
  ] as const) {
    const store = transaction.objectStore(name);
    if (store.autoIncrement || JSON.stringify(store.keyPath) !== JSON.stringify(keyPath)
      || store.indexNames.length !== 1 || !store.indexNames.contains(indexName)) throw new CanvasDraftStoreError("corrupt");
    const index = store.index(indexName);
    if (index.unique || index.multiEntry || JSON.stringify(index.keyPath) !== JSON.stringify(indexKey)) throw new CanvasDraftStoreError("corrupt");
  }
}

type TransactionContext<T> = {
  transaction: IDBTransaction;
  result: (value: T) => void;
  observe: <V>(request: IDBRequest<V>, success: (value: V) => void) => void;
};

function createStore(database: IDBDatabase, writerId: string, timeoutMs: number): CanvasDraftStore {
  let closed: CanvasDraftStoreErrorCode | null = null;
  const active = new Set<(code: CanvasDraftStoreErrorCode) => void>();
  const close = (code: CanvasDraftStoreErrorCode = "closed") => {
    if (closed !== null) return;
    closed = code;
    for (const abort of [...active]) abort(code);
    database.onversionchange = null;
    database.onclose = null;
    database.close();
  };
  database.onversionchange = () => close("version");
  database.onclose = () => close("unavailable");

  function transact<T>(mode: IDBTransactionMode, key: CanvasDraftKey | undefined, start: (context: TransactionContext<T>) => void): Promise<T> {
    if (closed !== null) return Promise.reject(new CanvasDraftStoreError(closed, { key }));
    return new Promise((resolve, reject) => {
      let transaction: IDBTransaction;
      try { transaction = database.transaction([DRAFTS, BLOBS], mode); } catch (error) { reject(storageError(error, key)); return; }
      let finished = false;
      let hasResult = false;
      let result: T;
      let failure: CanvasDraftStoreError | null = null;
      const finish = (error?: CanvasDraftStoreError) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        active.delete(cancel);
        transaction.oncomplete = null;
        transaction.onabort = null;
        transaction.onerror = null;
        if (error) reject(error);
        else if (hasResult) resolve(result);
        else reject(new CanvasDraftStoreError("unavailable", { key }));
      };
      const abort = (error: CanvasDraftStoreError) => {
        if (finished) return;
        failure ??= error;
        try { transaction.abort(); } catch { finish(failure); }
      };
      const cancel = (code: CanvasDraftStoreErrorCode) => {
        const error = new CanvasDraftStoreError(code, { key });
        abort(error);
        finish(error);
      };
      const timer = setTimeout(() => cancel("timeout"), timeoutMs);
      active.add(cancel);
      const guard = (callback: () => void) => {
        if (finished || failure) return;
        try { callback(); } catch (error) { abort(storageError(error, key)); }
      };
      transaction.oncomplete = () => finish(failure ?? undefined);
      transaction.onabort = () => finish(failure ?? storageError(transaction.error ?? new DOMException("", "AbortError"), key));
      transaction.onerror = (event) => {
        const request = event.target as IDBRequest | null;
        failure ??= storageError(transaction.error ?? request?.error, key);
      };
      guard(() => start({
        transaction,
        result: (value) => { result = value; hasResult = true; },
        observe: (request, success) => { request.onsuccess = () => guard(() => success(request.result)); },
      }));
    });
  }

  return {
    async list(ownerId) {
      const owner = canvasCanonicalIdSchema.safeParse(ownerId);
      if (!owner.success) throw new CanvasDraftStoreError("invalid");
      return transact<CanvasDraftListEntryV1[]>("readonly", undefined, ({ transaction, observe, result }) => {
        const entries: CanvasDraftListEntryV1[] = [];
        const request = transaction.objectStore(DRAFTS).index(OWNER_INDEX).openCursor(owner.data);
        observe(request, (cursor) => {
          if (!cursor) { result(entries); return; }
          const key = parseStoredKey(cursor.primaryKey, owner.data);
          if (entries.length >= MAX_LIST_RECORDS) throw new CanvasDraftStoreError("limit", { key });
          entries.push(parseDraftRecord(cursor.value, key));
          cursor.continue();
        });
      });
    },
    async read(inputKey) {
      const key = parseKey(inputKey);
      return transact<CanvasDraftReadResultV1 | null>("readonly", key, ({ transaction, observe, result }) => {
        observe(transaction.objectStore(DRAFTS).get([...key]), (value: unknown) => {
          if (value === undefined) { result(null); return; }
          const entry = parseDraftRecord(value, key);
          const blobs: CanvasDraftBlobV1[] = [];
          observe(transaction.objectStore(BLOBS).index(CANVAS_INDEX).openCursor([...key]), (cursor) => {
            if (!cursor) { result({ ...entry, blobs }); return; }
            if (blobs.length >= MAX_BLOB_RECORDS) throw new CanvasDraftStoreError("limit", { key });
            const primaryKey = cursor.primaryKey;
            const blobId = canvasClientIdSchema.safeParse(Array.isArray(primaryKey) ? primaryKey[2] : undefined);
            if (!Array.isArray(primaryKey) || primaryKey.length !== 3 || primaryKey[0] !== key[0] || primaryKey[1] !== key[1]
              || !blobId.success || primaryKey[2] !== blobId.data) throw new CanvasDraftStoreError("corrupt", { key });
            blobs.push(parseBlobRecord(cursor.value, key, blobId.data));
            cursor.continue();
          });
        });
      });
    },
    async commit(input: CanvasDraftCommitV1) {
      const key = parseKey(input.key);
      const envelope = parseEnvelope(input.envelope, key, "invalid");
      const expectedResult = stampSchema.nullable().safeParse(input.expected);
      if (!expectedResult.success) throw new CanvasDraftStoreError("invalid", { key });
      const putResult = z.array(blobSchema).max(MAX_BLOB_RECORDS).safeParse(input.putBlobs ?? []);
      const deleteResult = z.array(canvasClientIdSchema).max(MAX_BLOB_RECORDS).safeParse(input.deleteBlobIds ?? []);
      if (!putResult.success || !deleteResult.success) throw new CanvasDraftStoreError("invalid", { key });
      const puts = putResult.data;
      const deletes = deleteResult.data;
      const putIds = new Set(puts.map((blob) => blob.blobId));
      const referenced = referencedBlobIds(envelope);
      if (putIds.size !== puts.length || new Set(deletes).size !== deletes.length
        || deletes.some((id) => putIds.has(id) || (envelope.deletedAt === null && referenced.has(id)))) throw new CanvasDraftStoreError("invalid", { key });
      return transact<CanvasWriteStamp>("readwrite", key, ({ transaction, observe, result }) => {
        const drafts = transaction.objectStore(DRAFTS);
        const blobs = transaction.objectStore(BLOBS);
        observe(drafts.get([...key]), (value: unknown) => {
          const previous = value === undefined ? null : parseDraftRecord(value, key);
          if (!sameStamp(previous?.stamp ?? null, expectedResult.data)) throw new CanvasDraftStoreError("conflict", { key });
          if (previous) assertProgress(previous.envelope, envelope, key);
          const revision = (previous?.stamp.writeRevision ?? 0) + 1;
          if (!Number.isSafeInteger(revision)) throw new CanvasDraftStoreError("limit", { key });
          const stamp: CanvasWriteStamp = { writerId, writeRevision: revision };
          if (!previous) observe(drafts.index(OWNER_INDEX).count(key[0]), (count) => {
            if (count >= MAX_LIST_RECORDS) throw new CanvasDraftStoreError("limit", { key });
          });
          let existingBlobCount = 0;
          let blobDelta = 0;
          let remaining = puts.length + deletes.length + 1;
          const checkBlobCount = () => {
            remaining -= 1;
            if (remaining === 0 && existingBlobCount + blobDelta > MAX_BLOB_RECORDS) throw new CanvasDraftStoreError("limit", { key });
          };
          observe(blobs.index(CANVAS_INDEX).count([...key]), (count) => { existingBlobCount = count; checkBlobCount(); });
          drafts.put({ ownerId: key[0], canvasId: key[1], stamp, envelope });
          for (const original of puts) {
            observe(blobs.get([...key, original.blobId]), (stored: unknown) => {
              if (stored !== undefined) assertSameOriginal(parseBlobRecord(stored, key, original.blobId), original, key);
              else blobDelta += 1;
              checkBlobCount();
              blobs.put({ storageVersion: 1, ownerId: key[0], canvasId: key[1], blobId: original.blobId, original });
            });
          }
          for (const id of deletes) {
            observe(blobs.get([...key, id]), (stored: unknown) => {
              if (stored !== undefined) { parseBlobRecord(stored, key, id); blobDelta -= 1; }
              checkBlobCount();
              blobs.delete([...key, id]);
            });
          }
          // Request success is not durability: only transact's oncomplete resolves this.
          result(stamp);
        });
      });
    },
    close: () => close(),
  };
}

// Call after mount. Importing this module never opens or probes browser storage.
export async function openCanvasDraftStore(options: OpenCanvasDraftStoreOptions): Promise<CanvasDraftStore> {
  const writer = canvasClientIdSchema.safeParse(options.writerId);
  const name = options.databaseName ?? CANVAS_DRAFT_DATABASE_NAME;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!writer.success || typeof name !== "string" || name.length === 0 || name.length > 128
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) throw new CanvasDraftStoreError("invalid");
  let factory: IDBFactory | undefined;
  try { factory = options.idbFactory ?? globalThis.indexedDB; } catch (error) { throw storageError(error); }
  if (!factory) throw new CanvasDraftStoreError("unavailable");
  return new Promise((resolve, reject) => {
    let settled = false;
    let request: IDBOpenDBRequest;
    let upgrade: IDBTransaction | null = null;
    const fail = (error: CanvasDraftStoreError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { upgrade?.abort(); } catch { /* The upgrade may already have aborted. */ }
      reject(error);
    };
    const timer = setTimeout(() => fail(new CanvasDraftStoreError("timeout")), timeoutMs);
    try { request = factory.open(name, DATABASE_VERSION); } catch (error) { fail(storageError(error)); return; }
    request.onblocked = () => fail(new CanvasDraftStoreError("blocked"));
    request.onerror = () => fail(storageError(request.error));
    request.onupgradeneeded = (event) => {
      upgrade = request.transaction;
      if (settled) { try { upgrade?.abort(); } catch { /* Ignore a completed late upgrade. */ } return; }
      try {
        if (event.oldVersion !== 0) throw new CanvasDraftStoreError("version");
        const database = request.result;
        database.createObjectStore(DRAFTS, { keyPath: ["ownerId", "canvasId"] }).createIndex(OWNER_INDEX, "ownerId");
        database.createObjectStore(BLOBS, { keyPath: ["ownerId", "canvasId", "blobId"] }).createIndex(CANVAS_INDEX, ["ownerId", "canvasId"]);
      } catch (error) { fail(storageError(error)); }
    };
    request.onsuccess = () => {
      const database = request.result;
      if (settled) { database.close(); return; }
      try {
        validateDatabase(database);
        const store = createStore(database, writer.data, timeoutMs);
        settled = true;
        clearTimeout(timer);
        resolve(store);
      } catch (error) { database.close(); fail(storageError(error)); }
    };
  });
}
