import "server-only";

import { randomUUID } from "node:crypto";

import { ImageStorageError, type ImageReservation } from "./image-contract";
import { IMAGE_QUOTA_WAIT_MS } from "./image-maintenance-types";
import type { ImageRepository } from "./image-repository";

type QuotaCleanupRepository = Pick<ImageRepository, "requestQuotaCleanup" | "getMaintenanceJob">;

/** Waits for the durable Worker job, outside every generation/Canvas transaction. */
export async function reserveImageWithCleanup(input: {
  repository: QuotaCleanupRepository;
  ownerId: string;
  intentKey: string;
  neededBytes: bigint;
  reserve: () => Promise<ImageReservation>;
}): Promise<ImageReservation> {
  let quotaError: ImageStorageError;
  try { return await input.reserve(); }
  catch (error) {
    if (!(error instanceof ImageStorageError) || error.code !== "IMAGE_QUOTA_EXCEEDED") throw error;
    quotaError = error;
  }

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => { controller.abort(); reject(quotaError); }, IMAGE_QUOTA_WAIT_MS);
  });
  const wait = async () => {
    let job = await input.repository.requestQuotaCleanup({ requestId: randomUUID(), ownerId: input.ownerId,
      intentKey: input.intentKey, neededBytes: input.neededBytes.toString() });
    while (job && ["QUEUED", "RUNNING", "WAITING"].includes(job.state)) {
      if (controller.signal.aborted) throw quotaError;
      await new Promise<void>((resolve) => {
        const done = () => { clearTimeout(timer); controller.signal.removeEventListener("abort", done); resolve(); };
        const timer = setTimeout(done, 250);
        controller.signal.addEventListener("abort", done, { once: true });
        if (controller.signal.aborted) done();
      });
      if (controller.signal.aborted) throw quotaError;
      job = await input.repository.getMaintenanceJob({ jobId: job.id });
    }
    if (controller.signal.aborted) throw quotaError;
  };
  try { await Promise.race([wait(), timedOut]); }
  finally { if (timeout !== undefined) clearTimeout(timeout); controller.abort(); }

  // A second reservation is the authority on current capacity. The cleanup
  // estimate/job result cannot promise bytes another writer may have claimed.
  return input.reserve();
}
