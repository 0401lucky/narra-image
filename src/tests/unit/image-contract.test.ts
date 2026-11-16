// @vitest-environment node

import { describe, expect, it } from "vitest";

import locations from "../../../contracts/canvas/v1/scenarios/storage-location.json";
import media from "../../../contracts/media/v1/contract.json";
import boundaries from "../../../contracts/media/v1/scenarios/input-boundaries.json";
import {
  DEFAULT_IMAGE_QUOTA_BYTES, ImageStorageError, MAX_IMAGE_BYTES, imageByteLength, imageDatabaseError, imageIdSchema,
  imageLocalLocation, imageOutputBudget, imagePublicUrl, imageS3Location, imageUsageSchema, imageWriteObjectSchema,
} from "@/lib/storage/image-contract";

describe("shared image storage boundaries", () => {
  it("keeps decimal 5GB distinct from 32-bit limits and encodes only exact image byte counts", () => {
    expect(DEFAULT_IMAGE_QUOTA_BYTES).toBe(BigInt("5000000000"));
    expect(DEFAULT_IMAGE_QUOTA_BYTES > BigInt("2147483647")).toBe(true);
    expect(MAX_IMAGE_BYTES).toBe(media.limits.imageBytes);
    expect(imageOutputBudget(4)).toBe(BigInt("209715200"));
    expect(imageByteLength(BigInt("52428800"))).toBe("52428800");
    for (const invalid of [0, -1, 1.5, Number.NaN, 52_428_801, "01", "1e3", "9007199254740992"]) {
      expect(() => imageByteLength(invalid)).toThrow(ImageStorageError);
    }
    for (const count of [0, -1, 5, 1.1, Number.MAX_SAFE_INTEGER]) expect(() => imageOutputBudget(count)).toThrow(ImageStorageError);
  });

  it.each(locations.vectors)("preserves existing S3 location identity: $id", (vector) => {
    if (!vector.valid) {
      expect(() => imageS3Location(vector.input)).toThrow(ImageStorageError);
      return;
    }
    const location = imageS3Location(vector.input);
    expect(location.id).toBe(vector.storageLocation);
    expect(JSON.stringify([location.endpoint, location.region, location.bucket])).toBe(vector.material);
    expect(location.volumeId).toBeNull();
  });

  it("identifies LOCAL by the explicit volume UUID, never a filesystem path", () => {
    const volume = "00112233-4455-4677-8899-aabbccddeeff";
    expect(imageLocalLocation(volume)).toMatchObject({ id: `local-v1:${volume}`, provider: "LOCAL", endpoint: null, bucket: null, volumeId: volume });
    for (const invalid of ["/data/images", "E:\\images", volume.toUpperCase(), "../images", ""]) expect(() => imageLocalLocation(invalid)).toThrow(ImageStorageError);
  });

  it("shares strict identifier and decimal boundaries with Go, including trailing newlines", () => {
    expect(boundaries.version).toBe(1);
    for (const value of boundaries.invalidVolumeIds) {
      expect(() => imageLocalLocation(value)).toThrow(ImageStorageError);
      expect(imageIdSchema.safeParse(value).success).toBe(false);
    }
    for (const value of boundaries.invalidDigests) {
      expect(() => imagePublicUrl("https://images.example.test", value)).toThrow(ImageStorageError);
      expect(imageWriteObjectSchema.shape.sha256.safeParse(value).success).toBe(false);
    }
    for (const value of boundaries.invalidByteLengths) expect(() => imageByteLength(value)).toThrow(ImageStorageError);
  });

  it("builds stable external URLs without accepting credential-bearing bases", () => {
    const token = "a".repeat(64);
    expect(imagePublicUrl("https://images.example.test/", token)).toBe(`https://images.example.test/media/images/${token}`);
    for (const base of ["file:///data", "https://user@images.example.test", " https://:secret@images.example.test", "https://images.example.test?secret=1"]) {
      expect(() => imagePublicUrl(base, token)).toThrow(ImageStorageError);
      expect(() => imageS3Location({ endpoint: "https://s3.example.test", region: "auto", bucket: "images", publicBaseUrl: base })).toThrow(ImageStorageError);
    }
    expect(() => imagePublicUrl("https://images.example.test", "guessable-id")).toThrow(ImageStorageError);
  });

  it("requires decimal strings in usage DTOs rather than silently coercing JSON numbers", () => {
    const timestamp = "2026-11-12T00:00:00Z";
    const usage = {
      policy: { scope: "images", version: 1, limitBytes: "5000000000", enabled: false, quotaCleanupEnabled: true, scheduleEnabled: false,
        retentionDays: 30, intervalSeconds: 86400, nextRunAt: null, createdAt: timestamp, updatedAt: timestamp },
      usedBytes: "2306867200", reservedBytes: "209715200", assetCount: "44", objectCount: "44",
    };
    expect(imageUsageSchema.parse(usage).usedBytes).toBe("2306867200");
    expect(imageUsageSchema.safeParse({ ...usage, usedBytes: 2_306_867_200 }).success).toBe(false);
    expect(imageUsageSchema.safeParse({ ...usage, usedBytes: "2.3e9" }).success).toBe(false);
  });
});

describe("image database error boundary", () => {
  it("maps only exact whitelisted SQLSTATE messages through Prisma's two wrappers", () => {
    const code = "IMAGE_QUOTA_EXCEEDED";
    expect(imageDatabaseError({ code: "P2010", meta: { code: "23514", message: code } })?.code).toBe(code);
    expect(imageDatabaseError({ name: "DriverAdapterError", cause: { originalCode: "23514", originalMessage: code } })?.code).toBe(code);
    expect(imageDatabaseError({ code: "23514", message: `query failed: ${code}` })).toBeNull();
    expect(imageDatabaseError({ code: "23514", message: "constraint internal_table_secret" })).toBeNull();
    expect(imageDatabaseError({ code: "08006", message: code })).toBeNull();
  });
});
