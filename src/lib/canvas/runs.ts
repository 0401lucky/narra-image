import "server-only";

import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { getGenerationErrorDefinition, isGenerationErrorCode } from "@/lib/generation/contracts";
import { serializeGeneration, type SerializedGeneration } from "@/lib/prisma-mappers";
import { CanvasContractError, isCanvasErrorCode, type CanvasRunLookupDtoV1 } from "./contracts";

export const canvasRunLookupSelect = {
  ownerId: true,
  userId: true,
  canvasId: true,
  nodeId: true,
  runId: true,
  state: true,
  originalJobId: true,
  liveJobId: true,
  rejectionCode: true,
} satisfies Prisma.CanvasRunSelect;

export const canvasGenerationInclude = {
  images: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
  videos: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
} satisfies Prisma.GenerationJobInclude;

export type CanvasRunLookupRecord = Prisma.CanvasRunGetPayload<{ select: typeof canvasRunLookupSelect }>;
export type CanvasGenerationRecord = Prisma.GenerationJobGetPayload<{ include: typeof canvasGenerationInclude }>;

const RUN_LOOKUP_RETRY_AFTER_MS = 1_000;

export function serializeCanvasGeneration(job: CanvasGenerationRecord): SerializedGeneration {
  const generation = serializeGeneration(job);
  // Stored upstream/adapter errors are not public messages, even for an owned job.
  const errorCode = job.errorCode && isGenerationErrorCode(job.errorCode) ? job.errorCode : null;
  return {
    ...generation,
    errorCode,
    errorMessage: errorCode
      ? getGenerationErrorDefinition(errorCode).userMessage
      : job.errorMessage
        ? "\u751f\u6210\u5931\u8d25\uff0c\u8bf7\u4fdd\u7559\u4efb\u52a1\u7f16\u53f7\u5e76\u7a0d\u540e\u67e5\u8be2"
        : null,
  };
}

export function serializeCanvasRunLookup(run: CanvasRunLookupRecord, job: CanvasGenerationRecord | null = null): CanvasRunLookupDtoV1 {
  const origin = { canvasId: run.canvasId, nodeId: run.nodeId, runId: run.runId };
  switch (run.state) {
    case "PREPARING":
      return { state: run.state, origin, retryAfterMs: RUN_LOOKUP_RETRY_AFTER_MS };
    case "REJECTED":
      return { state: run.state, origin, code: isCanvasErrorCode(run.rejectionCode) ? run.rejectionCode : "CANVAS_RUN_REJECTED" };
    case "COMMITTED": {
      if (!run.originalJobId) throw new CanvasContractError("CANVAS_INTERNAL_ERROR");
      const generation = job && run.liveJobId === run.originalJobId && job.id === run.originalJobId
        && job.userId === run.ownerId && run.userId === run.ownerId
        ? serializeCanvasGeneration(job)
        : null;
      return {
        state: run.state,
        origin,
        jobId: run.originalJobId,
        generation,
        unavailable: generation ? null : "CANVAS_JOB_UNAVAILABLE",
      };
    }
  }
}

// This lookup also serves committed submission replay. Never consult the live
// canvas or the generation GET handler, whose stale-job cleanup can refund.
export async function getCanvasRun(ownerId: string, runId: string): Promise<CanvasRunLookupDtoV1> {
  const run = await db.canvasRun.findUnique({
    where: { ownerId_runId: { ownerId, runId }, userId: ownerId },
    select: canvasRunLookupSelect,
  });
  if (!run || run.ownerId !== ownerId || run.userId !== ownerId) throw new CanvasContractError("CANVAS_RUN_NOT_FOUND");
  const job = run.state === "COMMITTED" && run.originalJobId && run.liveJobId === run.originalJobId
    ? await db.generationJob.findFirst({
      where: { id: run.originalJobId, userId: ownerId },
      include: canvasGenerationInclude,
    })
    : null;
  return serializeCanvasRunLookup(run, job);
}
