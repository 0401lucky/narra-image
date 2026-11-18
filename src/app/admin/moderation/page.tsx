import type { Prisma } from "@prisma/client";
import { ShieldAlert } from "lucide-react";
import { redirect } from "next/navigation";

import { AdminPagination } from "@/components/admin/admin-pagination";
import { ModerationReviewsBoard } from "@/components/admin/moderation-reviews-board";
import { ModerationNavTabs } from "@/components/admin/moderation/moderation-nav-tabs";
import { AdminPageHeader } from "@/components/admin/ui/admin-page-header";
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
  const search = typeof params.q === "string" ? params.q.trim() : "";

  const where: Prisma.ContentReviewWhereInput = {
    ...(kind ? { kind } : {}),
    ...(search
      ? {
          OR: [
            { prompt: { contains: search, mode: "insensitive" } },
            { negativePrompt: { contains: search, mode: "insensitive" } },
            { hitWords: { has: search } },
            {
              user: {
                is: {
                  OR: [
                    { email: { contains: search, mode: "insensitive" } },
                    { nickname: { contains: search, mode: "insensitive" } },
                  ],
                },
              },
            },
          ],
        }
      : {}),
  };

  const [reviewRows, totalCount, grouped] = await Promise.all([
    db.contentReview.findMany({
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
      where,
    }),
    db.contentReview.count({ where }),
    db.contentReview.groupBy({
      _count: { _all: true },
      _max: { createdAt: true },
      by: ["userId"],
      orderBy: { _count: { userId: "desc" } },
      take: 50,
    }),
  ]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const userIds = grouped.map((group) => group.userId);
  const users = userIds.length
    ? await db.user.findMany({
        select: { bannedAt: true, email: true, id: true, nickname: true },
        where: { id: { in: userIds } },
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

  const extraParams: Record<string, string> = {};
  if (kind) extraParams.kind = kind;
  if (search) extraParams.q = search;

  return (
    <main className="pb-16">
      <section className="mx-auto grid max-w-7xl gap-6 px-5 pt-7 md:px-8">
        <AdminPageHeader
          eyebrow="Moderation"
          icon={ShieldAlert}
          title="内容风控与拦截中心"
          description="集中查看敏感词与 AI 审核拒绝的生成请求（拦截不扣积分），支持对高频违规账号一键封禁，或切换配置拦截阈值。"
          badges={
            <span className="rounded-full border border-[var(--line)] bg-white px-3 py-1 font-mono text-xs font-medium text-[var(--ink-soft)]">
              当前结果 {totalCount.toLocaleString("zh-CN")} 条
            </span>
          }
        />

        <ModerationNavTabs
          activePath="/admin/moderation"
          totalReviewsCount={totalCount}
        />

        <ModerationReviewsBoard
          adminId={admin.id}
          initialSearch={search}
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
          extraParams={Object.keys(extraParams).length ? extraParams : undefined}
        />
      </section>
    </main>
  );
}
