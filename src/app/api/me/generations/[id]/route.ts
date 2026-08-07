import { GenerationStatus } from "@prisma/client";

import { db } from "@/lib/db";
import {
  failGenerationJobAndRefund,
  failStalePendingGenerationJobs,
} from "@/lib/generation/job-refund";
import { serializeGeneration } from "@/lib/prisma-mappers";
import { getCurrentUserRecord } from "@/lib/server/current-user";
import { jsonError, jsonOk } from "@/lib/server/http";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUserRecord();
  if (!user) {
    return jsonError("未登录", 401);
  }

  const { id } = await context.params;

  await failStalePendingGenerationJobs({ userId: user.id });

  const job = await db.generationJob.findFirst({
    where: { id, userId: user.id },
    include: {
      images: {
        orderBy: { createdAt: "asc" },
      },
      videos: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!job) {
    return jsonError("任务不存在", 404);
  }

  return jsonOk({
    generation: serializeGeneration(job),
  });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUserRecord();
  if (!user) {
    return jsonError("未登录", 401);
  }

  const { id } = await context.params;
  const job = await db.generationJob.findFirst({
    where: { id, userId: user.id },
    select: {
      contractVersion: true,
      handoffState: true,
      id: true,
      status: true,
    },
  });

  if (!job) {
    return jsonError("任务不存在", 404);
  }
  if (job.status === GenerationStatus.PROCESSING) {
    if (job.contractVersion < 1 || job.handoffState !== "NOT_STARTED") {
      return jsonError(
        "任务已经提交渠道或提交状态暂不确定，请继续查询结果",
        409,
        "GENERATION_ALREADY_SUBMITTED",
      );
    }

    const requested = await db.generationJob.updateMany({
      where: {
        contractVersion: { gte: 1 },
        handoffState: "NOT_STARTED",
        id,
        status: GenerationStatus.PROCESSING,
        userId: user.id,
      },
      data: { cancelRequestedAt: new Date() },
    });
    if (requested.count === 0) {
      return jsonError(
        "任务状态已变化，请继续查询结果",
        409,
        "GENERATION_ALREADY_SUBMITTED",
      );
    }

    const updated = await db.generationJob.findFirst({
      where: { id, userId: user.id },
      include: {
        images: { orderBy: { createdAt: "asc" } },
        videos: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!updated) {
      return jsonError("任务不存在", 404);
    }
    return jsonOk({
      cancellationRequested: true,
      generation: serializeGeneration(updated),
      refundedCredits: 0,
    });
  }
  if (job.status !== GenerationStatus.PENDING) {
    return jsonError("当前任务状态无法取消", 409);
  }

  const result = await failGenerationJobAndRefund({
    allowedStatuses: [GenerationStatus.PENDING],
    errorCode: "GENERATION_CANCELLED",
    errorMessage: "用户取消生成。",
    jobId: id,
  });

  if (!result.updated) {
    return jsonError("任务状态已变化，无法取消", 409);
  }

  const updated = await db.generationJob.findFirst({
    where: { id, userId: user.id },
    include: {
      images: {
        orderBy: { createdAt: "asc" },
      },
      videos: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!updated) {
    return jsonError("任务不存在", 404);
  }

  return jsonOk({
    generation: serializeGeneration(updated),
    refundedCredits: result.refundedCredits,
  });
}
