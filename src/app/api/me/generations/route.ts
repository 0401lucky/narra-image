import { db } from "@/lib/db";
import { failStalePendingGenerationJobs } from "@/lib/generation/job-refund";
import { serializeGeneration } from "@/lib/prisma-mappers";
import { getCurrentUserRecord } from "@/lib/server/current-user";
import { jsonError, jsonOk } from "@/lib/server/http";

export async function GET() {
  const user = await getCurrentUserRecord();
  if (!user) {
    return jsonError("未登录", 401);
  }

  await failStalePendingGenerationJobs({ userId: user.id });

  const jobs = await db.generationJob.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: {
      images: {
        orderBy: { createdAt: "asc" },
      },
    },
    take: 24,
  });

  return jsonOk({
    generations: jobs.map(serializeGeneration),
  });
}
