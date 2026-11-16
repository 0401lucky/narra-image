import { describe, expect, it } from "vitest";

import { serializeAdminWork, serializeFeaturedWork, serializePublicWorkDetail, serializeWork } from "@/lib/prisma-mappers";
import { getImageAvailability, isImageAvailable, mergeImageAvailability } from "@/lib/storage/image-availability";
import type { ImageAvailability } from "@/lib/types";
import { formatStorageBytes, storageBytesToGb, storageGbToBytes } from "@/components/admin/storage/utils";
import { createPrivacyWork, publicWorkDetailKeys, workPrivacySentinels } from "./helpers/work-privacy-fixtures";

describe("managed image availability projection", () => {
  it("keeps legacy images readable and fails closed when a managed join is missing", () => {
    expect(getImageAvailability({ mediaAssetId: null })).toBe("available");
    expect(isImageAvailable(undefined)).toBe(true);
    expect(getImageAvailability({ mediaAssetId: "asset" })).toBe("unavailable");
    expect(getImageAvailability({ mediaAssetId: "asset", mediaAsset: { state: "AVAILABLE", activeObjectId: null } })).toBe("unavailable");
    expect(getImageAvailability({ mediaAssetId: "asset", mediaAsset: { state: "AVAILABLE", activeObjectId: "object" } })).toBe("available");
  });

  it.each(["DELETING", "PENDING", "QUARANTINED"])("does not advertise %s images as readable", (state) => {
    expect(getImageAvailability({ mediaAssetId: "asset", mediaAsset: { state, activeObjectId: "object" } })).toBe("unavailable");
  });

  it("adds only availability to cleaned work projections and preserves task/private data boundaries", () => {
    const raw = createPrivacyWork({ mediaAssetId: "asset", mediaAsset: { state: "DELETED", activeObjectId: null }, showcaseStatus: "PRIVATE" });
    const owner = serializeWork(raw);
    const publicWork = serializePublicWorkDetail(owner);
    expect(owner).toMatchObject({ availability: "cleaned", generationStatus: "succeeded", prompt: workPrivacySentinels.prompt, jobId: workPrivacySentinels.jobId });
    expect(serializeAdminWork(raw)).toMatchObject({ availability: "cleaned", author: { email: workPrivacySentinels.authorEmail } });
    expect(serializeFeaturedWork(raw)).toMatchObject({ availability: "cleaned", prompt: "作者未公开提示词" });
    expect(Object.keys(publicWork).sort()).toEqual(publicWorkDetailKeys);
    expect(publicWork).toMatchObject({ availability: "cleaned", prompt: null, negativePrompt: null });
    expect(JSON.stringify(publicWork)).not.toContain(workPrivacySentinels.reviewNote);
    expect(raw.mediaAsset?.state).toBe("DELETED");
  });

  it("retains cleanup by immutable image ID while transient failures can recover and new images stay readable", () => {
    const previous: Array<{ id: string; availability?: ImageAvailability }> = [
      { id: "cleaned", availability: "cleaned" },
      { id: "recovering", availability: "unavailable" },
    ];
    const incoming: typeof previous = [
      { id: "recovering", availability: "available" },
      { id: "new", availability: "available" },
      { id: "cleaned" },
    ];
    expect(mergeImageAvailability(previous, incoming)).toEqual([
      { id: "recovering", availability: "available" },
      { id: "new", availability: "available" },
      { id: "cleaned", availability: "cleaned" },
    ]);
    expect(incoming[2]).toEqual({ id: "cleaned" });
    expect(previous[1].availability).toBe("unavailable");
  });
});

describe("decimal image capacity formatting", () => {
  it("round trips exact byte limits without floating point or 32-bit truncation", () => {
    for (const bytes of ["1", "2306867200", "5000000000", "9007199254740991"]) expect(storageGbToBytes(storageBytesToGb(bytes))).toBe(bytes);
    expect(formatStorageBytes("5000000000")).toBe("5.00 GB");
    expect(formatStorageBytes("2306867200")).toBe("2.30 GB");
    expect(() => storageGbToBytes("5e9")).toThrow();
    expect(formatStorageBytes("5000000000\n")).toBe("—");
  });
});
