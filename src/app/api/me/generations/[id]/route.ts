import { db } from "@/lib/db";
import { failStalePendingGenerationJobs } from "@/lib/generation/job-refund";
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
    },
  });

  if (!job) {
    return jsonError("任务不存在", 404);
  }

  return jsonOk({
    generation: serializeGeneration(job),
  });
}
