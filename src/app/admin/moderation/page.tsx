import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";

import { AdminPagination } from "@/components/admin/admin-pagination";
import { ModerationReviewsBoard } from "@/components/admin/moderation-reviews-board";
import { db } from "@/lib/db";
import { requireAdminRecord } from "@/lib/server/current-user";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

export default async function AdminModerationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  let admin;
  try {
    admin = await requireAdminRecord();
  } catch {
    redirect("/login");
  }

  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const kind =
    typeof params.kind === "string" &&
    (params.kind === "sensitive_word" || params.kind === "ai_moderation")
      ? params.kind
      : "";
  const where = kind ? { kind } : {};

  const [reviewRows, totalCount, grouped] = await Promise.all([
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
    db.contentReview.groupBy({
      by: ["userId"],
      _count: { _all: true },
      _max: { createdAt: true },
      orderBy: { _count: { userId: "desc" } },
      take: 50,
    }),
  ]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const userIds = grouped.map((group) => group.userId);
  const users = userIds.length
    ? await db.user.findMany({
        where: { id: { in: userIds } },
        select: { bannedAt: true, email: true, id: true, nickname: true },
      })
    : [];
  const usersById = new Map(users.map((user) => [user.id, user]));

  const offenders = grouped
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

  return (
    <main className="pb-16">
      <section className="mx-auto grid max-w-7xl gap-6 px-5 pt-8 md:px-8">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="admin-eyebrow">Moderation</p>
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--ink)] md:text-4xl">
              内容审核
            </h1>
            <p className="mt-2 text-sm text-[var(--ink-soft)]">
              敏感词 / AI 审核触发的生成拦截记录。命中即拒绝生成，可在下方对高频触发用户封禁。
            </p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--ink-soft)]">
            <ShieldAlert className="size-3.5 text-[var(--accent)]" />
            共 {totalCount} 条触发记录
          </span>
        </div>

        <ModerationReviewsBoard
          adminId={admin.id}
          kind={kind}
          offenders={offenders}
          reviews={reviewRows.map((review) => ({
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
          }))}
        />

        <AdminPagination
          basePath="/admin/moderation"
          currentPage={page}
          totalPages={totalPages}
          extraParams={kind ? { kind } : undefined}
        />
      </section>
    </main>
  );
}