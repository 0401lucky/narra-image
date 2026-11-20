import { db } from "@/lib/db";
import { imageAvailabilityInclude } from "@/lib/storage/image-availability";
import { failStalePendingGenerationJobs } from "@/lib/generation/job-refund";
import { serializeGenerationsForClient } from "@/lib/prisma-mappers";
import { getCurrentUserRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/server/http";
import {
  STUDIO_GENERATIONS_DEFAULT_LIMIT,
  StudioGenerationQueryError,
  listStudioGenerations,
} from "@/lib/server/studio-generations";

export async function GET(request?: Request) {
  const user = await getCurrentUserRecord();
  if (!user) {
    return jsonError("未登录", 401);
  }

  await failStalePendingGenerationJobs({ userId: user.id });

  const searchParams = request ? new URL(request.url).searchParams : null;
  if (searchParams?.get("scope") === "studio") {
    try {
      const cursor = searchParams.get("cursor");
      const limitRaw = searchParams.get("limit");
      const limit = limitRaw === null
        ? STUDIO_GENERATIONS_DEFAULT_LIMIT
        : Number(limitRaw);
      const page = await listStudioGenerations({
        ownerId: user.id,
        cursor: cursor || null,
        limit,
      });
      return jsonOk(page);
    } catch (error) {
      if (error instanceof StudioGenerationQueryError) {
        return jsonError(error.message, error.status);
      }
      return jsonError(getErrorMessage(error), 500);
    }
  }

  const jobs = await db.generationJob.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: {
      images: { include: imageAvailabilityInclude, orderBy: { createdAt: "asc" } },
      videos: {
        orderBy: { createdAt: "asc" },
      },
    },
    take: 24,
  });

  return jsonOk({
    generations: await serializeGenerationsForClient(jobs),
  });
}
