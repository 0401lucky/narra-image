import { ShowcaseStatus } from "@prisma/client";

import { db } from "@/lib/db";
import { getCurrentUserRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/server/http";

export async function PUT(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getCurrentUserRecord();
    if (!user) {
      return jsonError("请先登录", 401);
    }

    const { id } = await context.params;

    const work = await db.generationImage.findUnique({
      where: { id },
      select: {
        id: true,
        showcaseStatus: true,
      },
    });

    if (!work || work.showcaseStatus !== ShowcaseStatus.FEATURED) {
      return jsonError("作品未公开，暂不能点赞", 404);
    }

    const result = await db.$transaction(async (tx) => {
      const existing = await tx.workLike.findUnique({
        where: {
          workId_userId: {
            userId: user.id,
            workId: id,
          },
        },
      });

      const liked = !existing;

      if (existing) {
        await tx.workLike.delete({
          where: {
            workId_userId: {
              userId: user.id,
              workId: id,
            },
          },
        });
      } else {
        await tx.workLike.create({
          data: {
            userId: user.id,
            workId: id,
          },
        });
      }

      const likeCount = await tx.workLike.count({
        where: {
          workId: id,
        },
      });

      return {
        likeCount,
        liked,
      };
    });

    return jsonOk(result);
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
