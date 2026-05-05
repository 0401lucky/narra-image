import "server-only";

import { GenerationStatus } from "@prisma/client";

import { db } from "@/lib/db";

const STALE_PENDING_JOB_AGE_MS = 30 * 60 * 1000;
const STALE_PENDING_MESSAGE = "生成任务超时未完成，已自动退还预扣积分。";

type FailGenerationJobInput = {
  errorMessage: string;
  jobId: string;
};

type CleanupStalePendingJobsInput = {
  now?: Date;
  olderThanMs?: number;
  userId?: string;
};

export async function failGenerationJobAndRefund({
  errorMessage,
  jobId,
}: FailGenerationJobInput) {
  return db.$transaction(async (tx) => {
    const job = await tx.generationJob.findUnique({
      where: { id: jobId },
      select: {
        creditsSpent: true,
        id: true,
        status: true,
        userId: true,
      },
    });

    if (!job || job.status === GenerationStatus.SUCCEEDED) {
      return {
        refundedCredits: 0,
        updated: false,
      };
    }

    const refundedCredits = Math.max(0, job.creditsSpent);
    const updated = await tx.generationJob.updateMany({
      where: {
        creditsSpent: job.creditsSpent,
        id: job.id,
        status: {
          not: GenerationStatus.SUCCEEDED,
        },
      },
      data: {
        creditsSpent: 0,
        errorMessage,
        status: GenerationStatus.FAILED,
      },
    });

    if (updated.count === 0) {
      return {
        refundedCredits: 0,
        updated: false,
      };
    }

    if (refundedCredits > 0) {
      await tx.user.update({
        where: { id: job.userId },
        data: {
          credits: {
            increment: refundedCredits,
          },
        },
      });
    }

    return {
      refundedCredits,
      updated: true,
    };
  });
}

export async function failStalePendingGenerationJobs({
  now = new Date(),
  olderThanMs = STALE_PENDING_JOB_AGE_MS,
  userId,
}: CleanupStalePendingJobsInput = {}) {
  const cutoff = new Date(now.getTime() - olderThanMs);
  const staleJobs = await db.generationJob.findMany({
    where: {
      createdAt: {
        lt: cutoff,
      },
      status: GenerationStatus.PENDING,
      ...(userId ? { userId } : {}),
    },
    select: {
      id: true,
    },
    orderBy: {
      createdAt: "asc",
    },
    take: 50,
  });

  const results = await Promise.all(
    staleJobs.map((job) =>
      failGenerationJobAndRefund({
        errorMessage: STALE_PENDING_MESSAGE,
        jobId: job.id,
      }),
    ),
  );

  return {
    checked: staleJobs.length,
    failed: results.filter((result) => result.updated).length,
    refundedCredits: results.reduce(
      (total, result) => total + result.refundedCredits,
      0,
    ),
  };
}
