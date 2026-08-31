import { db } from "@/lib/db";
import { requireAdminRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/server/http";

export async function GET() {
  try {
    await requireAdminRecord();

    const grouped = await db.contentReview.groupBy({
      by: ["userId"],
      _count: { _all: true },
      _max: { createdAt: true },
      orderBy: { _count: { userId: "desc" } },
      take: 50,
    });

    const userIds = grouped.map((group) => group.userId);
    const users = userIds.length
      ? await db.user.findMany({
          where: { id: { in: userIds } },
          select: { bannedAt: true, email: true, id: true, nickname: true },
        })
      : [];
    const usersById = new Map(users.map((user) => [user.id, user]));

    // 已删除用户（外键级联已清记录）不会出现在这里
    const summary = grouped
      .filter((group) => usersById.has(group.userId))
      .map((group) => {
        const user = usersById.get(group.userId)!;
        return {
          banned: user.bannedAt !== null,
          count: group._count._all,
          email: user.email,
          lastTriggerAt: group._max.createdAt?.toISOString() ?? null,
          nickname: user.nickname,
          userId: group.userId,
        };
      });

    return jsonOk({ users: summary });
  } catch (error) {
    return jsonError(getErrorMessage(error), 403);
  }
}