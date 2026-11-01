// @vitest-environment node

import { CANVAS_LIMITS, type CanvasLocalSceneV1, type CanvasRunOutboxEntryV1 } from "@/lib/canvas/contracts";
import { CANVAS_DRAFT_DATABASE_NAME, openCanvasDraftStore } from "@/components/create/canvas/draft-store";
import {
  CanvasDraftStoreError,
  type CanvasDraftBlobV1,
  type CanvasDraftEnvelopeV1,
  type CanvasDraftKey,
  type CanvasDraftStore,
} from "@/components/create/canvas/draft-types";

type Handler = ((event: Event) => void) | null;
type StoredValue = { key: IDBValidKey; value: unknown };
type StoreDefinition = {
  keyPath: string[];
  indexes: Map<string, { keyPath: string | string[]; unique: boolean; multiEntry: boolean }>;
  records: Map<string, StoredValue>;
};

const keyText = (key: IDBValidKey) => JSON.stringify(key);
const names = (values: Iterable<string>) => {
  const items = [...values];
  return { length: items.length, contains: (name: string) => items.includes(name) };
};
const eventFor = (type: string, target: unknown) => {
  const event = new Event(type);
  Object.defineProperty(event, "target", { value: target });
  return event;
};
const indexedValue = (value: unknown, path: string | string[]): IDBValidKey => {
  const record = value as Record<string, IDBValidKey>;
  return Array.isArray(path) ? path.map((field) => record[field]) : record[path];
};

class Request<T> {
  result!: T;
  error: DOMException | null = null;
  onsuccess: Handler = null;
  onerror: Handler = null;
}

// Deliberately a transaction/CAS harness, not a native-browser IDB substitute.
// Writes are staged, all requests succeed before completion, and aborted writes roll back.
class Transaction {
  error: DOMException | null = null;
  oncomplete: Handler = null;
  onerror: Handler = null;
  onabort: Handler = null;
  state: "queued" | "active" | "completed" | "aborted" = "queued";
  snapshots = new Map<string, Map<string, StoredValue>>();
  private operations: Array<() => void> = [];

  constructor(readonly database: Database, readonly mode: IDBTransactionMode) {}

  objectStore(name: string) {
    return new ObjectStore(this.database, name, this);
  }

  start() {
    if (this.state !== "queued") return;
    this.state = "active";
    for (const [name, definition] of this.database.factory.stores) this.snapshots.set(name, structuredClone(definition.records));
    this.pump();
  }

  enqueue(operation: () => void) {
    if (this.state === "completed" || this.state === "aborted") throw new DOMException("", "TransactionInactiveError");
    this.operations.push(operation);
  }

  private pump = () => {
    if (this.state !== "active") return;
    const operation = this.operations.shift();
    if (operation) {
      operation();
      queueMicrotask(this.pump);
    } else if (this.mode === "readwrite" && this.database.factory.holdCompletion) {
      this.database.factory.hold(this);
    } else this.complete();
  };

  complete(error?: DOMException) {
    if (this.state !== "active") return;
    if (error) { this.error = error; this.abort(); return; }
    if (this.mode === "readwrite") for (const [name, records] of this.snapshots) this.database.factory.stores.get(name)!.records = records;
    this.state = "completed";
    this.oncomplete?.(eventFor("complete", this));
    this.database.factory.finish(this);
  }

  abort() {
    if (this.state === "completed" || this.state === "aborted") throw new DOMException("", "InvalidStateError");
    this.state = "aborted";
    queueMicrotask(() => {
      this.onabort?.(eventFor("abort", this));
      this.database.factory.finish(this);
    });
  }

  fail(request: Request<unknown>, error: DOMException) {
    request.error = error;
    request.onerror?.(eventFor("error", request));
    this.onerror?.(eventFor("error", request));
    this.error = error;
    this.abort();
  }
}

class ObjectStore {
  constructor(readonly database: Database, readonly name: string, readonly transaction?: Transaction) {}
  private get definition() { return this.database.factory.stores.get(this.name)!; }
  get keyPath() { return this.definition.keyPath; }
  get autoIncrement() { return false; }
  get indexNames() { return names(this.definition.indexes.keys()); }
  createIndex(name: string, keyPath: string | string[]) {
    this.definition.indexes.set(name, { keyPath, unique: false, multiEntry: false });
    return this.index(name);
  }
  index(name: string) {
    const definition = this.definition.indexes.get(name)!;
    return {
      ...definition,
      openCursor: (query: IDBValidKey) => this.openCursor(query, definition.keyPath),
      count: (query: IDBValidKey) => {
        const request = new Request<number>();
        this.transaction!.enqueue(() => {
          request.result = [...this.transaction!.snapshots.get(this.name)!.values()]
            .filter((entry) => keyText(indexedValue(entry.value, definition.keyPath)) === keyText(query)).length;
          request.onsuccess?.(eventFor("success", request));
        });
        return request;
      },
    };
  }
  get(key: IDBValidKey) {
    const request = new Request<unknown>();
    this.transaction!.enqueue(() => {
      request.result = structuredClone(this.transaction!.snapshots.get(this.name)!.get(keyText(key))?.value);
      request.onsuccess?.(eventFor("success", request));
    });
    return request;
  }
  put(value: unknown) {
    const captured = structuredClone(value);
    const key = indexedValue(captured, this.keyPath);
    const request = new Request<IDBValidKey>();
    this.transaction!.enqueue(() => {
      if (this.database.factory.failPutStore === this.name) {
        this.database.factory.failPutStore = null;
        this.transaction!.fail(request, new DOMException("private storage failure", "QuotaExceededError"));
        return;
      }
      this.transaction!.snapshots.get(this.name)!.set(keyText(key), { key, value: captured });
      this.database.factory.successfulPuts.push(this.name);
      request.result = key;
      request.onsuccess?.(eventFor("success", request));
    });
    return request;
  }
  delete(key: IDBValidKey) {
    const request = new Request<undefined>();
    this.transaction!.enqueue(() => {
      this.transaction!.snapshots.get(this.name)!.delete(keyText(key));
      request.result = undefined;
      request.onsuccess?.(eventFor("success", request));
    });
    return request;
  }
  private openCursor(query: IDBValidKey, path: string | string[]) {
    type Cursor = { primaryKey: IDBValidKey; value: unknown; continue: () => void };
    const request = new Request<Cursor | null>();
    let values: StoredValue[] | null = null;
    let offset = 0;
    const next = () => this.transaction!.enqueue(() => {
      values ??= [...this.transaction!.snapshots.get(this.name)!.values()]
        .filter((entry) => keyText(indexedValue(entry.value, path)) === keyText(query))
        .sort((a, b) => keyText(a.key).localeCompare(keyText(b.key)));
      const current = values[offset++];
      request.result = current ? { primaryKey: structuredClone(current.key), value: structuredClone(current.value), continue: next } : null;
      request.onsuccess?.(eventFor("success", request));
    });
    next();
    return request;
  }
}

class Database {
  onversionchange: Handler = null;
  onclose: Handler = null;
  closed = false;
  constructor(readonly factory: MemoryIdb, readonly name: string) {}
  get version() { return this.factory.version; }
  get objectStoreNames() { return names(this.factory.stores.keys()); }
  createObjectStore(name: string, options: { keyPath: string[] }) {
    this.factory.stores.set(name, { keyPath: options.keyPath, indexes: new Map(), records: new Map() });
    return new ObjectStore(this, name);
  }
  transaction(_names: string[], mode: IDBTransactionMode) {
    if (this.closed) throw new DOMException("", "InvalidStateError");
    const transaction = new Transaction(this, mode);
    this.factory.enqueue(transaction);
    return transaction;
  }
  close() { this.closed = true; }
}

class MemoryIdb {
  version = 0;
  stores = new Map<string, StoreDefinition>();
  connections: Database[] = [];
  successfulPuts: string[] = [];
  holdCompletion = false;
  failPutStore: string | null = null;
  blockNextOpen = false;
  hangNextOpen = false;
  delayedOpen: (() => void) | null = null;
  private held: Transaction | null = null;
  private heldListener: (() => void) | null = null;
  private queue: Transaction[] = [];
  private active: Transaction | null = null;

  get factory() { return this as unknown as IDBFactory; }

  open(name: string, version: number) {
    const request = Object.assign(new Request<Database>(), {
      onblocked: null as Handler,
      onupgradeneeded: null as Handler,
      transaction: null as { abort: () => void } | null,
    });
    const complete = () => {
      if (version < this.version) {
        request.error = new DOMException("future database", "VersionError");
        request.onerror?.(eventFor("error", request));
        return;
      }
      const database = new Database(this, name);
      this.connections.push(database);
      request.result = database;
      if (this.version === 0) {
        let aborted = false;
        request.transaction = { abort: () => { aborted = true; } };
        const event = eventFor("upgradeneeded", request);
        Object.defineProperty(event, "oldVersion", { value: 0 });
        request.onupgradeneeded?.(event);
        if (aborted) {
          this.stores.clear();
          request.error = new DOMException("", "AbortError");
          request.onerror?.(eventFor("error", request));
          database.close();
          return;
        }
        this.version = version;
      }
      request.onsuccess?.(eventFor("success", request));
    };
    queueMicrotask(() => {
      if (this.blockNextOpen || this.hangNextOpen) {
        this.delayedOpen = complete;
        if (this.blockNextOpen) request.onblocked?.(eventFor("blocked", request));
        this.blockNextOpen = false;
        this.hangNextOpen = false;
      } else complete();
    });
    return request;
  }

  enqueue(transaction: Transaction) {
    this.queue.push(transaction);
    queueMicrotask(() => this.advance());
  }
  private advance() {
    if (this.active) return;
    const next = this.queue.shift();
    if (!next) return;
    if (next.state === "aborted") { this.advance(); return; }
    this.active = next;
    next.start();
  }
  finish(transaction: Transaction) {
    if (this.active === transaction) this.active = null;
    if (this.held === transaction) this.held = null;
    queueMicrotask(() => this.advance());
  }
  hold(transaction: Transaction) {
    this.held = transaction;
    this.heldListener?.();
    this.heldListener = null;
  }
  waitForHeld() {
    return this.held ? Promise.resolve() : new Promise<void>((resolve) => { this.heldListener = resolve; });
  }
  release(error?: DOMException) {
    this.holdCompletion = false;
    this.held!.complete(error);
  }
  seed(name: string, key: IDBValidKey, value: unknown) {
    this.stores.get(name)!.records.set(keyText(key), { key, value: structuredClone(value) });
  }
  peek(name: string, key: IDBValidKey) { return structuredClone(this.stores.get(name)!.records.get(keyText(key))?.value); }
  versionchange() { for (const database of this.connections) if (!database.closed) database.onversionchange?.(eventFor("versionchange", database)); }
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const OWNER = "draft-owner";
const KEY: CanvasDraftKey = [OWNER, uuid(1)];
const NOW = "2026-10-29T06:00:00.000Z";
const scene = (): CanvasLocalSceneV1 => ({
  schemaVersion: 1,
  nodes: [{ id: uuid(10), kind: "prompt", text: "", position: { x: -250, y: 75 } }],
  edges: [],
  viewport: { x: -120, y: 45, zoom: 0.5 },
  runBindings: [],
});
const envelope = (overrides: Partial<CanvasDraftEnvelopeV1> = {}): CanvasDraftEnvelopeV1 => ({
  storageVersion: 1,
  ownerId: OWNER,
  canvasId: uuid(1),
  title: "Local draft",
  scene: scene(),
  editRevision: 0,
  cloud: null,
  savedEditRevision: null,
  shell: "local",
  deletionEpoch: 0,
  deletedAt: null,
  pendingSave: null,
  outbox: [],
  updatedAt: NOW,
  ...overrides,
});
const original = (n = 20): CanvasDraftBlobV1 => ({
  blobId: uuid(n), uploadId: uuid(n + 1), blob: new Blob(["original fixture"], { type: "image/png" }),
  fileName: "original.png", lastModified: 100, sha256: null, assetId: null,
});
const withReference = (value = envelope(), blob = original()): CanvasDraftEnvelopeV1 => ({
  ...value,
  scene: { ...value.scene, nodes: [...value.scene.nodes, { id: uuid(11), kind: "reference", position: { x: 0, y: 0 }, source: { kind: "local", blobId: blob.blobId, uploadId: blob.uploadId } }] },
});
const edited = (value: CanvasDraftEnvelopeV1, text: string): CanvasDraftEnvelopeV1 => ({
  ...value, editRevision: value.editRevision + 1,
  scene: { ...value.scene, nodes: value.scene.nodes.map((node) => node.kind === "prompt" ? { ...node, text } : node) },
});
const outbox = (): CanvasRunOutboxEntryV1 => ({
  storageVersion: 1, ownerId: OWNER, canvasId: uuid(1), nodeId: uuid(12), runId: uuid(30), phase: "uncertain", jobId: null,
  projection: {
    canvasId: uuid(1), nodeId: uuid(12), runId: uuid(30), prompt: { sourceNodeId: uuid(10), text: "frozen prompt" }, references: [],
    params: { providerMode: "built_in", channelId: null, model: "gpt-image-1", size: "auto", quality: "auto", outputFormat: "png", outputCompression: null, moderation: "auto", count: 4, negativePrompt: null, seed: null },
  },
});
const stores: CanvasDraftStore[] = [];
async function open(memory = new MemoryIdb(), writer = 100, timeoutMs = 1000) {
  const store = await openCanvasDraftStore({ writerId: uuid(writer), idbFactory: memory.factory, timeoutMs });
  stores.push(store);
  return store;
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  vi.useRealTimers();
});

describe("canvas IndexedDB draft store", () => {
  it("opens explicit composite-key stores and round-trips a separate Blob without durable URLs", async () => {
    const memory = new MemoryIdb();
    const store = await open(memory);
    expect(memory.connections[0].name).toBe(CANVAS_DRAFT_DATABASE_NAME);
    expect(memory.stores.get("drafts")?.keyPath).toEqual(["ownerId", "canvasId"]);
    expect(memory.stores.get("blobs")?.keyPath).toEqual(["ownerId", "canvasId", "blobId"]);
    const draft = withReference();
    const blob = original();
    const stamp = await store.commit({ key: KEY, expected: null, envelope: draft, putBlobs: [blob] });
    expect(stamp).toEqual({ writerId: uuid(100), writeRevision: 1 });
    const restored = await store.read(KEY);
    expect(restored?.envelope).toEqual(draft);
    expect(restored?.stamp).toEqual(stamp);
    expect(restored?.blobs).toHaveLength(1);
    expect(restored?.blobs[0].blob).toBeInstanceOf(Blob);
    expect(await restored?.blobs[0].blob.text()).toBe("original fixture");
    expect(restored?.blobs[0]).toMatchObject({ blobId: blob.blobId, uploadId: blob.uploadId, fileName: "original.png", lastModified: 100, assetId: null });
    const json = JSON.stringify(memory.peek("drafts", [...KEY]));
    expect(json).not.toContain("original fixture");
    expect(json).not.toMatch(/blob:|data:|https?:|apiKey|turnstileToken|status|__rf/);
    expect(await store.list(OWNER)).toEqual([{ envelope: draft, stamp }]);
  });

  it("scopes reads, lists and identical blob IDs by both account and canvas", async () => {
    const memory = new MemoryIdb();
    const store = await open(memory);
    for (const [ownerId, canvasId, title] of [[OWNER, uuid(1), "one"], ["second-owner", uuid(1), "two"], [OWNER, uuid(2), "three"]]) {
      await store.commit({ key: [ownerId, canvasId], expected: null, envelope: envelope({ ownerId, canvasId, title }), putBlobs: [{ ...original(), blob: new Blob([title], { type: "image/png" }) }] });
    }
    expect(await store.read(["third-owner", uuid(1)])).toBeNull();
    expect((await store.list(OWNER)).map((item) => item.envelope.title)).toEqual(["one", "three"]);
    expect((await store.list("second-owner")).map((item) => item.envelope.title)).toEqual(["two"]);
    expect(await (await store.read(["second-owner", uuid(1)]))?.blobs[0].blob.text()).toBe("two");
    expect(await (await store.read(KEY))?.blobs[0].blob.text()).toBe("one");
    await expect(store.commit({ key: KEY, expected: null, envelope: envelope({ ownerId: "second-owner" }) })).rejects.toMatchObject({ code: "invalid", key: KEY });
  });

  it("reports durability only at transaction completion, not after successful put requests", async () => {
    const memory = new MemoryIdb();
    const store = await open(memory);
    memory.holdCompletion = true;
    let settled = false;
    const pending = store.commit({ key: KEY, expected: null, envelope: withReference(), putBlobs: [original()] }).then((stamp) => { settled = true; return stamp; });
    await memory.waitForHeld();
    expect(memory.successfulPuts).toEqual(["drafts", "blobs"]);
    expect(settled).toBe(false);
    expect(memory.peek("drafts", [...KEY])).toBeUndefined();
    memory.release();
    await expect(pending).resolves.toMatchObject({ writeRevision: 1 });
    expect(settled).toBe(true);
  });

  it("captures JSON and blob metadata before a caller mutates its in-memory envelope", async () => {
    const memory = new MemoryIdb();
    const store = await open(memory);
    const draft = withReference();
    const blob = original();
    const pending = store.commit({ key: KEY, expected: null, envelope: draft, putBlobs: [blob] });
    draft.title = "mutated while writing";
    draft.scene.viewport.x = 999;
    blob.uploadId = uuid(999);
    await pending;
    expect((await store.read(KEY))?.envelope).toEqual(withReference());
    expect((await store.read(KEY))?.blobs[0].uploadId).toBe(uuid(21));
    const read = (await store.read(KEY))!;
    read.envelope.scene.viewport.x = 500;
    expect((await store.read(KEY))?.envelope.scene.viewport.x).toBe(-120);
  });

  it.each([["AbortError", "aborted"], ["QuotaExceededError", "quota"]])("rolls back scene and blob changes when %s follows request success", async (name, code) => {
    const memory = new MemoryIdb();
    const store = await open(memory);
    const draft = withReference();
    const stamp = await store.commit({ key: KEY, expected: null, envelope: draft, putBlobs: [original()] });
    memory.holdCompletion = true;
    const pending = store.commit({ key: KEY, expected: stamp, envelope: edited(draft, "not durable"), putBlobs: [{ ...original(), sha256: "a".repeat(64), assetId: "asset-ready" }] });
    const assertion = expect(pending).rejects.toMatchObject({ code, key: KEY });
    await memory.waitForHeld();
    memory.release(new DOMException("internal path must not be shown", name));
    await assertion;
    const restored = await store.read(KEY);
    expect(restored?.envelope).toEqual(draft);
    expect(restored?.stamp).toEqual(stamp);
    expect(restored?.blobs[0].assetId).toBeNull();
  });

  it("aborts a successful draft request when a later blob request fails", async () => {
    const memory = new MemoryIdb();
    const store = await open(memory);
    memory.failPutStore = "blobs";
    await expect(store.commit({ key: KEY, expected: null, envelope: withReference(), putBlobs: [original()] })).rejects.toMatchObject({ code: "quota" });
    expect(memory.successfulPuts).toEqual(["drafts"]);
    expect(await store.read(KEY)).toBeNull();
    expect(memory.stores.get("blobs")?.records.size).toBe(0);
  });

  it("serializes two writers with CAS and rejects stale same-writer scenes", async () => {
    const memory = new MemoryIdb();
    const first = await open(memory, 100);
    const second = await open(memory, 101);
    const base = envelope();
    const initial = await first.commit({ key: KEY, expected: null, envelope: base });
    const results = await Promise.allSettled([
      first.commit({ key: KEY, expected: initial, envelope: edited(base, "first writer") }),
      second.commit({ key: KEY, expected: initial, envelope: edited(base, "stale second writer") }),
    ]);
    expect(results[0].status).toBe("fulfilled");
    expect(results[1]).toMatchObject({ status: "rejected", reason: { code: "conflict" } });
    const latest = (await second.read(KEY))!;
    await expect(first.commit({ key: KEY, expected: latest.stamp, envelope: base })).rejects.toMatchObject({ code: "conflict" });
    await expect(first.commit({ key: KEY, expected: { ...latest.stamp, writerId: uuid(101) }, envelope: latest.envelope })).rejects.toMatchObject({ code: "conflict" });
    await expect(first.commit({ key: KEY, expected: latest.stamp, envelope: { ...edited(base, "same revision, different scene"), editRevision: latest.envelope.editRevision } })).rejects.toMatchObject({ code: "conflict" });
    const next = await second.commit({ key: KEY, expected: latest.stamp, envelope: edited(latest.envelope, "explicitly loaded latest") });
    expect(next).toEqual({ writerId: uuid(101), writeRevision: 3 });
  });

  it("preserves a tombstone across reopening and prevents delayed writes from recreating the UUID", async () => {
    const memory = new MemoryIdb();
    const first = await open(memory);
    const draft = withReference();
    const originalStamp = await first.commit({ key: KEY, expected: null, envelope: draft, putBlobs: [original()] });
    const tombstone = { ...draft, deletionEpoch: 1, deletedAt: NOW };
    const deletedStamp = await first.commit({ key: KEY, expected: originalStamp, envelope: tombstone, deleteBlobIds: [original().blobId] });
    first.close();
    const reopened = await open(memory, 101);
    expect((await reopened.read(KEY))?.envelope.deletedAt).toBe(NOW);
    expect((await reopened.read(KEY))?.blobs).toEqual([]);
    expect((await reopened.list(OWNER))[0].envelope.deletedAt).toBe(NOW);
    await expect(reopened.commit({ key: KEY, expected: originalStamp, envelope: edited(draft, "late save") })).rejects.toMatchObject({ code: "conflict" });
    await expect(reopened.commit({ key: KEY, expected: deletedStamp, envelope: edited(draft, "recreate") })).rejects.toMatchObject({ code: "deleted" });
    await expect(reopened.commit({ key: KEY, expected: null, envelope: envelope() })).rejects.toMatchObject({ code: "conflict" });
    expect((await reopened.read(KEY))?.stamp).toEqual(deletedStamp);
  });

  it("keeps cloud metadata revisions distinct from the captured saved edit revision", async () => {
    const store = await open();
    const cloud = { id: uuid(1), title: "cloud", revision: 2, lastSavedAt: NOW, hasSavedSnapshot: true, createdAt: NOW, updatedAt: NOW };
    const draft = envelope({ shell: "registered", cloud, editRevision: 5, savedEditRevision: 0 });
    const initial = await store.commit({ key: KEY, expected: null, envelope: draft });
    const renamed = { ...draft, title: "renamed", cloud: { ...cloud, title: "renamed", revision: 3 } };
    const renameStamp = await store.commit({ key: KEY, expected: initial, envelope: renamed });
    expect((await store.read(KEY))?.envelope.savedEditRevision).toBe(0);
    const changed = edited(renamed, "edit while saving");
    const ack = { ...changed, cloud: { ...renamed.cloud, revision: 4 }, savedEditRevision: 5 };
    const ackStamp = await store.commit({ key: KEY, expected: renameStamp, envelope: ack });
    expect((await store.read(KEY))?.envelope).toMatchObject({ editRevision: 6, savedEditRevision: 5, cloud: { revision: 4 } });
    await expect(store.commit({ key: KEY, expected: ackStamp, envelope: { ...ack, cloud } })).rejects.toMatchObject({ code: "conflict" });
    await expect(store.commit({ key: KEY, expected: ackStamp, envelope: { ...ack, savedEditRevision: 4 } })).rejects.toMatchObject({ code: "conflict" });
  });

  it("tombstones a previously saved canvas after a separately persisted pending-delete epoch", async () => {
    const memory = new MemoryIdb();
    const store = await open(memory);
    const cloud = { id: uuid(1), title: "saved", revision: 4, lastSavedAt: NOW, hasSavedSnapshot: true, createdAt: NOW, updatedAt: NOW };
    const saved = withReference(envelope({ shell: "registered", cloud, editRevision: 5, savedEditRevision: 5 }));
    const first = await store.commit({ key: KEY, expected: null, envelope: saved, putBlobs: [original()] });
    const pendingDelete = { ...saved, deletionEpoch: 1 };
    const pendingStamp = await store.commit({ key: KEY, expected: first, envelope: pendingDelete });
    const tombstone: CanvasDraftEnvelopeV1 = {
      ...pendingDelete, deletionEpoch: 2, editRevision: 6, deletedAt: NOW,
      cloud: { ...cloud, revision: 5, lastSavedAt: null, hasSavedSnapshot: false },
      savedEditRevision: null, pendingSave: null, outbox: [], scene: { ...scene(), nodes: [] },
    };
    await expect(store.commit({ key: KEY, expected: pendingStamp, envelope: { ...tombstone, deletionEpoch: 1 } })).rejects.toMatchObject({ code: "conflict" });
    const stamp = await store.commit({ key: KEY, expected: pendingStamp, envelope: tombstone, deleteBlobIds: [original().blobId] });
    expect(await store.read(KEY)).toEqual({ envelope: tombstone, stamp, blobs: [] });
    store.close();
    const reopened = await open(memory, 101);
    expect((await reopened.read(KEY))?.envelope).toMatchObject({ deletedAt: NOW, savedEditRevision: null, cloud: { revision: 5, hasSavedSnapshot: false } });
    await expect(reopened.commit({ key: KEY, expected: stamp, envelope: { ...saved, editRevision: 7, deletionEpoch: 3 } })).rejects.toMatchObject({ code: "deleted" });
  });

  it("round-trips nonsecret outbox and frozen save inputs without inventing accepted bindings", async () => {
    const store = await open();
    const draft = withReference(envelope({ shell: "uncertain", outbox: [outbox()] }));
    draft.pendingSave = { saveId: uuid(40), expectedRevision: 0, editRevision: 0, deletionEpoch: 0, scene: structuredClone(draft.scene), resolvedScene: null };
    const initial = await store.commit({ key: KEY, expected: null, envelope: draft, putBlobs: [original()] });
    const restored = (await store.read(KEY))!;
    expect(restored.envelope.outbox).toEqual([outbox()]);
    expect(restored.envelope.scene.runBindings).toEqual([]);
    expect(restored.envelope.pendingSave?.scene.nodes[1]).toMatchObject({ source: { blobId: uuid(20), uploadId: uuid(21) } });
    const resolved = { ...draft.scene, nodes: draft.scene.nodes.map((node) => node.kind === "reference" ? { ...node, source: { kind: "imported" as const, assetId: "original-asset" } } : node) };
    const captured = { ...draft, pendingSave: { ...draft.pendingSave, resolvedScene: resolved } };
    await store.commit({ key: KEY, expected: initial, envelope: captured });
    expect((await store.read(KEY))?.envelope.pendingSave?.resolvedScene).toEqual(resolved);
  });

  it("commits accepted outbox and run binding together, preserving both on abort", async () => {
    const memory = new MemoryIdb();
    const store = await open(memory);
    const draft = envelope({ outbox: [outbox()] });
    draft.scene.nodes.push({ id: uuid(12), kind: "generation", position: { x: 0, y: 0 }, parameters: outbox().projection.params });
    const initial = await store.commit({ key: KEY, expected: null, envelope: draft });
    const accepted: CanvasDraftEnvelopeV1 = {
      ...draft, editRevision: 1,
      scene: { ...draft.scene, runBindings: [{ nodeId: uuid(12), runId: uuid(30), jobId: "canonical-job", outputsHandled: false }] },
      outbox: [{ ...outbox(), phase: "accepted", jobId: "canonical-job" }],
    };
    memory.holdCompletion = true;
    const pending = store.commit({ key: KEY, expected: initial, envelope: accepted });
    const assertion = expect(pending).rejects.toMatchObject({ code: "aborted" });
    await memory.waitForHeld();
    memory.release(new DOMException("", "AbortError"));
    await assertion;
    expect((await store.read(KEY))?.envelope).toEqual(draft);
    await store.commit({ key: KEY, expected: initial, envelope: accepted });
    expect((await store.read(KEY))?.envelope).toEqual(accepted);
  });

  it.each([
    ["envelope secret", (draft: CanvasDraftEnvelopeV1) => Object.assign(draft, { apiKey: "secret" })],
    ["scene runtime", (draft: CanvasDraftEnvelopeV1) => Object.assign(draft.scene, { status: "PROCESSING", viewportStore: {} })],
    ["preview URL", (draft: CanvasDraftEnvelopeV1) => Object.assign(draft.scene.nodes[0], { url: "blob:temporary" })],
    ["unknown metadata", (draft: CanvasDraftEnvelopeV1) => { draft.cloud = { id: uuid(1), title: "cloud", revision: 0, lastSavedAt: null, hasSavedSnapshot: false, createdAt: NOW, updatedAt: NOW }; draft.shell = "registered"; Object.assign(draft.cloud, { url: "https://private.example" }); }],
    ["outbox secret", (draft: CanvasDraftEnvelopeV1) => { draft.outbox = [Object.assign(outbox(), { turnstileToken: "secret" })]; }],
    ["foreign outbox", (draft: CanvasDraftEnvelopeV1) => { draft.outbox = [{ ...outbox(), ownerId: "foreign-owner" }]; }],
    ["negative edit revision", (draft: CanvasDraftEnvelopeV1) => { draft.editRevision = -1; }],
    ["false saved edit", (draft: CanvasDraftEnvelopeV1) => { draft.savedEditRevision = 0; }],
    ["unsafe write metadata", (draft: CanvasDraftEnvelopeV1) => { draft.deletionEpoch = Number.MAX_SAFE_INTEGER + 1; }],
    ["invalid geometry", (draft: CanvasDraftEnvelopeV1) => { draft.scene.viewport.x = Infinity; }],
  ])("rejects %s without replacing the last good draft", async (_name, corrupt) => {
    const store = await open();
    const initial = await store.commit({ key: KEY, expected: null, envelope: envelope() });
    const draft = envelope();
    corrupt(draft);
    await expect(store.commit({ key: KEY, expected: initial, envelope: draft })).rejects.toMatchObject({ code: "invalid" });
    expect((await store.read(KEY))?.envelope).toEqual(envelope());
  });

  it.each(["storage", "scene", "outbox", "capture"])("preserves unknown %s versions on read/list/commit", async (kind) => {
    const memory = new MemoryIdb();
    const store = await open(memory);
    await store.commit({ key: KEY, expected: null, envelope: envelope() });
    const record = memory.peek("drafts", [...KEY]) as { envelope: CanvasDraftEnvelopeV1 };
    if (kind === "storage") Object.assign(record.envelope, { storageVersion: 999 });
    if (kind === "scene") Object.assign(record.envelope.scene, { schemaVersion: 999 });
    if (kind === "outbox") record.envelope.outbox = [Object.assign(outbox(), { storageVersion: 999 })];
    if (kind === "capture") record.envelope.pendingSave = { saveId: uuid(40), expectedRevision: 0, editRevision: 0, deletionEpoch: 0, scene: Object.assign(scene(), { schemaVersion: 999 }), resolvedScene: null };
    memory.seed("drafts", [...KEY], record);
    const before = memory.peek("drafts", [...KEY]);
    await expect(store.read(KEY)).rejects.toMatchObject({ code: "version", key: KEY });
    await expect(store.list(OWNER)).rejects.toMatchObject({ code: "version", key: KEY });
    await expect(store.commit({ key: KEY, expected: null, envelope: envelope() })).rejects.toMatchObject({ code: "version", key: KEY });
    expect(memory.peek("drafts", [...KEY])).toEqual(before);
  });

  it("retains corrupt metadata and exposes the affected key without losing other account records", async () => {
    const memory = new MemoryIdb();
    const store = await open(memory);
    const stamp = await store.commit({ key: KEY, expected: null, envelope: envelope() });
    const otherKey: CanvasDraftKey = [OWNER, uuid(2)];
    await store.commit({ key: otherKey, expected: null, envelope: envelope({ canvasId: uuid(2), title: "unaffected" }) });
    const corrupt = { ownerId: OWNER, canvasId: uuid(1), stamp, envelope: { ...envelope(), savedEditRevision: 800 } };
    memory.seed("drafts", [...KEY], corrupt);
    await expect(store.list(OWNER)).rejects.toMatchObject({ code: "corrupt", key: KEY });
    await expect(store.read(KEY)).rejects.toMatchObject({ code: "corrupt", key: KEY });
    await expect(store.commit({ key: KEY, expected: stamp, envelope: envelope() })).rejects.toMatchObject({ code: "corrupt" });
    expect((await store.read(otherKey))?.envelope.title).toBe("unaffected");
    expect(memory.peek("drafts", [...KEY])).toEqual(corrupt);
    memory.seed("drafts", [...KEY], { ...corrupt, envelope: envelope({ ownerId: "different-owner" }) });
    await expect(store.read(KEY)).rejects.toMatchObject({ code: "corrupt", key: KEY });
  });

  it.each([["version", { storageVersion: 999 }], ["corrupt", { unexpectedUrl: "blob:runtime" }]])("retains a %s blob record through failed reads, overwrites and deletion", async (code, change) => {
    const memory = new MemoryIdb();
    const store = await open(memory);
    const stamp = await store.commit({ key: KEY, expected: null, envelope: envelope(), putBlobs: [original()] });
    const blobKey = [...KEY, original().blobId];
    const value = { ...(memory.peek("blobs", blobKey) as Record<string, unknown>), ...change };
    memory.seed("blobs", blobKey, value);
    const originalDraft = memory.peek("drafts", [...KEY]);
    await expect(store.read(KEY)).rejects.toMatchObject({ code, key: KEY });
    await expect(store.commit({ key: KEY, expected: stamp, envelope: edited(envelope(), "keep old blob"), putBlobs: [original()] })).rejects.toMatchObject({ code, key: KEY });
    await expect(store.commit({ key: KEY, expected: stamp, envelope: { ...envelope(), deletionEpoch: 1, deletedAt: NOW }, deleteBlobIds: [original().blobId] })).rejects.toMatchObject({ code, key: KEY });
    expect(memory.peek("blobs", blobKey)).toEqual(value);
    expect(memory.peek("drafts", [...KEY])).toEqual(originalDraft);
  });

  it("retains immutable originals and permits a deliberate new upload identity for expired imports", async () => {
    const store = await open();
    const blob = original();
    const draft = withReference();
    const first = await store.commit({ key: KEY, expected: null, envelope: draft, putBlobs: [blob] });
    const mapped = { ...blob, sha256: "a".repeat(64), assetId: "ready-asset" };
    const mappedStamp = await store.commit({ key: KEY, expected: first, envelope: draft, putBlobs: [mapped] });
    await expect(store.commit({ key: KEY, expected: mappedStamp, envelope: draft, putBlobs: [{ ...mapped, assetId: "wrong-identity" }] })).rejects.toMatchObject({ code: "conflict" });
    await expect(store.commit({ key: KEY, expected: mappedStamp, envelope: draft, putBlobs: [{ ...mapped, blob: new Blob(["changed bytes"], { type: "image/png" }) }] })).rejects.toMatchObject({ code: "conflict" });
    const replacement = { ...mapped, uploadId: uuid(90), assetId: "replacement-asset" };
    const retryDraft = withReference(envelope({ editRevision: 1 }), replacement);
    await store.commit({ key: KEY, expected: mappedStamp, envelope: retryDraft, putBlobs: [replacement] });
    expect((await store.read(KEY))?.blobs[0]).toMatchObject({ blobId: blob.blobId, uploadId: uuid(90), assetId: "replacement-asset", sha256: "a".repeat(64) });
    expect(await (await store.read(KEY))?.blobs[0].blob.text()).toBe("original fixture");
  });

  it("protects originals captured by a pending save when the current reference was removed", async () => {
    const store = await open();
    const originalScene = withReference().scene;
    const draft = envelope({ editRevision: 1, pendingSave: { saveId: uuid(40), expectedRevision: 0, editRevision: 0, deletionEpoch: 0, scene: originalScene, resolvedScene: null } });
    const stamp = await store.commit({ key: KEY, expected: null, envelope: draft, putBlobs: [original()] });
    await expect(store.commit({ key: KEY, expected: stamp, envelope: draft, deleteBlobIds: [original().blobId] })).rejects.toMatchObject({ code: "invalid" });
    expect((await store.read(KEY))?.blobs).toHaveLength(1);
    await store.commit({ key: KEY, expected: stamp, envelope: { ...draft, pendingSave: null }, deleteBlobIds: [original().blobId] });
    expect((await store.read(KEY))?.blobs).toEqual([]);
  });

  it("rejects unsupported, oversized or unknown-field originals atomically", async () => {
    const store = await open();
    for (const blob of [
      { ...original(), blob: new Blob(["svg"], { type: "image/svg+xml" }) },
      { ...original(), blob: new Blob([new Uint8Array(CANVAS_LIMITS.importBytes + 1)], { type: "image/png" }) },
      Object.assign(original(), { url: "blob:runtime" }),
      { ...original(), blob: { size: 10, type: "image/png", arrayBuffer: () => Promise.resolve(new ArrayBuffer(10)) } },
    ]) {
      await expect(store.commit({ key: KEY, expected: null, envelope: withReference(), putBlobs: [blob as CanvasDraftBlobV1] })).rejects.toMatchObject({ code: "invalid" });
      expect(await store.read(KEY)).toBeNull();
    }
  });

  it("rejects a write that would exceed the bounded blob reader, but permits atomic replacement", async () => {
    const memory = new MemoryIdb();
    const store = await open(memory);
    const stamp = await store.commit({ key: KEY, expected: null, envelope: envelope() });
    for (let index = 0; index < CANVAS_LIMITS.ownerAccountedImports; index += 1) {
      const blob = original(2000 + index * 2);
      memory.seed("blobs", [...KEY, blob.blobId], { storageVersion: 1, ownerId: OWNER, canvasId: uuid(1), blobId: blob.blobId, original: blob });
    }
    await expect(store.commit({ key: KEY, expected: stamp, envelope: envelope(), putBlobs: [original()] })).rejects.toMatchObject({ code: "limit" });
    expect(memory.stores.get("blobs")?.records.size).toBe(CANVAS_LIMITS.ownerAccountedImports);
    expect(memory.peek("blobs", [...KEY, uuid(20)])).toBeUndefined();
    await store.commit({ key: KEY, expected: stamp, envelope: envelope(), putBlobs: [original()], deleteBlobIds: [uuid(2000)] });
    expect(memory.stores.get("blobs")?.records.size).toBe(CANVAS_LIMITS.ownerAccountedImports);
    expect((await store.read(KEY))?.blobs).toHaveLength(CANVAS_LIMITS.ownerAccountedImports);
  });

  it.each(["close", "versionchange"])("aborts pending transactions during %s and rejects further writes", async (action) => {
    const memory = new MemoryIdb();
    const store = await open(memory);
    memory.holdCompletion = true;
    const pending = store.commit({ key: KEY, expected: null, envelope: envelope() });
    const code = action === "close" ? "closed" : "version";
    const assertion = expect(pending).rejects.toMatchObject({ code });
    await memory.waitForHeld();
    if (action === "close") store.close();
    else memory.versionchange();
    await assertion;
    expect(memory.peek("drafts", [...KEY])).toBeUndefined();
    expect(memory.connections.every((connection) => connection.closed)).toBe(true);
    await expect(store.read(KEY)).rejects.toMatchObject({ code });
    await expect(store.commit({ key: KEY, expected: null, envelope: envelope() })).rejects.toMatchObject({ code });
  });

  it("bounds stalled transactions and preserves the last committed draft", async () => {
    vi.useFakeTimers();
    const memory = new MemoryIdb();
    const store = await open(memory, 100, 25);
    const stamp = await store.commit({ key: KEY, expected: null, envelope: envelope() });
    memory.holdCompletion = true;
    const pending = store.commit({ key: KEY, expected: stamp, envelope: edited(envelope(), "timed out") });
    const assertion = expect(pending).rejects.toMatchObject({ code: "timeout" });
    await memory.waitForHeld();
    await vi.advanceTimersByTimeAsync(26);
    await assertion;
    memory.holdCompletion = false;
    expect((await store.read(KEY))?.envelope).toEqual(envelope());
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects blocked opens and closes a late successful connection", async () => {
    const memory = new MemoryIdb();
    const initial = await open(memory);
    initial.close();
    memory.blockNextOpen = true;
    await expect(open(memory)).rejects.toMatchObject({ code: "blocked" });
    memory.delayedOpen!();
    expect(memory.connections.every((connection) => connection.closed)).toBe(true);
  });

  it("times out an unanswered open and aborts a late upgrade without writing a schema", async () => {
    vi.useFakeTimers();
    const memory = new MemoryIdb();
    memory.hangNextOpen = true;
    const pending = open(memory, 100, 25);
    const assertion = expect(pending).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(26);
    await assertion;
    memory.delayedOpen!();
    expect(memory.version).toBe(0);
    expect(memory.stores.size).toBe(0);
    expect(memory.connections.every((connection) => connection.closed)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not downgrade a future DB or repair a mismatched existing schema", async () => {
    const memory = new MemoryIdb();
    const store = await open(memory);
    await store.commit({ key: KEY, expected: null, envelope: envelope() });
    store.close();
    const before = memory.peek("drafts", [...KEY]);
    memory.version = 2;
    await expect(open(memory)).rejects.toMatchObject({ code: "version" });
    expect(memory.peek("drafts", [...KEY])).toEqual(before);
    memory.version = 1;
    memory.stores.get("drafts")!.keyPath = ["canvasId"];
    await expect(open(memory)).rejects.toMatchObject({ code: "corrupt" });
    expect(memory.stores.get("drafts")!.keyPath).toEqual(["canvasId"]);
    expect(memory.peek("drafts", [...KEY])).toEqual(before);
  });

  it("does not access IndexedDB on import and returns a safe unavailable error only on explicit open", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
    const access = vi.fn(() => { throw new DOMException("private profile path", "SecurityError"); });
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, get: access });
    try {
      vi.resetModules();
      const imported = await import("@/components/create/canvas/draft-store");
      expect(access).not.toHaveBeenCalled();
      const error = await imported.openCanvasDraftStore({ writerId: uuid(100) }).catch((value: unknown) => value);
      expect(error).toMatchObject({ name: "CanvasDraftStoreError", code: "unavailable" });
      expect((error as Error).message).not.toContain("private profile path");
      expect(access).toHaveBeenCalledOnce();
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "indexedDB", descriptor);
      else Reflect.deleteProperty(globalThis, "indexedDB");
    }
    expect(new CanvasDraftStoreError("quota").message).not.toContain("QuotaExceededError");
  });
});
