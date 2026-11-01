import "server-only";

import { GenerationStatus, Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { CANVAS_LIMITS, CanvasContractError, type CanvasRunWireV1 } from "./contracts";
import { canvasAssetUrl } from "./storage";
import type { CanvasTransaction } from "./transactions";

type CanvasInputReader = Pick<CanvasTransaction, "canvasImportAsset" | "generationImage">;
export type CanvasResolvedRunInputs = { sourceImageUrls: string[]; importedAssetIds: string[]; knownImportedBytes: number };

export function isCanvasCanonicalDataUrl(url: string): boolean {
  return /^data:(?:image\/[a-z0-9.+-]+)?;base64,[A-Za-z0-9+/]+={0,2}$/.test(url);
}

function usableCanonicalImageUrl(raw: string): boolean {
  if (isCanvasCanonicalDataUrl(raw)) return true;
  try {
    const url = new URL(raw);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
  } catch { return false; }
}

export async function readCanvasRunInputs(ownerId: string, run: CanvasRunWireV1, reader: CanvasInputReader = db): Promise<CanvasResolvedRunInputs> {
  const importedAssetIds = run.input.references.flatMap((reference) => reference.kind === "imported" ? [reference.assetId] : []).sort();
  const imageIds = run.input.references.flatMap((reference) => reference.kind === "result" ? [reference.imageId] : []);
  const [assets, images] = await Promise.all([
    importedAssetIds.length ? reader.canvasImportAsset.findMany({
      where: { id: { in: importedAssetIds }, ownerId, userId: ownerId, kind: "IMPORT", state: "READY" },
    }) : [],
    imageIds.length ? reader.generationImage.findMany({
      where: { id: { in: imageIds }, job: { userId: ownerId, status: GenerationStatus.SUCCEEDED } },
      select: { id: true, jobId: true, url: true, job: { select: { id: true, userId: true, status: true } } },
    }) : [],
  ]);
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const imagesById = new Map(images.map((image) => [image.id, image]));
  let knownImportedBytes = 0;
  const sourceImageUrls = run.input.references.map((reference) => {
    if (reference.kind === "imported") {
      const asset = assetsById.get(reference.assetId);
      if (!asset || asset.ownerId !== ownerId || asset.userId !== ownerId || asset.kind !== "IMPORT" || asset.state !== "READY") throw new CanvasContractError("CANVAS_INPUT_UNAVAILABLE");
      const url = canvasAssetUrl(asset);
      if (!url) throw new CanvasContractError("CANVAS_INPUT_UNAVAILABLE");
      knownImportedBytes += asset.byteLength;
      return url;
    }
    const image = imagesById.get(reference.imageId);
    if (!image || image.jobId !== reference.jobId || image.job.id !== reference.jobId
      || image.job.userId !== ownerId || image.job.status !== GenerationStatus.SUCCEEDED || !usableCanonicalImageUrl(image.url)) throw new CanvasContractError("CANVAS_INPUT_UNAVAILABLE");
    return image.url;
  });
  // Generated/legacy images have no verified byte-length column. The worker
  // still enforces the aggregate decoded limit for every downloaded source.
  if (knownImportedBytes > CANVAS_LIMITS.decodedInputBytes) throw new CanvasContractError("CANVAS_LIMIT_EXCEEDED");
  return { sourceImageUrls, importedAssetIds, knownImportedBytes };
}

export async function lockCanvasRunInputs(tx: CanvasTransaction, ownerId: string, run: CanvasRunWireV1): Promise<void> {
  const assetIds = run.input.references.flatMap((reference) => reference.kind === "imported" ? [reference.assetId] : []).sort();
  if (assetIds.length) {
    await tx.$executeRaw`SELECT canvas_lock_assets(${ownerId}::text, ARRAY[${Prisma.join(assetIds)}]::text[])`;
  }
  const imageIds = run.input.references.flatMap((reference) => reference.kind === "result" ? [reference.imageId] : []).sort();
  if (imageIds.length) {
    // Keep canonical image/job ownership and availability stable through enqueue.
    await tx.$queryRaw`SELECT i.id FROM "GenerationImage" AS i JOIN "GenerationJob" AS j ON j.id = i."jobId"
      WHERE i.id IN (${Prisma.join(imageIds)}) AND j."userId" = ${ownerId}::text
      ORDER BY j.id, i.id FOR SHARE OF j, i`;
  }
}
