// @vitest-environment node

import { createHash } from "node:crypto";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import {
  DeleteObjectCommand, GetBucketVersioningCommand, GetObjectCommand,
  HeadObjectCommand, PutObjectCommand, S3Client,
} from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCanvasStorageAdapter, verifyCanvasStorageCapability } from "@/lib/canvas/storage";
import { createE2EConfiguration } from "../../../scripts/lib/e2e-safety.mjs";
import { createCanvasObjectStore, fixtureMain, UNVERSIONED_XML } from "../../../scripts/fixtures/canvas-object-store.mjs";

const configuration = createE2EConfiguration({});
const bucket = `narra-e2e-${configuration.suffix}`;
let server: ReturnType<typeof createCanvasObjectStore>;
let client: S3Client;
let adapter: ReturnType<typeof createCanvasStorageAdapter>;
let origin: string;

function headers() {
  return { authorization: `AWS4-HMAC-SHA256 Credential=${configuration.storeAccessKey}/20261029/us-east-1/s3/aws4_request, SignedHeaders=host, Signature=fixture` };
}

async function control(body: { versioning?: string; failDeletes?: boolean }) {
  const response = await fetch(`${origin}/__e2e/control`, {
    method: "POST", headers: { "x-narra-e2e-token": configuration.storeToken, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  return response.json();
}

async function put(key: string, bytes = Buffer.from("fixture bytes")) {
  return client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentLength: bytes.length, IfNoneMatch: "*", ChecksumSHA256: createHash("sha256").update(bytes).digest("base64") }));
}

beforeEach(async () => {
  server = createCanvasObjectStore({ bucket, accessKey: configuration.storeAccessKey, controlToken: configuration.storeToken, maxObjectBytes: 512, maxTotalBytes: 700, maxObjects: 2 });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  client = new S3Client({ endpoint: origin, region: "us-east-1", forcePathStyle: true, maxAttempts: 1, credentials: { accessKeyId: configuration.storeAccessKey, secretAccessKey: configuration.storeSecretKey } });
  adapter = createCanvasStorageAdapter({ S3_ENDPOINT: origin, S3_REGION: "us-east-1", S3_BUCKET: bucket, S3_ACCESS_KEY_ID: configuration.storeAccessKey, S3_SECRET_ACCESS_KEY: configuration.storeSecretKey, S3_PUBLIC_BASE_URL: `${origin}/${bucket}` });
});

afterEach(async () => {
  vi.restoreAllMocks();
  client?.destroy();
  adapter?.close?.();
  if (server) await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
});

describe("private in-memory E2E S3 fixture", () => {
  it("returns exact namespaced XML, HTTP 200 and no version status through the real SDK and canvas adapter", async () => {
    const wire = await fetch(`${origin}/${bucket}?versioning`, { headers: headers() });
    expect(wire.status).toBe(200);
    expect(await wire.text()).toBe(UNVERSIONED_XML);
    const receipt = await client.send(new GetBucketVersioningCommand({ Bucket: bucket }));
    expect(receipt.$metadata.httpStatusCode).toBe(200);
    expect(receipt.Status).toBeUndefined();
    await expect(verifyCanvasStorageCapability(adapter)).resolves.toBeUndefined();
  });

  it.each(["enabled", "suspended", "denied", "unknown"])("fails closed for %s versioning and recovers only with valid unversioned XML", async (versioning) => {
    await control({ versioning });
    await expect(verifyCanvasStorageCapability(adapter)).rejects.toMatchObject({ code: "CANVAS_STORAGE_CAPABILITY_INVALID" });
    await control({ versioning: "unversioned" });
    await expect(verifyCanvasStorageCapability(adapter)).resolves.toBeUndefined();
  });

  it("supports checksum PUT/HEAD/GET and idempotent exact-key DELETE without touching a sibling", async () => {
    const bytes = Buffer.from("original fixture");
    const receipt = await adapter.putObject({ key: "imports/first.png", bytes, mimeType: "image/png", sha256: createHash("sha256").update(bytes).digest("hex"), signal: AbortSignal.timeout(3_000) });
    expect(receipt.versionId).toBeNull();
    await put("imports/first.png.sibling");
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: "imports/first.png" }));
    expect(head.ContentLength).toBe(bytes.length);
    expect(head.VersionId).toBeUndefined();
    const read = await client.send(new GetObjectCommand({ Bucket: bucket, Key: "imports/first.png" }));
    expect(await read.Body?.transformToString()).toBe(bytes.toString());
    for (let index = 0; index < 2; index++) {
      const removed = await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: "imports/first.png" }));
      expect(removed.$metadata.httpStatusCode).toBe(204);
      expect(removed.DeleteMarker).not.toBe(true);
      expect(removed.VersionId).toBeUndefined();
    }
    await expect(client.send(new HeadObjectCommand({ Bucket: bucket, Key: "imports/first.png" }))).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
    const sibling = await client.send(new GetObjectCommand({ Bucket: bucket, Key: "imports/first.png.sibling" }));
    expect(await sibling.Body?.transformToString()).toBe("fixture bytes");
  });

  it("rejects duplicate immutable PUT and a wrong checksum without changing bytes", async () => {
    await put("imports/stable.png");
    await expect(put("imports/stable.png", Buffer.from("changed"))).rejects.toMatchObject({ $metadata: { httpStatusCode: 412 } });
    const bad = await fetch(`${origin}/${bucket}/imports/bad.png`, { method: "PUT", headers: { ...headers(), "x-amz-checksum-sha256": "wrong" }, body: "new" });
    expect(bad.status).toBe(400);
    const stable = await client.send(new GetObjectCommand({ Bucket: bucket, Key: "imports/stable.png" }));
    expect(await stable.Body?.transformToString()).toBe("fixture bytes");
  });

  it("bounds declared and chunked PUT bodies before retaining an object", async () => {
    const declared = await fetch(`${origin}/${bucket}/imports/large.png`, { method: "PUT", headers: headers(), body: Buffer.alloc(513) });
    expect(declared.status).toBe(413);
    const chunked = await new Promise<number | undefined>((resolve, reject) => {
      const upload = request(`${origin}/${bucket}/imports/chunked.png`, { method: "PUT", headers: headers() }, (response) => { response.resume(); resolve(response.statusCode); });
      upload.on("error", reject);
      upload.write(Buffer.alloc(300));
      upload.end(Buffer.alloc(300));
    });
    expect(chunked).toBe(413);
    expect((await control({})).objectCount).toBe(0);
  });

  it("terminates an incomplete upload within the server deadline without retaining bytes", async () => {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const upload = request(`${origin}/${bucket}/imports/incomplete.png`, { method: "PUT", headers: headers() }, (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode));
      });
      upload.once("error", reject);
      upload.setTimeout(8_000, () => upload.destroy(new Error("Fixture request exceeded its bounded deadline")));
      upload.write(Buffer.from("incomplete"));
    });
    expect(status).toBe(408);
    const empty = await control({});
    expect(empty.objectCount).toBe(0);
    expect(empty.bytesStored).toBe(0);
    await expect(put("imports/after-timeout.png")).resolves.toMatchObject({ $metadata: { httpStatusCode: 200 } });
  }, 10_000);

  it("bounds aggregate bytes and object count, retaining old objects on quota errors", async () => {
    await put("imports/one", Buffer.alloc(300, 1));
    await put("imports/two", Buffer.alloc(300, 2));
    await expect(put("imports/three", Buffer.alloc(1))).rejects.toMatchObject({ $metadata: { httpStatusCode: 507 } });
    const oversizedReplacement = await fetch(`${origin}/${bucket}/imports/one`, { method: "PUT", headers: headers(), body: Buffer.alloc(500) });
    expect(oversizedReplacement.status).toBe(507);
    const status = await control({});
    expect(status.objectCount).toBe(2);
    expect(status.bytesStored).toBe(600);
    expect(status).not.toHaveProperty("keys");
  });

  it("keeps failed-delete data available until a successful retry", async () => {
    await put("imports/retry.png");
    await control({ failDeletes: true });
    await expect(client.send(new DeleteObjectCommand({ Bucket: bucket, Key: "imports/retry.png" }))).rejects.toMatchObject({ $metadata: { httpStatusCode: 503 } });
    expect((await client.send(new HeadObjectCommand({ Bucket: bucket, Key: "imports/retry.png" }))).$metadata.httpStatusCode).toBe(200);
    await control({ failDeletes: false });
    expect((await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: "imports/retry.png" }))).$metadata.httpStatusCode).toBe(204);
  });

  it("never lists or deletes buckets/prefixes, foreign buckets, versions or normalized key aliases", async () => {
    await put("imports/keep.png");
    for (const [method, suffix] of [["GET", `${bucket}?list-type=2`], ["DELETE", bucket], ["DELETE", `${bucket}/imports/keep.png?versionId=version`], ["GET", `${bucket}/imports%2Fkeep.png`], ["DELETE", `foreign/imports/keep.png`]]) {
      const response = await fetch(`${origin}/${suffix}`, { method, headers: headers() });
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
    expect((await client.send(new HeadObjectCommand({ Bucket: bucket, Key: "imports/keep.png" }))).$metadata.httpStatusCode).toBe(200);
  });

  it("rejects raw traversal and encoded separators rather than deleting a normalized sibling key", async () => {
    await put("imports/keep.png");
    for (const suffix of ["imports/../imports/keep.png", "imports/%2e%2e/imports/keep.png", "imports%2fkeep.png", "imports%5ckeep.png", "imports//keep.png", "imports/%00keep.png"]) {
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const operation = request(origin, { method: "DELETE", path: `/${bucket}/${suffix}`, headers: headers() }, (response) => {
          response.resume();
          response.once("end", () => resolve(response.statusCode));
        });
        operation.once("error", reject);
        operation.setTimeout(3_000, () => operation.destroy(new Error("Fixture request timed out")));
        operation.end();
      });
      expect(status).toBe(400);
    }
    const status = await control({});
    expect(status.counters.delete).toBe(0);
    expect(status.objectCount).toBe(1);
    expect((await client.send(new HeadObjectCommand({ Bucket: bucket, Key: "imports/keep.png" }))).$metadata.httpStatusCode).toBe(200);
  });

  it.each([
    "http://external.invalid:8081/readyz", "http://worker:8081/healthz", "http://worker:80/readyz",
    "http://user:secret@worker:8081/readyz", "http://worker:8081/readyz?forward=1", "http://worker:8081/readyz#other",
  ])("rejects a non-internal readiness target before any fetch: %s", async (target) => {
    await expect(fixtureMain(["probe", target], {})).rejects.toThrow(/internal/);
  });

  it("requires fixture-only credentials and authenticated loopback controls", async () => {
    expect((await fetch(`${origin}/${bucket}?versioning`)).status).toBe(403);
    expect((await fetch(`${origin}/__e2e/status`)).status).toBe(403);
    expect((await fetch(`${origin}/__e2e/control`, { method: "POST", headers: { "x-narra-e2e-token": configuration.storeToken }, body: '{"url":"https://real.invalid"}' })).status).toBe(400);
    await expect(fixtureMain(["probe", "https://real.invalid/readyz"], {})).rejects.toThrow(/internal/);
    await expect(fixtureMain([], {})).rejects.toThrow(/runner-owned/);
  });

  it.each(["https://real.invalid/file.png", "../file.png", "e2e/foreign/file.png", "e2e//file.png"])("refuses a seed outside the exact owner namespace before a request: %s", async (key) => {
    const fetch = vi.spyOn(globalThis, "fetch");
    await expect(fixtureMain(["objects", "put", JSON.stringify([key])], {
      E2E_FIXTURE_CONTAINER: "1", E2E_OWNER_TOKEN: configuration.owner,
      E2E_STORE_BUCKET: bucket, E2E_STORE_ACCESS_KEY: configuration.storeAccessKey,
    })).rejects.toThrow(/fixture keys/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires the fixture sentinel and rejects duplicate/unbounded object operations", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const key = `e2e/${configuration.owner}/${configuration.owner}.png`;
    const source = { E2E_FIXTURE_CONTAINER: "1", E2E_OWNER_TOKEN: configuration.owner, E2E_STORE_BUCKET: bucket, E2E_STORE_ACCESS_KEY: configuration.storeAccessKey };
    await expect(fixtureMain(["objects", "put", JSON.stringify([key])], {})).rejects.toThrow(/runner-owned/);
    for (const keys of [[], [key, key], Array.from({ length: 33 }, (_, index) => `imports/${index}.png`)]) {
      await expect(fixtureMain(["objects", "head", JSON.stringify(keys)], source)).rejects.toThrow(/fixture keys/);
    }
    await expect(fixtureMain(["objects", "delete", JSON.stringify([key])], source)).rejects.toThrow(/runner-owned/);
    expect(fetch).not.toHaveBeenCalled();
  });
});
