import "server-only";

import type { Prisma } from "@prisma/client";

import { getEnv } from "@/lib/env";
import { ImageStorageError } from "./image-contract";
import { managedImagePublicToken } from "./image-optimizer";
import { lockImageReferenceEpoch } from "./image-reference-lock";
import { ImageRepository } from "./image-repository";

type ImageInputTransaction = Pick<Prisma.TransactionClient, "$executeRaw" | "$queryRaw">;

/** Bind the exact accepted spelling before the input/cover transaction commits.
 * Token readers normalize the host and default port, while retained URL roots
 * use exact aliases. The epoch keeps lookup, alias and business roots atomic.
 * Callers must acquire it before any earlier business row locks in this tx. */
export async function bindManagedImageInputAliases(
  tx: ImageInputTransaction, urls: readonly string[], appUrl?: string,
): Promise<void> {
  if (!urls.length) return;
  const publicationBase = appUrl ?? getEnv().APP_URL;
  const sources = [...new Set(urls)].flatMap((url) => {
    const token = managedImagePublicToken(url, publicationBase);
    return token ? [{ url, token }] : [];
  });
  if (!sources.length) return;

  await lockImageReferenceEpoch(tx);
  const repository = new ImageRepository(tx);
  const assetIds = new Map<string, string>();
  for (const token of [...new Set(sources.map((source) => source.token))].sort()) {
    const image = await repository.getByToken(token);
    if (!image || image.asset.state !== "AVAILABLE" || image.object?.state !== "READY"
      || image.asset.activeObjectId !== image.object.id) throw new ImageStorageError("IMAGE_UNAVAILABLE");
    assetIds.set(token, image.asset.id);
  }
  const aliases = sources.map(({ url, token }) => ({ url, assetId: assetIds.get(token)! }))
    .sort((left, right) => left.assetId.localeCompare(right.assetId) || left.url.localeCompare(right.url));
  for (const alias of aliases) await repository.registerAlias(alias);
}
