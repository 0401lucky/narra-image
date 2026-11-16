// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ aliases: vi.fn() }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ APP_URL: "https://app.unit.invalid" }) }));
vi.mock("@/lib/db", () => ({ db: { imageUrlAlias: { findMany: mocks.aliases } } }));

import { serializeAdminWork, serializeFeaturedWork, serializeGeneration, serializePublicWorkDetail, serializeWork } from "@/lib/prisma-mappers";
import { presentGenerationImage } from "@/lib/storage/image-presentation";
import { projectGenerationSourceUrls } from "@/lib/storage/image-source-presentation";
import { canvasRunSchema, featuredWorkResponseSchema } from "@/lib/validators";
import { canvasResultNodeId } from "@/lib/canvas/contracts";
import { readCanvasRunInputs } from "@/lib/canvas/inputs";
import { createPrivacyWork, publicWorkDetailKeys } from "./helpers/work-privacy-fixtures";

const oldUrl = "https://old-r2.unit.invalid/original.png";
const token = "a".repeat(64);
const publicUrl = `https://app.unit.invalid/media/images/${token}`;
const media = (activeObjectId = "original-s3-object", state = "AVAILABLE") => ({ state, activeObjectId, publicToken: token });

beforeEach(() => { mocks.aliases.mockReset().mockResolvedValue([]); });
afterEach(() => { vi.restoreAllMocks(); });

describe("managed image browser projection", () => {
  it("keeps one public URL before and after a replica switch without rewriting provenance or exposing inventory", () => {
    for (const activeObjectId of ["original-s3-object", "verified-local-object"]) {
      const work = createPrivacyWork({ url: oldUrl, mediaAssetId: "logical-image", mediaAsset: media(activeObjectId) });
      Object.freeze(work);
      const owner = serializeWork(work);
      expect(owner).toMatchObject({ url: publicUrl, availability: "available", id: work.id, prompt: work.job.prompt });
      expect(serializeAdminWork(work).url).toBe(publicUrl);
      const featured = serializeFeaturedWork(work);
      expect(featured.image).toBe(publicUrl);
      expect(featuredWorkResponseSchema.safeParse(featured).success).toBe(true);
      const publicWork = serializePublicWorkDetail(owner);
      expect(publicWork.url).toBe(publicUrl);
      expect(Object.keys(publicWork).sort()).toEqual(publicWorkDetailKeys);
      for (const view of [owner, publicWork, featured]) {
        expect(view).not.toHaveProperty("publicToken");
        expect(view).not.toHaveProperty("mediaAsset");
        expect(view).not.toHaveProperty("activeObjectId");
        expect(JSON.stringify(view)).not.toContain(oldUrl);
      }
      expect(work.url).toBe(oldUrl);
      expect(work.mediaStorage).toBe("S3");
      expect(work.storageKey).toBe("private-storage-key-sentinel");
    }
  });

  it.each(["DELETED", "DELETING", "QUARANTINED", "PENDING"])("does not send the retired source URL for %s media", (state) => {
    const work = createPrivacyWork({ url: oldUrl, mediaAssetId: "logical-image", mediaAsset: media("object", state) });
    const expected = state === "DELETED" ? "cleaned" : "unavailable";
    const owner = serializeWork(work);
    const featured = serializeFeaturedWork(work);
    expect(owner).toMatchObject({ availability: expected, url: "", generationStatus: "succeeded" });
    expect(featured).toMatchObject({ availability: expected, image: "" });
    expect(featuredWorkResponseSchema.safeParse(featured).success).toBe(true);
    expect(serializePublicWorkDetail({ ...owner, url: oldUrl }).url).toBe("");
  });

  it("rejects an incomplete managed projection while keeping unregistered images unchanged", () => {
    expect(presentGenerationImage({ url: oldUrl, mediaAssetId: "asset", mediaAsset: { state: "AVAILABLE", activeObjectId: "object" } })).toEqual({ availability: "unavailable", url: "" });
    expect(presentGenerationImage({ url: oldUrl, mediaAssetId: "asset", mediaAsset: { ...media(), publicToken: "not-a-token" } })).toEqual({ availability: "unavailable", url: "" });
    expect(presentGenerationImage({ url: oldUrl, mediaAssetId: null })).toEqual({ availability: "available", url: oldUrl });
    const featured = serializeFeaturedWork(createPrivacyWork());
    expect(featuredWorkResponseSchema.safeParse({ ...featured, image: "" }).success).toBe(false);
  });

  it("generation output projection retains its original task and immutable source values", () => {
    const work = createPrivacyWork({ url: oldUrl, mediaAssetId: "logical-image", mediaAsset: media("verified-local-object") });
    const sources = Object.freeze([oldUrl]);
    const job = { ...work.job, images: [work], sourceImageUrls: sources, count: 1, creditsSpent: 5,
      providerMode: "BUILT_IN", generationType: "IMAGE_TO_IMAGE", updatedAt: work.createdAt, errorMessage: null,
      featuredAt: null, completedAt: work.createdAt } as unknown as Parameters<typeof serializeGeneration>[0];
    const serialized = serializeGeneration(job);
    expect(serialized.images[0]).toMatchObject({ id: work.id, availability: "available", url: publicUrl });
    expect(serialized).toMatchObject({ status: "succeeded", prompt: job.prompt, creditsSpent: 5, sourceImageUrls: [oldUrl] });
    expect(job.sourceImageUrls).toBe(sources);
    expect(work.url).toBe(oldUrl);
  });
  it("captures a result as a stable new Canvas input without rewriting the original result", async () => {
    const run = canvasRunSchema.parse({
      canvasId: "11111111-1111-4111-8111-111111111111", nodeId: "22222222-2222-4222-8222-222222222222", runId: "33333333-3333-4333-8333-333333333333",
      input: { prompt: { sourceNodeId: "44444444-4444-4444-8444-444444444444", text: "new intent" }, references: [
        { sourceNodeId: canvasResultNodeId("original-image"), ordinal: 1, kind: "result", jobId: "original-job", imageId: "original-image" },
      ] },
      parameters: { model: "gpt-image-2", generationType: "image_to_image", count: 1, size: "auto" },
    });
    const findMany = vi.fn();
    const reader = { generationImage: { findMany }, canvasImportAsset: { findMany: vi.fn() } } as unknown as Parameters<typeof readCanvasRunInputs>[2];
    for (const activeObjectId of ["old-source", "current-local"]) {
      const original = Object.freeze({ id: "original-image", jobId: "original-job", url: oldUrl, mediaAssetId: "asset", mediaAsset: media(activeObjectId),
        job: { id: "original-job", userId: "owner", status: "SUCCEEDED" } });
      findMany.mockResolvedValue([original]);
      expect(await readCanvasRunInputs("owner", run, reader)).toEqual({ sourceImageUrls: [publicUrl], importedAssetIds: [], knownImportedBytes: 0 });
      expect(original.url).toBe(oldUrl);
    }
  });
});

describe("batched immutable input URL presentation", () => {
  it("maps exact aliases for the whole page, preserving order, duplicate inputs and the stored snapshots", async () => {
    const external = "https://third-party.unit.invalid/input.png";
    const signedVariant = `${oldUrl}?different-signature=1`;
    const cleaned = "https://old-r2.unit.invalid/cleaned.png";
    const rows = Object.freeze([
      Object.freeze({ id: "one", sourceImageUrl: oldUrl, sourceImageUrls: Object.freeze([oldUrl, external, oldUrl]) }),
      Object.freeze({ id: "two", sourceImageUrl: signedVariant, sourceImageUrls: Object.freeze([signedVariant, cleaned]) }),
    ]);
    mocks.aliases.mockResolvedValue([
      { url: oldUrl, asset: { id: "logical-image", ...media("verified-local-object") } },
      { url: cleaned, asset: { id: "cleaned-image", ...media("old-object", "DELETED") } },
    ]);
    const result = await projectGenerationSourceUrls(rows);
    expect(result).toEqual([
      { id: "one", sourceImageUrl: publicUrl, sourceImageUrls: [publicUrl, external, publicUrl] },
      { id: "two", sourceImageUrl: signedVariant, sourceImageUrls: [signedVariant] },
    ]);
    expect(rows[0].sourceImageUrls).toEqual([oldUrl, external, oldUrl]);
    expect(rows[1].sourceImageUrls).toEqual([signedVariant, cleaned]);
    expect(mocks.aliases).toHaveBeenCalledOnce();
    expect(mocks.aliases).toHaveBeenCalledWith(expect.objectContaining({ where: { url: { in: [oldUrl, external, signedVariant, cleaned] } } }));
  });

  it("keeps empty and data-URL-only sources free of database reads, and propagates an unknown lookup failure", async () => {
    const rows = [{ id: "empty", sourceImageUrls: [] }, { id: "data", sourceImageUrls: ["data:image/png;base64,AA=="] }];
    expect(await projectGenerationSourceUrls(rows)).toEqual(rows);
    expect(mocks.aliases).not.toHaveBeenCalled();
    mocks.aliases.mockRejectedValue(new Error("fixture lookup failure"));
    await expect(projectGenerationSourceUrls([{ sourceImageUrls: [oldUrl] }])).rejects.toThrow("fixture lookup failure");
  });
});
