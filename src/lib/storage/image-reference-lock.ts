import "server-only";

import type { Prisma } from "@prisma/client";

/** Acquire before business row locks, including when managed writes are disabled. */
export async function lockImageReferenceEpoch(tx: Pick<Prisma.TransactionClient, "$executeRaw">): Promise<void> {
  // The gate also protects inputs whose exact URL has not been adopted yet.
  // Execute the void function without asking the pg adapter to decode a row.
  await tx.$executeRaw`SELECT image_lock_reference_epoch()`;
}
