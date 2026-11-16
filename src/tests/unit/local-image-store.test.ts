// @vitest-environment node

import { createHash } from "node:crypto";
import { watch } from "node:fs";
import { link, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createLocalImageStore,
  initializeLocalImageVolume,
  localImageObjectNames,
  LOCAL_IMAGE_VOLUME_MARKER,
  LocalImageStoreError,
  type LocalImageObject,
  type LocalImageStoreConfig,
} from "@/lib/storage/local-image-store";
import { MAX_IMAGE_BYTES } from "@/lib/storage/image-contract";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, link: vi.fn(actual.link), lstat: vi.fn(actual.lstat), unlink: vi.fn(actual.unlink) };
});

const volumeId = "37bea8ac-809f-4298-92d8-a3597a8437c6";
const otherVolumeId = "067c5381-8097-4805-9b82-fea604ba54e4";
const lineTerminators = ["\n", "\r", "\u2028", "\u2029"];
const ownedDirectories: string[] = [];

async function directory(): Promise<string> {
  const created = await mkdtemp(path.join(tmpdir(), "narra-local-image-"));
  ownedDirectories.push(created);
  return created;
}

async function fixture() {
  const rootDirectory = await directory();
  const config = { rootDirectory, volumeId };
  await initializeLocalImageVolume(config);
  return { config, rootDirectory, store: createLocalImageStore(config) };
}

function object(bytes = Buffer.from("image-storage-fixture"), key = "images/fixture.png") {
  return { key, bytes, byteLength: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

afterEach(async () => {
  vi.mocked(link).mockReset();
  vi.mocked(lstat).mockReset();
  vi.mocked(unlink).mockReset();
  for (const created of ownedDirectories.splice(0)) {
    const absolute = path.resolve(created);
    if (path.dirname(absolute) !== path.resolve(tmpdir()) || !path.basename(absolute).startsWith("narra-local-image-")) {
      throw new Error("Unexpected local-image test cleanup target");
    }
    await rm(absolute, { recursive: true, force: true });
  }
});

describe("local image volume", () => {
  it("requires explicit initialization and reopens the exact shared marker", async () => {
    const rootDirectory = await directory();
    const config = { rootDirectory, volumeId };
    const store = createLocalImageStore(config);
    await expect(store.verify()).rejects.toMatchObject({ code: "LOCAL_IMAGE_VOLUME_UNAVAILABLE" });
    expect(await readdir(rootDirectory)).toEqual([]);
    await expect(initializeLocalImageVolume(config)).resolves.toEqual({ volumeId, locationId: `local-v1:${volumeId}` });
    expect(await readFile(path.join(rootDirectory, LOCAL_IMAGE_VOLUME_MARKER), "utf8")).toBe(`narra-image-volume-v1\n${volumeId}\n`);
    await expect(initializeLocalImageVolume(config)).resolves.toEqual({ volumeId, locationId: `local-v1:${volumeId}` });
    await expect(createLocalImageStore(config).verify()).resolves.toEqual({ volumeId, locationId: `local-v1:${volumeId}` });
    expect(await readdir(rootDirectory)).toEqual([LOCAL_IMAGE_VOLUME_MARKER]);
  });

  it("does not claim missing, nonempty, wrong or malformed volumes", async () => {
    const parent = await directory();
    const absent = { rootDirectory: path.join(parent, "absent"), volumeId };
    await expect(initializeLocalImageVolume(absent)).rejects.toMatchObject({ code: "LOCAL_IMAGE_VOLUME_UNAVAILABLE" });
    expect(await readdir(parent)).toEqual([]);

    await writeFile(path.join(parent, "unrelated.txt"), "retain");
    await expect(initializeLocalImageVolume({ rootDirectory: parent, volumeId })).rejects.toMatchObject({ code: "LOCAL_IMAGE_VOLUME_UNAVAILABLE" });
    expect(await readdir(parent)).toEqual(["unrelated.txt"]);

    const { config, rootDirectory } = await fixture();
    const original = await readFile(path.join(rootDirectory, LOCAL_IMAGE_VOLUME_MARKER));
    await expect(initializeLocalImageVolume({ ...config, volumeId: otherVolumeId })).rejects.toMatchObject({ code: "LOCAL_IMAGE_VOLUME_MISMATCH" });
    expect(await readFile(path.join(rootDirectory, LOCAL_IMAGE_VOLUME_MARKER))).toEqual(original);
    await writeFile(path.join(rootDirectory, LOCAL_IMAGE_VOLUME_MARKER), Buffer.alloc(2000));
    await expect(createLocalImageStore(config).verify()).rejects.toMatchObject({ code: "LOCAL_IMAGE_VOLUME_MISMATCH" });
  });

  it("rejects linked roots and linked marker files even when marker bytes match", async () => {
    const { rootDirectory } = await fixture();
    const parent = await directory();
    const linked = path.join(parent, "linked-volume");
    await symlink(rootDirectory, linked, process.platform === "win32" ? "junction" : "dir");
    await expect(createLocalImageStore({ rootDirectory: linked, volumeId }).verify()).rejects.toMatchObject({ code: "LOCAL_IMAGE_UNSAFE_PATH" });

    const target = await directory();
    await symlink(path.join(rootDirectory, LOCAL_IMAGE_VOLUME_MARKER), path.join(target, LOCAL_IMAGE_VOLUME_MARKER), "file");
    await expect(initializeLocalImageVolume({ rootDirectory: target, volumeId })).rejects.toMatchObject({ code: "LOCAL_IMAGE_UNSAFE_PATH" });
    expect(await readFile(path.join(rootDirectory, LOCAL_IMAGE_VOLUME_MARKER), "utf8")).toContain(volumeId);
  });

  it("probes zero-byte hard-link publication and no-overwrite behavior, leaving neither path behind", async () => {
    const { store, rootDirectory } = await fixture();
    vi.mocked(link).mockClear();
    await expect(store.probeWritable()).resolves.toEqual({ volumeId, locationId: `local-v1:${volumeId}` });
    const calls = vi.mocked(link).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][1]).toBe(`${calls[0][0]}.linked`);
    expect(calls[1]).toEqual(calls[0]);
    expect(await readdir(rootDirectory)).toEqual([LOCAL_IMAGE_VOLUME_MARKER]);
    const cancelled = AbortSignal.abort();
    await expect(store.probeWritable(cancelled)).rejects.toMatchObject({ code: "LOCAL_IMAGE_ABORTED" });
    expect(await readdir(rootDirectory)).toEqual([LOCAL_IMAGE_VOLUME_MARKER]);
  });

  it("fails capability and cleans its source when the filesystem cannot create hard links", async () => {
    const { store, rootDirectory } = await fixture();
    vi.mocked(link).mockRejectedValueOnce(Object.assign(new Error(path.join(rootDirectory, "private-path")), { code: "ENOTSUP" }));
    await expect(store.probeWritable()).rejects.toMatchObject({ code: "LOCAL_IMAGE_STORAGE_UNAVAILABLE", message: "LOCAL_IMAGE_STORAGE_UNAVAILABLE" });
    expect(await readdir(rootDirectory)).toEqual([LOCAL_IMAGE_VOLUME_MARKER]);
  });

  it("fails capability and cleans both paths if publication allows overwriting the destination", async () => {
    const { store, rootDirectory } = await fixture();
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(link).mockImplementationOnce(actual.link).mockResolvedValueOnce(undefined);
    await expect(store.probeWritable()).rejects.toMatchObject({ code: "LOCAL_IMAGE_UNSAFE_PATH" });
    expect(await readdir(rootDirectory)).toEqual([LOCAL_IMAGE_VOLUME_MARKER]);
  });

  it("attempts cleanup of both owned probe paths even when removing one fails", async () => {
    const { store, rootDirectory } = await fixture();
    vi.mocked(unlink).mockRejectedValueOnce(Object.assign(new Error("cannot remove probe link"), { code: "EACCES" }));
    await expect(store.probeWritable()).rejects.toMatchObject({ code: "LOCAL_IMAGE_STORAGE_UNAVAILABLE" });
    const remaining = (await readdir(rootDirectory)).filter((name) => name !== LOCAL_IMAGE_VOLUME_MARKER);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatch(/^\.narra-image-probe-[0-9a-f-]+\.linked$/);
    expect(await readFile(path.join(rootDirectory, remaining[0]))).toEqual(Buffer.alloc(0));
    await unlink(path.join(rootDirectory, remaining[0]));
  });

  it.each<LocalImageStoreConfig>([
    { rootDirectory: "relative", volumeId },
    { rootDirectory: path.parse(path.resolve(tmpdir())).root, volumeId },
    { rootDirectory: path.resolve(tmpdir()), volumeId: volumeId.toUpperCase() },
    { rootDirectory: path.resolve(tmpdir()), volumeId: "not-a-uuid" },
    ...lineTerminators.map((ending) => ({ rootDirectory: path.resolve(tmpdir()), volumeId: volumeId + ending })),
  ])("rejects invalid config without accessing it", (config) => {
    expect(() => createLocalImageStore(config)).toThrow(LocalImageStoreError);
  });
});

describe("local image objects", () => {
  it("has the same deterministic flat key encoding as the Go contract", () => {
    expect(localImageObjectNames("images/fixture.png")).toEqual({
      object: "image-089786809928b8b7a61687ac77f01d228919756aafeefe9157e3e6bbaef315ef.bin",
      staging: ".image-089786809928b8b7a61687ac77f01d228919756aafeefe9157e3e6bbaef315ef.writing",
    });
  });

  it("accepts keys at the inclusive segment and total length limits", () => {
    expect(() => localImageObjectNames("a/" + "b".repeat(128))).not.toThrow();
    expect(() => localImageObjectNames(["a".repeat(128), "b".repeat(128), "c".repeat(128), "d".repeat(125)].join("/"))).not.toThrow();
  });

  it.each([
    "", "../outside", "/absolute", "a/../b", "a/./b", "a//b", "a\\b", "C:drive", "a/%2e%2e", "a/中文", "a/", "a/" + "b".repeat(129), "a/".repeat(256) + "b",
    ...lineTerminators.flatMap((ending) => [`images/fixture.png${ending}`, `images${ending}/fixture.png`]),
  ])("rejects unsafe key %s", (key) => {
    expect(() => localImageObjectNames(key)).toThrow(LocalImageStoreError);
  });

  it("publishes immutable bytes, reopens them and deletes only the registered object", async () => {
    const { store, config, rootDirectory } = await fixture();
    const input = object();
    await expect(store.put(input)).resolves.toEqual({ byteLength: input.byteLength, sha256: input.sha256 });
    const names = localImageObjectNames(input.key);
    expect((await readdir(rootDirectory)).sort()).toEqual([LOCAL_IMAGE_VOLUME_MARKER, names.object].sort());
    expect(await readFile(path.join(rootDirectory, names.object))).toEqual(input.bytes);
    const reopened = createLocalImageStore(config);
    await expect(reopened.read(input)).resolves.toEqual(input.bytes);
    await expect(reopened.head(input)).resolves.toEqual({ byteLength: input.byteLength, sha256: input.sha256 });
    await expect(store.put(object(Buffer.from("a different image")))).rejects.toMatchObject({ code: "LOCAL_IMAGE_OBJECT_EXISTS" });
    expect(await reopened.read(input)).toEqual(input.bytes);
    await expect(reopened.delete(input)).resolves.toBe("deleted");
    await expect(reopened.delete(input)).resolves.toBe("missing");
    expect(await readdir(rootDirectory)).toEqual([LOCAL_IMAGE_VOLUME_MARKER]);
  });

  it("does not write data that differs from its declared identity or bounds", async () => {
    const { store, rootDirectory } = await fixture();
    const input = object();
    await expect(store.put({ ...input, sha256: "0".repeat(64) })).rejects.toMatchObject({ code: "LOCAL_IMAGE_CONTENT_MISMATCH" });
    await expect(store.put({ ...input, byteLength: input.byteLength + 1 })).rejects.toMatchObject({ code: "LOCAL_IMAGE_CONTENT_MISMATCH" });
    for (const byteLength of [0, -1, 0.5, MAX_IMAGE_BYTES + 1, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(store.put({ ...input, byteLength })).rejects.toMatchObject({ code: "LOCAL_IMAGE_INVALID_OBJECT" });
    }
    for (const ending of lineTerminators) {
      await expect(store.head({ ...input, sha256: input.sha256 + ending })).rejects.toMatchObject({ code: "LOCAL_IMAGE_INVALID_OBJECT" });
    }
    expect(await readdir(rootDirectory)).toEqual([LOCAL_IMAGE_VOLUME_MARKER]);
  });

  it("keeps interrupted writes visible and does not sweep a pending file", async () => {
    const { store, config, rootDirectory } = await fixture();
    const input = object();
    const names = localImageObjectNames(input.key);
    const pending = path.join(rootDirectory, names.staging);
    await writeFile(pending, input.bytes.subarray(0, 4));
    for (const action of [() => store.put(input), () => store.read(input), () => store.head(input), () => store.delete(input)]) {
      await expect(action()).rejects.toMatchObject({ code: "LOCAL_IMAGE_WRITE_PENDING" });
    }
    await initializeLocalImageVolume(config);
    await store.verify();
    expect(await readFile(pending)).toEqual(input.bytes.subarray(0, 4));
    expect((await readdir(rootDirectory)).sort()).toEqual([LOCAL_IMAGE_VOLUME_MARKER, names.staging].sort());
  });

  it.each(["open", "read", "head", "delete"] as const)("does not report absence from %s when a writer creates its stage during the lookup", async (action) => {
    const { store, rootDirectory } = await fixture();
    const input = object();
    const names = localImageObjectNames(input.key);
    const pending = path.join(rootDirectory, names.staging);
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(lstat).mockImplementation(async (target, options) => {
      try { return await actual.lstat(target, options); }
      catch (error) {
        if (path.basename(target.toString()) === names.object) await writeFile(pending, input.bytes.subarray(0, 4));
        throw error;
      }
    });
    await expect(store[action](input)).rejects.toMatchObject({ code: "LOCAL_IMAGE_WRITE_PENDING" });
    expect(await readFile(pending)).toEqual(input.bytes.subarray(0, 4));
    expect((await readdir(rootDirectory)).sort()).toEqual([LOCAL_IMAGE_VOLUME_MARKER, names.staging].sort());
  });

  it("rejects symlink/non-file object entries without touching their targets", async () => {
    const { store, rootDirectory } = await fixture();
    const input = object();
    const names = localImageObjectNames(input.key);
    const externalDirectory = await directory();
    const external = path.join(externalDirectory, "keep.bin");
    await writeFile(external, input.bytes);
    await symlink(external, path.join(rootDirectory, names.object), "file");
    await expect(store.read(input)).rejects.toMatchObject({ code: "LOCAL_IMAGE_UNSAFE_PATH" });
    await expect(store.delete(input)).rejects.toMatchObject({ code: "LOCAL_IMAGE_UNSAFE_PATH" });
    expect(await readFile(external)).toEqual(input.bytes);
    await rm(path.join(rootDirectory, names.object));
    await mkdir(path.join(rootDirectory, names.object));
    await expect(store.head(input)).rejects.toMatchObject({ code: "LOCAL_IMAGE_UNSAFE_PATH" });
  });

  it("does not return or delete corrupt content under a registered key", async () => {
    const { store, rootDirectory } = await fixture();
    const input = object();
    await store.put(input);
    const filename = path.join(rootDirectory, localImageObjectNames(input.key).object);
    const damaged = Buffer.alloc(input.byteLength, 42);
    await writeFile(filename, damaged);
    await expect(store.read(input)).rejects.toMatchObject({ code: "LOCAL_IMAGE_CONTENT_MISMATCH" });
    await expect(store.delete(input)).rejects.toMatchObject({ code: "LOCAL_IMAGE_CONTENT_MISMATCH" });
    expect(await readFile(filename)).toEqual(damaged);
    await writeFile(filename, input.bytes.subarray(0, 2));
    await expect(store.head(input)).rejects.toMatchObject({ code: "LOCAL_IMAGE_CONTENT_MISMATCH" });
  });

  it("withholds a corrupt stream's final chunk and rechecks the volume for each operation", async () => {
    const { store, rootDirectory } = await fixture();
    const input = object(Buffer.alloc(256 * 1024, 6));
    await store.put(input);
    const filename = path.join(rootDirectory, localImageObjectNames(input.key).object);
    await writeFile(filename, Buffer.alloc(input.byteLength, 7));
    const reader = await store.open(input);
    let emitted = 0;
    await expect((async () => { for await (const chunk of reader.stream) emitted += chunk.length; })()).rejects.toMatchObject({ code: "LOCAL_IMAGE_CONTENT_MISMATCH" });
    expect(emitted).toBeLessThan(input.byteLength);
    await reader.close();

    await writeFile(path.join(rootDirectory, LOCAL_IMAGE_VOLUME_MARKER), `narra-image-volume-v1\n${otherVolumeId}\n`);
    for (const action of [() => store.put(input), () => store.read(input), () => store.head(input), () => store.delete(input), () => store.probeWritable()]) {
      await expect(action()).rejects.toMatchObject({ code: "LOCAL_IMAGE_VOLUME_MISMATCH" });
    }
    expect(await readFile(filename)).toEqual(Buffer.alloc(input.byteLength, 7));
  });

  it("allows only one concurrent publication for a key", async () => {
    const { store, rootDirectory } = await fixture();
    const candidates = [object(Buffer.alloc(256 * 1024, 1)), object(Buffer.alloc(256 * 1024, 2))];
    const results = await Promise.allSettled(candidates.map((input) => store.put(input)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const winner = candidates[results.findIndex((result) => result.status === "fulfilled")];
    expect(await store.read(winner)).toEqual(winner.bytes);
    expect(await readdir(rootDirectory)).not.toContain(localImageObjectNames(winner.key).staging);
  });

  it("cleans only its stage when an active write is cancelled", async () => {
    const { store, rootDirectory } = await fixture();
    const input = object(Buffer.alloc(8 * 1024 * 1024, 5));
    const names = localImageObjectNames(input.key);
    const controller = new AbortController();
    let stageObserved = false;
    const watcher = watch(rootDirectory, (_event, name) => {
      if (name?.toString() === names.staging) { stageObserved = true; controller.abort(); }
    });
    try { await expect(store.put({ ...input, signal: controller.signal })).rejects.toMatchObject({ code: "LOCAL_IMAGE_ABORTED" }); }
    finally { watcher.close(); }
    expect(stageObserved).toBe(true);
    expect(await readdir(rootDirectory)).toEqual([LOCAL_IMAGE_VOLUME_MARKER]);
  });

  it("streams bounded chunks, closes on cancellation and keeps expected metadata stable", async () => {
    const { store } = await fixture();
    const input = object(Buffer.alloc(2 * 1024 * 1024, 9));
    await store.put(input);
    const mutable: LocalImageObject = { key: input.key, byteLength: input.byteLength, sha256: input.sha256 };
    const reader = await store.open(mutable);
    mutable.byteLength = 1;
    let bytes = 0;
    let maximumChunk = 0;
    for await (const chunk of reader.stream) { bytes += chunk.length; maximumChunk = Math.max(maximumChunk, chunk.length); }
    expect(bytes).toBe(input.byteLength);
    expect(maximumChunk).toBeLessThanOrEqual(128 * 1024);
    await reader.close();

    const controller = new AbortController();
    const cancelled = await store.open({ ...input, signal: controller.signal });
    controller.abort();
    await expect((async () => { for await (const chunk of cancelled.stream) { void chunk; } })()).rejects.toMatchObject({ code: "LOCAL_IMAGE_ABORTED" });
    await cancelled.close();
    await expect(store.delete(input)).resolves.toBe("deleted");
  });
});
