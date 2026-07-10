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
      id: true,
      status: true,
    },
  });

  if (!job) {
    return jsonError("任务不存在", 404);
  }
  if (job.status !== GenerationStatus.PENDING) {
    return jsonError(
      job.status === GenerationStatus.PROCESSING
        ? "任务已开始处理，无法取消"
        : "当前任务状态无法取消",
      409,
    );
  }

  const result = await failGenerationJobAndRefund({
    allowedStatuses: [GenerationStatus.PENDING],
    errorMessage: "用户取消生成，已退还预扣积分。",
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
