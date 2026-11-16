import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { access, link, lstat, open, readdir, realpath, unlink, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { MAX_IMAGE_BYTES } from "@/lib/storage/image-contract";

export const LOCAL_IMAGE_VOLUME_MARKER = ".narra-image-volume-v1";
const MARKER_PREFIX = "narra-image-volume-v1\n";
const CHUNK_BYTES = 64 * 1024;
// Unlike $, this end assertion cannot match before a trailing line terminator.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\s\S])/;
const SHA256 = /^[0-9a-f]{64}(?![\s\S])/;
const KEY_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}(?![\s\S])/;

export type LocalImageStoreErrorCode =
  | "LOCAL_IMAGE_INVALID_CONFIG" | "LOCAL_IMAGE_VOLUME_UNAVAILABLE" | "LOCAL_IMAGE_VOLUME_MISMATCH"
  | "LOCAL_IMAGE_INVALID_OBJECT" | "LOCAL_IMAGE_UNSAFE_PATH" | "LOCAL_IMAGE_OBJECT_EXISTS"
  | "LOCAL_IMAGE_WRITE_PENDING" | "LOCAL_IMAGE_NOT_FOUND" | "LOCAL_IMAGE_CONTENT_MISMATCH"
  | "LOCAL_IMAGE_STORAGE_UNAVAILABLE" | "LOCAL_IMAGE_ABORTED";

export class LocalImageStoreError extends Error {
  constructor(readonly code: LocalImageStoreErrorCode) {
    super(code);
    this.name = "LocalImageStoreError";
  }
}

export type LocalImageStoreConfig = { rootDirectory: string; volumeId: string };
export type LocalImageObject = { key: string; byteLength: number; sha256: string; signal?: AbortSignal };
export type LocalImageMetadata = { byteLength: number; sha256: string };
export type LocalImageVolume = { volumeId: string; locationId: string };
export type LocalImageReader = LocalImageMetadata & { stream: Readable; close: () => Promise<void> };
export type LocalImageStore = {
  verify: (signal?: AbortSignal) => Promise<LocalImageVolume>;
  probeWritable: (signal?: AbortSignal) => Promise<LocalImageVolume>;
  put: (input: LocalImageObject & { bytes: Buffer }) => Promise<LocalImageMetadata>;
  open: (input: LocalImageObject) => Promise<LocalImageReader>;
  read: (input: LocalImageObject) => Promise<Buffer>;
  head: (input: LocalImageObject) => Promise<LocalImageMetadata>;
  delete: (input: LocalImageObject) => Promise<"deleted" | "missing">;
};

type Root = { ioPath: string; handle: FileHandle; assertIdentity: () => Promise<void>; close: () => Promise<void> };

function fail(code: LocalImageStoreErrorCode): never { throw new LocalImageStoreError(code); }
function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
}
function storageError(error: unknown): LocalImageStoreError {
  return error instanceof LocalImageStoreError ? error : new LocalImageStoreError("LOCAL_IMAGE_STORAGE_UNAVAILABLE");
}
function checkAbort(signal?: AbortSignal): void { if (signal?.aborted) fail("LOCAL_IMAGE_ABORTED"); }
function sameFile(left: BigIntStats, right: BigIntStats): boolean { return left.dev === right.dev && left.ino === right.ino; }
function metadata(input: LocalImageObject): LocalImageMetadata { return { byteLength: input.byteLength, sha256: input.sha256 }; }
function volume(config: LocalImageStoreConfig): LocalImageVolume { return { volumeId: config.volumeId, locationId: `local-v1:${config.volumeId}` }; }
function markerBytes(config: LocalImageStoreConfig): Buffer { return Buffer.from(`${MARKER_PREFIX}${config.volumeId}\n`, "utf8"); }

function validateConfig(input: LocalImageStoreConfig): LocalImageStoreConfig {
  if (!input || typeof input.rootDirectory !== "string" || !path.isAbsolute(input.rootDirectory)
    || input.rootDirectory.includes("\0") || typeof input.volumeId !== "string" || !UUID.test(input.volumeId)) fail("LOCAL_IMAGE_INVALID_CONFIG");
  const rootDirectory = path.resolve(input.rootDirectory);
  if (rootDirectory === path.parse(rootDirectory).root) fail("LOCAL_IMAGE_INVALID_CONFIG");
  return { rootDirectory, volumeId: input.volumeId };
}

export function localImageObjectNames(key: string): { object: string; staging: string } {
  if (typeof key !== "string" || key.length === 0 || key.length > 512 || !key.split("/").every((part) => KEY_SEGMENT.test(part))) {
    fail("LOCAL_IMAGE_INVALID_OBJECT");
  }
  const digest = createHash("sha256").update(key, "utf8").digest("hex");
  return { object: `image-${digest}.bin`, staging: `.image-${digest}.writing` };
}

function validateObject(input: LocalImageObject): ReturnType<typeof localImageObjectNames> {
  if (!input || !Number.isSafeInteger(input.byteLength) || input.byteLength < 1 || input.byteLength > MAX_IMAGE_BYTES
    || typeof input.sha256 !== "string" || !SHA256.test(input.sha256)) fail("LOCAL_IMAGE_INVALID_OBJECT");
  checkAbort(input.signal);
  return localImageObjectNames(input.key);
}

async function statOrMissing(filePath: string): Promise<BigIntStats | null> {
  try { return await lstat(filePath, { bigint: true }); }
  catch (error) { if (errorCode(error) === "ENOENT") return null; throw error; }
}

async function openRoot(config: LocalImageStoreConfig, signal?: AbortSignal): Promise<Root> {
  checkAbort(signal);
  let handle: FileHandle | undefined;
  try {
    const requested = await lstat(config.rootDirectory, { bigint: true });
    if (!requested.isDirectory() || requested.isSymbolicLink()) fail("LOCAL_IMAGE_UNSAFE_PATH");
    const canonical = await realpath(config.rootDirectory);
    handle = await open(canonical, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0));
    const identity = await handle.stat({ bigint: true });
    if (!identity.isDirectory() || !sameFile(requested, identity)) fail("LOCAL_IMAGE_UNSAFE_PATH");
    // Flat filenames below a pinned Linux directory descriptor cannot traverse
    // a swapped directory path. Other platforms retain the handle and recheck
    // both root and file identities; the volume is exclusively service-owned.
    const ioPath = process.platform === "linux" ? `/proc/self/fd/${handle.fd}` : canonical;
    const assertIdentity = async () => {
      const current = await lstat(config.rootDirectory, { bigint: true });
      if (!current.isDirectory() || current.isSymbolicLink() || !sameFile(identity, current)
        || await realpath(config.rootDirectory) !== canonical) fail("LOCAL_IMAGE_UNSAFE_PATH");
    };
    await assertIdentity();
    await access(ioPath, constants.R_OK);
    checkAbort(signal);
    const held = handle;
    return { ioPath, handle: held, assertIdentity, close: () => held.close() };
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (error instanceof LocalImageStoreError) throw error;
    fail("LOCAL_IMAGE_VOLUME_UNAVAILABLE");
  }
}

async function openRegular(root: Root, name: string, expectedLength: number): Promise<{ file: FileHandle; identity: BigIntStats }> {
  await root.assertIdentity();
  const target = path.join(root.ioPath, name);
  const before = await statOrMissing(target);
  if (!before) fail("LOCAL_IMAGE_NOT_FOUND");
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== BigInt(1)) fail("LOCAL_IMAGE_UNSAFE_PATH");
  let file: FileHandle | undefined;
  try {
    file = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const identity = await file.stat({ bigint: true });
    const after = await lstat(target, { bigint: true });
    if (!identity.isFile() || identity.nlink !== BigInt(1) || !sameFile(before, identity)
      || after.isSymbolicLink() || !sameFile(after, identity)) fail("LOCAL_IMAGE_UNSAFE_PATH");
    if (identity.size !== BigInt(expectedLength)) fail("LOCAL_IMAGE_CONTENT_MISMATCH");
    await root.assertIdentity();
    return { file, identity };
  } catch (error) { await file?.close().catch(() => undefined); throw error; }
}

async function readExact(file: FileHandle, length: number, signal?: AbortSignal): Promise<Buffer> {
  const bytes = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    checkAbort(signal);
    const result = await file.read(bytes, offset, length - offset, offset);
    if (result.bytesRead === 0) fail("LOCAL_IMAGE_CONTENT_MISMATCH");
    offset += result.bytesRead;
  }
  const extra = Buffer.alloc(1);
  if ((await file.read(extra, 0, 1, length)).bytesRead !== 0) fail("LOCAL_IMAGE_CONTENT_MISMATCH");
  checkAbort(signal);
  return bytes;
}

async function verifyMarker(root: Root, config: LocalImageStoreConfig, signal?: AbortSignal): Promise<void> {
  if (await statOrMissing(path.join(root.ioPath, `${LOCAL_IMAGE_VOLUME_MARKER}.writing`))) fail("LOCAL_IMAGE_VOLUME_UNAVAILABLE");
  const expected = markerBytes(config);
  let file: FileHandle;
  try { ({ file } = await openRegular(root, LOCAL_IMAGE_VOLUME_MARKER, expected.length)); }
  catch (error) {
    if (error instanceof LocalImageStoreError && error.code === "LOCAL_IMAGE_NOT_FOUND") fail("LOCAL_IMAGE_VOLUME_UNAVAILABLE");
    if (error instanceof LocalImageStoreError && error.code === "LOCAL_IMAGE_CONTENT_MISMATCH") fail("LOCAL_IMAGE_VOLUME_MISMATCH");
    throw error;
  }
  try {
    if (!(await readExact(file, expected.length, signal)).equals(expected)) fail("LOCAL_IMAGE_VOLUME_MISMATCH");
  } finally { await file.close(); }
}

async function noPending(root: Root, staging: string): Promise<void> {
  if (await statOrMissing(path.join(root.ioPath, staging))) fail("LOCAL_IMAGE_WRITE_PENDING");
}

async function openObject(root: Root, config: LocalImageStoreConfig, names: ReturnType<typeof localImageObjectNames>, input: LocalImageObject): Promise<Awaited<ReturnType<typeof openRegular>>> {
  await noPending(root, names.staging);
  let opened: Awaited<ReturnType<typeof openRegular>>;
  try { opened = await openRegular(root, names.object, input.byteLength); }
  catch (error) {
    if (error instanceof LocalImageStoreError && error.code === "LOCAL_IMAGE_NOT_FOUND") {
      // A writer may have created its stage after the first pending check.
      // Recheck the volume and stage before reporting definitive absence.
      await verifyMarker(root, config, input.signal);
      await noPending(root, names.staging);
      checkAbort(input.signal);
    }
    throw error;
  }
  try {
    await noPending(root, names.staging);
    checkAbort(input.signal);
    return opened;
  } catch (error) {
    await opened.file.close();
    throw error;
  }
}

async function syncDirectory(root: Root): Promise<void> {
  // Windows does not support FlushFileBuffers on directory handles. File data
  // is still flushed before publishing; POSIX also persists the directory entry.
  if (process.platform !== "win32") await root.handle.sync();
}

async function removeOwned(root: Root, name: string, identity: BigIntStats): Promise<void> {
  await root.assertIdentity();
  const target = path.join(root.ioPath, name);
  const current = await statOrMissing(target);
  if (!current) return;
  if (!current.isFile() || current.isSymbolicLink() || !sameFile(current, identity)) fail("LOCAL_IMAGE_UNSAFE_PATH");
  await unlink(target);
  await syncDirectory(root);
}

async function withRoot<T>(config: LocalImageStoreConfig, signal: AbortSignal | undefined, operation: (root: Root) => Promise<T>): Promise<T> {
  const root = await openRoot(config, signal);
  try {
    try { await verifyMarker(root, config, signal); return await operation(root); }
    finally { await root.close(); }
  }
  catch (error) { throw storageError(error); }
}

async function* verifiedChunks(file: FileHandle, input: LocalImageObject): AsyncGenerator<Buffer> {
  const digest = createHash("sha256");
  let offset = 0;
  while (offset < input.byteLength) {
    checkAbort(input.signal);
    const bytes = Buffer.allocUnsafe(Math.min(CHUNK_BYTES, input.byteLength - offset));
    const result = await file.read(bytes, 0, bytes.length, offset);
    if (result.bytesRead === 0) fail("LOCAL_IMAGE_CONTENT_MISMATCH");
    const chunk = bytes.subarray(0, result.bytesRead);
    digest.update(chunk);
    offset += result.bytesRead;
    // Withhold the final chunk until the complete object identity is proven;
    // a corrupt file must not produce a complete-looking HTTP response body.
    if (offset === input.byteLength) {
      const extra = Buffer.alloc(1);
      if ((await file.read(extra, 0, 1, offset)).bytesRead !== 0 || digest.digest("hex") !== input.sha256) fail("LOCAL_IMAGE_CONTENT_MISMATCH");
      checkAbort(input.signal);
    }
    yield chunk;
  }
}

export async function initializeLocalImageVolume(input: LocalImageStoreConfig): Promise<LocalImageVolume> {
  const config = validateConfig(input);
  const root = await openRoot(config);
  const stagingName = `${LOCAL_IMAGE_VOLUME_MARKER}.writing`;
  let stage: FileHandle | undefined;
  let identity: BigIntStats | undefined;
  try {
    if (await statOrMissing(path.join(root.ioPath, LOCAL_IMAGE_VOLUME_MARKER))) {
      await verifyMarker(root, config);
      return volume(config);
    }
    if ((await readdir(root.ioPath)).length !== 0) fail("LOCAL_IMAGE_VOLUME_UNAVAILABLE");
    await root.assertIdentity();
    stage = await open(path.join(root.ioPath, stagingName), constants.O_RDWR | constants.O_CREAT | constants.O_EXCL, 0o600);
    identity = await stage.stat({ bigint: true });
    const expected = markerBytes(config);
    await stage.writeFile(expected);
    await stage.sync();
    if (!(await readExact(stage, expected.length)).equals(expected)) fail("LOCAL_IMAGE_VOLUME_MISMATCH");
    await root.assertIdentity();
    await link(path.join(root.ioPath, stagingName), path.join(root.ioPath, LOCAL_IMAGE_VOLUME_MARKER));
    const published = await lstat(path.join(root.ioPath, LOCAL_IMAGE_VOLUME_MARKER), { bigint: true });
    if (!published.isFile() || published.isSymbolicLink() || !sameFile(published, identity)) fail("LOCAL_IMAGE_UNSAFE_PATH");
    await syncDirectory(root);
    return volume(config);
  } catch (error) { throw storageError(error); }
  finally {
    try {
      try {
        try { await stage?.close(); }
        finally { if (identity) await removeOwned(root, stagingName, identity); }
      } finally { await root.close(); }
    } catch (error) { throw storageError(error); }
  }
}

export function createLocalImageStore(input: LocalImageStoreConfig): LocalImageStore {
  const config = validateConfig(input);
  const store: LocalImageStore = {
    verify: (signal) => withRoot(config, signal, async () => volume(config)),
    probeWritable: (signal) => withRoot(config, signal, async (root) => {
      const name = `.narra-image-probe-${randomUUID()}`;
      const linkedName = `${name}.linked`;
      let file: FileHandle | undefined;
      let identity: BigIntStats | undefined;
      let linkAttempted = false;
      try {
        checkAbort(signal);
        await root.assertIdentity();
        file = await open(path.join(root.ioPath, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
        identity = await file.stat({ bigint: true });
        if (!identity.isFile() || identity.size !== BigInt(0) || identity.nlink !== BigInt(1)) fail("LOCAL_IMAGE_UNSAFE_PATH");
        await file.sync();
        await root.assertIdentity();
        const sourcePath = path.join(root.ioPath, name);
        const linkedPath = path.join(root.ioPath, linkedName);
        const source = await lstat(sourcePath, { bigint: true });
        if (!source.isFile() || source.isSymbolicLink() || !sameFile(source, identity)) fail("LOCAL_IMAGE_UNSAFE_PATH");
        checkAbort(signal);
        linkAttempted = true;
        await link(sourcePath, linkedPath);
        const published = await lstat(linkedPath, { bigint: true });
        if (!published.isFile() || published.isSymbolicLink() || published.size !== BigInt(0) || published.nlink !== BigInt(2)
          || !sameFile(published, identity)) fail("LOCAL_IMAGE_UNSAFE_PATH");
        // Real image publication requires a hard link which cannot overwrite
        // an existing destination. Test both capabilities before paid work.
        try { await link(sourcePath, linkedPath); fail("LOCAL_IMAGE_UNSAFE_PATH"); }
        catch (error) { if (errorCode(error) !== "EEXIST") throw error; }
        await syncDirectory(root);
        await verifyMarker(root, config, signal);
        return volume(config);
      } finally {
        const failures: unknown[] = [];
        try { await file?.close(); } catch (error) { failures.push(error); }
        if (identity) {
          for (const ownedName of linkAttempted ? [linkedName, name] : [name]) {
            try { await removeOwned(root, ownedName, identity); } catch (error) { failures.push(error); }
          }
        }
        if (failures.length) throw storageError(failures[0]);
      }
    }),
    async put(request) {
      const input = { ...request };
      const names = validateObject(input);
      if (!Buffer.isBuffer(input.bytes) || input.bytes.length !== input.byteLength
        || createHash("sha256").update(input.bytes).digest("hex") !== input.sha256) fail("LOCAL_IMAGE_CONTENT_MISMATCH");
      return withRoot(config, input.signal, async (root) => {
        await noPending(root, names.staging);
        if (await statOrMissing(path.join(root.ioPath, names.object))) fail("LOCAL_IMAGE_OBJECT_EXISTS");
        let stage: FileHandle | undefined;
        let identity: BigIntStats | undefined;
        try {
          checkAbort(input.signal);
          await root.assertIdentity();
          try { stage = await open(path.join(root.ioPath, names.staging), constants.O_RDWR | constants.O_CREAT | constants.O_EXCL, 0o600); }
          catch (error) { if (errorCode(error) === "EEXIST") fail("LOCAL_IMAGE_WRITE_PENDING"); throw error; }
          identity = await stage.stat({ bigint: true });
          await root.assertIdentity();
          let offset = 0;
          while (offset < input.byteLength) {
            checkAbort(input.signal);
            const result = await stage.write(input.bytes, offset, Math.min(CHUNK_BYTES, input.byteLength - offset), offset);
            if (result.bytesWritten === 0) fail("LOCAL_IMAGE_STORAGE_UNAVAILABLE");
            offset += result.bytesWritten;
          }
          await stage.sync();
          for await (const chunk of verifiedChunks(stage, input)) { void chunk; }
          await verifyMarker(root, config, input.signal);
          checkAbort(input.signal);
          const stageNow = await lstat(path.join(root.ioPath, names.staging), { bigint: true });
          if (stageNow.isSymbolicLink() || !stageNow.isFile() || !sameFile(stageNow, identity)) fail("LOCAL_IMAGE_UNSAFE_PATH");
          try { await link(path.join(root.ioPath, names.staging), path.join(root.ioPath, names.object)); }
          catch (error) { if (errorCode(error) === "EEXIST") fail("LOCAL_IMAGE_OBJECT_EXISTS"); throw error; }
          const published = await lstat(path.join(root.ioPath, names.object), { bigint: true });
          if (!published.isFile() || published.isSymbolicLink() || !sameFile(published, identity)) fail("LOCAL_IMAGE_UNSAFE_PATH");
          await syncDirectory(root);
          checkAbort(input.signal);
          return metadata(input);
        } finally {
          try { await stage?.close(); }
          finally { if (identity) await removeOwned(root, names.staging, identity); }
        }
      });
    },
    async open(request) {
      const input = { ...request };
      const names = validateObject(input);
      const root = await openRoot(config, input.signal);
      let file: FileHandle | undefined;
      try {
        await verifyMarker(root, config, input.signal);
        ({ file } = await openObject(root, config, names, input));
        const held = file;
        let closed: Promise<void> | undefined;
        const closeHandles = () => closed ??= (async () => {
          input.signal?.removeEventListener("abort", abort);
          try {
            try { await held.close(); }
            finally { await root.close(); }
          } catch (error) { throw storageError(error); }
        })();
        const stream = Readable.from((async function* () {
          try { yield* verifiedChunks(held, input); }
          catch (error) { throw storageError(error); }
          finally { await closeHandles(); }
        })(), { objectMode: false, highWaterMark: CHUNK_BYTES });
        // Cancellation may occur before the caller attaches its consumer.
        // Async iteration/pipeline still receives this error normally.
        stream.on("error", () => undefined);
        const abort = () => stream.destroy(new LocalImageStoreError("LOCAL_IMAGE_ABORTED"));
        input.signal?.addEventListener("abort", abort, { once: true });
        stream.once("close", () => { void closeHandles().catch(() => undefined); });
        if (input.signal?.aborted) abort();
        return { ...metadata(input), stream, close: async () => { stream.destroy(); await closeHandles(); } };
      } catch (error) {
        await file?.close().catch(() => undefined);
        await root.close().catch(() => undefined);
        throw storageError(error);
      }
    },
    async read(request) {
      const input = { ...request };
      const reader = await store.open(input);
      const chunks: Buffer[] = [];
      try {
        for await (const chunk of reader.stream) chunks.push(Buffer.from(chunk));
        return Buffer.concat(chunks, input.byteLength);
      } finally { await reader.close(); }
    },
    async head(request) {
      const input = { ...request };
      const names = validateObject(input);
      return withRoot(config, input.signal, async (root) => {
        const { file } = await openObject(root, config, names, input);
        try { checkAbort(input.signal); return metadata(input); }
        finally { await file.close(); }
      });
    },
    async delete(request) {
      const input = { ...request };
      const names = validateObject(input);
      return withRoot(config, input.signal, async (root) => {
        let opened: Awaited<ReturnType<typeof openRegular>>;
        try { opened = await openObject(root, config, names, input); }
        catch (error) {
          if (!(error instanceof LocalImageStoreError) || error.code !== "LOCAL_IMAGE_NOT_FOUND") throw error;
          return "missing";
        }
        try { for await (const chunk of verifiedChunks(opened.file, input)) { void chunk; } }
        finally { await opened.file.close(); }
        await verifyMarker(root, config, input.signal);
        await noPending(root, names.staging);
        checkAbort(input.signal);
        await removeOwned(root, names.object, opened.identity);
        return "deleted";
      });
    },
  };
  return store;
}
