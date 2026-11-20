import { GenerationStatus } from "@prisma/client";

import { db } from "@/lib/db";
import { getCurrentUserRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/server/http";
import { studioHideGenerationsSchema } from "@/lib/validators";

// 创作台记录隐藏：仅标记 studioHiddenAt，不删除 GenerationJob / GenerationImage，
// 以保留「作品」页图片、精选展示与后台账单审计。进行中的任务跳过隐藏。
export async function POST(request: Request) {
  try {
    const user = await getCurrentUserRecord();
    if (!user) {
      return jsonError("未登录", 401);
    }

    const payload = await request.json().catch(() => null);
    const parsed = studioHideGenerationsSchema.safeParse(payload);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "请求参数无效", 400);
    }

    const uniqueIds = [...new Set(parsed.data.ids)];
    const ownedJobs = await db.generationJob.findMany({
      where: {
        id: { in: uniqueIds },
        userId: user.id,
        studioHiddenAt: null,
      },
      select: {
        id: true,
        status: true,
      },
    });

    const terminalIds: string[] = [];
    const skippedPendingIds: string[] = [];
    for (const job of ownedJobs) {
      if (job.status === GenerationStatus.SUCCEEDED || job.status === GenerationStatus.FAILED) {
        terminalIds.push(job.id);
      } else {
        skippedPendingIds.push(job.id);
      }
    }

    if (terminalIds.length > 0) {
      await db.generationJob.updateMany({
        where: {
          id: { in: terminalIds },
          userId: user.id,
          status: { in: [GenerationStatus.SUCCEEDED, GenerationStatus.FAILED] },
          studioHiddenAt: null,
        },
        data: {
          studioHiddenAt: new Date(),
        },
      });
    }

    return jsonOk({
      hiddenIds: terminalIds,
      skippedPendingIds,
    });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
