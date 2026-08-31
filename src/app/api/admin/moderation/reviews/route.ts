import { db } from "@/lib/db";
import { requireAdminRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/server/http";

const PAGE_SIZE = 20;

export async function GET(request: Request) {
  try {
    await requireAdminRecord();

    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const kind = url.searchParams.get("kind")?.trim() || "";

    const where = kind ? { kind } : {};

    const [reviews, totalCount] = await Promise.all([
      db.contentReview.findMany({
        where,
        orderBy: { createdAt: "desc" },
        select: {
          aiModel: true,
          aiScore: true,
          category: true,
          createdAt: true,
          hitWords: true,
          id: true,
          kind: true,
          negativePrompt: true,
          prompt: true,
          user: {
            select: { bannedAt: true, email: true, id: true, nickname: true },
          },
        },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      db.contentReview.count({ where }),
    ]);

    return jsonOk({
      page,
      pageSize: PAGE_SIZE,
      totalCount,
      totalPages: Math.ceil(totalCount / PAGE_SIZE),
      reviews: reviews.map((review) => ({
        aiModel: review.aiModel,
        aiScore: review.aiScore,
        category: review.category,
        createdAt: review.createdAt.toISOString(),
        hitWords: review.hitWords,
        id: review.id,
        kind: review.kind,
        negativePrompt: review.negativePrompt,
        prompt: review.prompt,
        user: {
          banned: review.user.bannedAt !== null,
          email: review.user.email,
          id: review.user.id,
          nickname: review.user.nickname,
        },
      })),
    });
  } catch (error) {
    return jsonError(getErrorMessage(error), 403);
  }
}