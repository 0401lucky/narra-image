import "server-only";

import { GenerationStatus, type Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import {
  type GenerationErrorCode,
  isGenerationRefundAllowed,
} from "@/lib/generation/contracts";

const STALE_PENDING_JOB_AGE_MS = 30 * 60 * 1000;
const STALE_PENDING_MESSAGE = "生成任务超时未完成。";

type FailGenerationJobInput = {
  allowedStatuses?: GenerationStatus[];
  createdBefore?: Date;
  errorCode?: GenerationErrorCode;
  errorMessage: string;
  jobId: string;
  lockedBefore?: Date;
  onlyUnclaimedV1Pending?: boolean;
};

type GenerationRefundTransaction = Pick<
  Prisma.TransactionClient,
  "generationJob" | "user"
>;

type CleanupStalePendingJobsInput = {
  now?: Date;
  olderThanMs?: number;
  userId?: string;
};

export async function failGenerationJobAndRefund({
  ...input
}: FailGenerationJobInput) {
  return db.$transaction((tx) =>
    failGenerationJobAndRefundInTransaction(tx, input),
  );
}

export async function failGenerationJobAndRefundInTransaction(
  tx: GenerationRefundTransaction,
  {
  allowedStatuses,
  createdBefore,
  errorCode,
  errorMessage,
  jobId,
  lockedBefore,
  onlyUnclaimedV1Pending,
}: FailGenerationJobInput,
) {
  const job = await tx.generationJob.findUnique({
    where: { id: jobId },
    select: {
      attemptCount: true,
      contractVersion: true,
      creditsSpent: true,
      handoffState: true,
      id: true,
      nextAttemptAt: true,
      refundAppliedAt: true,
      status: true,
      userId: true,
    },
  });

  const statuses = allowedStatuses ?? [
    GenerationStatus.PENDING,
    GenerationStatus.PROCESSING,
    GenerationStatus.FAILED,
  ];

  if (!job || !statuses.includes(job.status)) {
    return {
      refundedCredits: 0,
      updated: false,
    };
  }

  const contractVersion =
    typeof job.contractVersion === "number" ? job.contractVersion : 0;
  if (
    !isGenerationRefundAllowed({
      contractVersion,
      handoffState: job.handoffState,
    })
  ) {
    return {
      blockedByHandoff: true,
      refundedCredits: 0,
      updated: false,
    };
  }
  if (job.refundAppliedAt) {
    return {
      refundedCredits: 0,
      updated: false,
    };
  }

  const requiresUnclaimedV1Pending =
    Boolean(onlyUnclaimedV1Pending) && contractVersion >= 1;
  if (
    requiresUnclaimedV1Pending &&
    (job.status !== GenerationStatus.PENDING ||
      job.attemptCount !== 0 ||
      job.nextAttemptAt !== null ||
      job.handoffState !== "NOT_STARTED")
  ) {
    return {
      blockedByWorkerState: true,
      refundedCredits: 0,
      updated: false,
    };
  }

  // 已经失败且没有待退积分时，重复清理不应刷新终态或审计时间。
  if (job.status === GenerationStatus.FAILED && job.creditsSpent <= 0) {
    return {
      refundedCredits: 0,
      updated: false,
    };
  }

  const refundedCredits = Math.max(0, job.creditsSpent);
  const now = new Date();
  const updated = await tx.generationJob.updateMany({
    where: {
      contractVersion,
      creditsSpent: job.creditsSpent,
      ...(createdBefore ? { createdAt: { lt: createdBefore } } : {}),
      id: job.id,
      ...(contractVersion >= 1 ? { handoffState: job.handoffState } : {}),
      ...(lockedBefore ? { lockedAt: { lt: lockedBefore } } : {}),
      ...(requiresUnclaimedV1Pending
        ? {
            attemptCount: 0,
            nextAttemptAt: null,
          }
        : {}),
      ...(refundedCredits > 0 ? { refundAppliedAt: null } : {}),
      status: {
        in: statuses,
      },
    },
    data: {
      completedAt: now,
      creditsSpent: 0,
      ...(errorCode ? { errorCode } : {}),
      errorMessage,
      ...(contractVersion >= 1 ? { handoffState: "RESOLVED" as const } : {}),
      lockedAt: null,
      nextAttemptAt: null,
      status: GenerationStatus.FAILED,
      workerId: null,
      ...(refundedCredits > 0 ? { refundAppliedAt: now } : {}),
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
}

export async function failStalePendingGenerationJobs({
  now = new Date(),
  olderThanMs = STALE_PENDING_JOB_AGE_MS,
  userId,
}: CleanupStalePendingJobsInput = {}) {
  const cutoff = new Date(now.getTime() - olderThanMs);
  const staleJobs = await db.generationJob.findMany({
    where: {
      OR: [
        {
          contractVersion: { lt: 1 },
          createdAt: {
            lt: cutoff,
          },
          status: GenerationStatus.PENDING,
        },
        {
          contractVersion: { lt: 1 },
          lockedAt: {
            lt: cutoff,
          },
          status: GenerationStatus.PROCESSING,
        },
        {
          attemptCount: 0,
          contractVersion: { gte: 1 },
          createdAt: {
            lt: cutoff,
          },
          handoffState: "NOT_STARTED",
          nextAttemptAt: null,
          status: GenerationStatus.PENDING,
        },
      ],
      ...(userId ? { userId } : {}),
    },
    select: {
      id: true,
      status: true,
    },
    orderBy: {
      createdAt: "asc",
    },
    take: 50,
  });

  const results = await Promise.all(
    staleJobs.map((job) =>
      failGenerationJobAndRefund({
        allowedStatuses: [job.status],
        ...(job.status === GenerationStatus.PENDING
          ? { createdBefore: cutoff }
          : { lockedBefore: cutoff }),
        errorCode: "MAX_ATTEMPTS_EXHAUSTED",
        errorMessage: STALE_PENDING_MESSAGE,
        jobId: job.id,
        onlyUnclaimedV1Pending: job.status === GenerationStatus.PENDING,
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
