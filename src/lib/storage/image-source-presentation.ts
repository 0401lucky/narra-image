import "server-only";

import type { Prisma } from "@prisma/client";
import { presentGenerationImage } from "./image-presentation";

type GenerationSources = { sourceImageUrls?: readonly string[]; sourceImageUrl?: string | null };
export type ImageSourceUrlReader = Pick<Prisma.TransactionClient, "imageUrlAlias">;

function sourceUrls(generation: GenerationSources): readonly string[] {
  return generation.sourceImageUrls ?? (generation.sourceImageUrl ? [generation.sourceImageUrl] : []);
}

/** Batch presentation only: immutable job inputs in the database are untouched.
 * Unregistered URLs keep their legacy value; known unavailable sources are not
 * offered as browser thumbnails or reusable inputs. */
export async function projectGenerationSourceUrls<T extends GenerationSources>(generations: readonly T[], reader?: ImageSourceUrlReader): Promise<T[]> {
  const urls = [...new Set(generations.flatMap((generation) => [...sourceUrls(generation)]))]
    .filter((url) => /^https?:\/\//.test(url) && url.length <= 2048);
  if (!urls.length) return [...generations];
  const database = reader ?? (await import("@/lib/db")).db;
  const aliases = await database.imageUrlAlias.findMany({
    where: { url: { in: urls } },
    select: { url: true, asset: { select: { id: true, state: true, activeObjectId: true, publicToken: true } } },
  });
  const projected = new Map(aliases.map((alias) => [alias.url, presentGenerationImage({
    url: alias.url, mediaAssetId: alias.asset.id, mediaAsset: alias.asset,
  }).url]));
  return generations.map((generation) => {
    const original = sourceUrls(generation);
    const readable = original.map((url) => projected.get(url) ?? url).filter((url) => url !== "");
    if (original.length === readable.length && original.every((url, index) => url === readable[index])) return generation;
    return { ...generation, sourceImageUrls: readable,
      ...("sourceImageUrl" in generation ? { sourceImageUrl: readable[0] ?? null } : {}) };
  });
}
