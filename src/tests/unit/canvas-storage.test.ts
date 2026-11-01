// @vitest-environment node

import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ send: vi.fn(), options: vi.fn(), middleware: vi.fn() }));
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class { constructor(options: unknown) { sdk.options(options); } send = sdk.send; destroy() {} },
  GetBucketVersioningCommand: class { readonly kind = "versioning"; middlewareStack = { add: sdk.middleware }; constructor(readonly input: unknown) {} },
  HeadBucketCommand: class { readonly kind = "head"; middlewareStack = { add: sdk.middleware }; constructor(readonly input: unknown) {} },
  PutObjectCommand: class { readonly kind = "put"; constructor(readonly input: unknown) {} },
}));
vi.mock("@/lib/env", () => ({ getEnv: () => ({}) }));

import { CanvasContractError, canvasStorageLocationMaterialV1 } from "@/lib/canvas/contracts";
import { verifyCanvasImage } from "@/lib/canvas/image-container";
import { boundedCanvasStorageCall, canvasAssetUrl, canvasStorageLocation, createCanvasStorageAdapter, verifyCanvasStorageCapability, type CanvasStorageAdapter } from "@/lib/canvas/storage";
import { canvasAssetRow, canvasPng, canvasPngChunk, canvasStorageTestEnv } from "./helpers/canvas-api-fixtures";

const jpeg = Buffer.from("/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABykX//Z", "base64");
const webp = Buffer.from("UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoBAAEAAUAmJaACdLoB+AADsAD+8ut//NgVzXPv9//S4P0uD9Lg/9KQAAA=", "base64");
// Valid 1x1 transparent VP8L with five single-symbol Huffman codes.
const tinyWebp = Buffer.from("UklGRhQAAABXRUJQVlA4TAgAAAAvAAAAEIiICA==", "base64");
const paddedJpeg = Buffer.concat([jpeg.subarray(0, 2), Buffer.from([0xff]), jpeg.subarray(2)]);

describe("complete canvas image containers", () => {
  it.each([["image/png", canvasPng()], ["image/jpeg", jpeg], ["image/webp", webp], ["image/jpeg", paddedJpeg], ["image/webp", tinyWebp]] as const)("accepts a complete %s container and rejects truncation, mismatch, and appended bytes %#", (mimeType, bytes) => {
    expect(verifyCanvasImage(bytes, mimeType)).toEqual({ width: 1, height: 1 });
    expect(() => verifyCanvasImage(bytes.subarray(0, bytes.length - 1), mimeType)).toThrow(CanvasContractError);
    expect(() => verifyCanvasImage(Buffer.concat([bytes, Buffer.from("trailing")]), mimeType)).toThrow(CanvasContractError);
    expect(() => verifyCanvasImage(bytes, "image/gif")).toThrow(CanvasContractError);
  });

  it("rejects plausible PNG dimensions without a complete CRC-checked image", () => {
    const original = canvasPng();
    expect(() => verifyCanvasImage(original.subarray(0, 24), "image/png")).toThrow(CanvasContractError);
    const corrupted = Buffer.from(original); corrupted[45] ^= 1;
    expect(() => verifyCanvasImage(corrupted, "image/png")).toThrow(CanvasContractError);
    expect(() => verifyCanvasImage(Buffer.from("<svg></svg>"), "image/png")).toThrow(CanvasContractError);
  });

  it("rejects RIFF header-only and impossible chunk sizes despite plausible image dimensions", () => {
    const corrupt = Buffer.from(webp); corrupt.writeUInt32LE(0xfffffff0, 16);
    expect(() => verifyCanvasImage(corrupt, "image/webp")).toThrow(CanvasContractError);
    const headerOnly = webp.subarray(0, 30);
    expect(() => verifyCanvasImage(headerOnly, "image/webp")).toThrow(CanvasContractError);
  });

  it.each([0, 8, 12])("rejects non-ASCII RIFF/WebP identifiers without masking their high bits at %i", (offset) => {
    const malformed = Buffer.from(webp); malformed[offset] |= 0x80;
    expect(() => verifyCanvasImage(malformed, "image/webp")).toThrow(CanvasContractError);
  });

  it("rejects a CRC-correct PNG chunk with a non-ASCII identifier", () => {
    const original = canvasPng();
    const kind = Buffer.from("IHDR"); kind[0] |= 0x80;
    const malformed = Buffer.concat([original.subarray(0, 8), canvasPngChunk(kind, original.subarray(16, 29)), original.subarray(33)]);
    expect(() => verifyCanvasImage(malformed, "image/png")).toThrow(CanvasContractError);
  });
});

describe("injected canvas storage adapter", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  const location = canvasStorageLocation({ endpoint: "https://storage.invalid", region: "auto", bucket: "canvas-tests" });
  function fake(receipt: { locationId: string; verified: boolean; status?: string }): CanvasStorageAdapter {
    return { location, getBucketVersioning: vi.fn().mockResolvedValue(receipt), putObject: vi.fn() };
  }

  it("hashes exactly the shared nonsecret UTF-8 material with s3-v1 prefix", () => {
    const material = canvasStorageLocationMaterialV1({ endpoint: "https://STORAGE.invalid:443/", region: "auto", bucket: "canvas-tests" });
    expect(location.id).toBe(`s3-v1:${createHash("sha256").update(material, "utf8").digest("hex")}`);
  });

  it("accepts only successful verified unversioned capability for the exact location", async () => {
    await expect(verifyCanvasStorageCapability(fake({ locationId: location.id, verified: true }))).resolves.toBeUndefined();
  });

  it.each([
    { locationId: location.id, verified: true, status: "Enabled" },
    { locationId: location.id, verified: true, status: "Suspended" },
    { locationId: location.id, verified: true, status: "Unknown" },
    { locationId: location.id, verified: false },
    { locationId: "foreign-location", verified: true },
  ])("fails closed on storage capability ambiguity %#", async (receipt) => {
    await expect(verifyCanvasStorageCapability(fake(receipt))).rejects.toMatchObject({ code: "CANVAS_STORAGE_CAPABILITY_INVALID" });
  });

  it("fails closed on adapter/config mismatch and denied lookup without doing PUT", async () => {
    const adapter = fake({ locationId: location.id, verified: true });
    await expect(verifyCanvasStorageCapability(adapter, { ...location, bucket: "different-bucket" })).rejects.toMatchObject({ code: "CANVAS_STORAGE_CAPABILITY_INVALID" });
    adapter.getBucketVersioning = vi.fn().mockRejectedValue(new Error("denied private provider body"));
    await expect(verifyCanvasStorageCapability(adapter)).rejects.toMatchObject({ code: "CANVAS_STORAGE_CAPABILITY_INVALID" });
    expect(adapter.putObject).not.toHaveBeenCalled();
  });

  it("never falls back to base64 when object storage configuration is missing", () => {
    expect(() => createCanvasStorageAdapter({ ...canvasStorageTestEnv, S3_SECRET_ACCESS_KEY: "" })).toThrow(CanvasContractError);
    expect(sdk.options).not.toHaveBeenCalled();
  });

  it("uses the narrow S3 commands once, a verified response, and conditional original-key PUT", async () => {
    sdk.send.mockImplementationOnce(async () => {
      const guard = sdk.middleware.mock.lastCall?.[0];
      await guard(async () => ({ response: { statusCode: 200, body: Buffer.from('<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"/>') } }))({});
      return { $metadata: { httpStatusCode: 200 } };
    }).mockResolvedValueOnce({ $metadata: { httpStatusCode: 200 }, VersionId: "unexpected-version" });
    const adapter = createCanvasStorageAdapter(canvasStorageTestEnv);
    await verifyCanvasStorageCapability(adapter);
    const bytes = canvasPng(); const sha256 = createHash("sha256").update(bytes).digest("hex");
    expect(await adapter.putObject({ key: "immutable/key.png", bytes, sha256, mimeType: "image/png", signal: new AbortController().signal })).toEqual({ versionId: "unexpected-version" });
    expect(sdk.options).toHaveBeenCalledWith(expect.objectContaining({ maxAttempts: 1, forcePathStyle: true }));
    expect(sdk.send.mock.calls.map(([command]) => command.kind)).toEqual(["versioning", "put"]);
    expect(sdk.send.mock.lastCall?.[0].input).toMatchObject({ Bucket: "canvas-tests", Key: "immutable/key.png", IfNoneMatch: "*", ContentLength: bytes.length, ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64") });
  });

  it("does not verify an SDK metadata-only receipt that bypasses the wire guard", async () => {
    sdk.send.mockResolvedValueOnce({ $metadata: { httpStatusCode: 200 } });
    await expect(verifyCanvasStorageCapability(createCanvasStorageAdapter(canvasStorageTestEnv))).rejects.toMatchObject({ code: "CANVAS_STORAGE_CAPABILITY_INVALID" });
    expect(sdk.send).toHaveBeenCalledOnce();
  });

  it("does not verify an R2 HEAD metadata-only receipt that bypasses the wire guard", async () => {
    sdk.send.mockResolvedValueOnce({ $metadata: { httpStatusCode: 200 } });
    const adapter = createCanvasStorageAdapter({ ...canvasStorageTestEnv, S3_ENDPOINT: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com" });
    await expect(verifyCanvasStorageCapability(adapter)).rejects.toMatchObject({ code: "CANVAS_STORAGE_CAPABILITY_INVALID" });
    expect(sdk.send).toHaveBeenCalledOnce();
    expect(sdk.send.mock.calls[0][0].kind).toBe("head");
  });

  it("only projects trusted matching location URLs; credentials/keys never enter the DTO", () => {
    const asset = canvasAssetRow();
    expect(canvasAssetUrl(asset, canvasStorageTestEnv)).toBe("https://cdn.invalid/media/canvas-imports/original.png");
    expect(canvasAssetUrl(asset, { ...canvasStorageTestEnv, S3_PUBLIC_BASE_URL: "" })).toBe("https://storage.invalid/canvas-tests/canvas-imports/original.png");
    expect(canvasAssetUrl(asset, { ...canvasStorageTestEnv, S3_BUCKET: "different" })).toBeNull();
    expect(canvasAssetUrl({ ...asset, storageLocation: "tampered" }, canvasStorageTestEnv)).toBeNull();
    expect(canvasAssetUrl({ ...asset, storageKey: "../arbitrary-key" }, canvasStorageTestEnv)).toBeNull();
    expect(canvasAssetUrl(asset, { ...canvasStorageTestEnv, S3_PUBLIC_BASE_URL: "https://private:credential@cdn.invalid" })).toBeNull();
  });

  it("aborts bounded storage operations even when a broken adapter ignores cancellation", async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const pending = expect(boundedCanvasStorageCall((value) => { signal = value; return new Promise(() => undefined); }, 50)).rejects.toMatchObject({ code: "CANVAS_STORAGE_UNAVAILABLE" });
      await vi.advanceTimersByTimeAsync(51); await pending;
      expect(signal?.aborted).toBe(true);
    } finally { vi.useRealTimers(); }
  });
});
