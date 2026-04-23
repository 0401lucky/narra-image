import { notFound } from "next/navigation";

import { SiteHeader } from "@/components/marketing/site-header";
import { WorkDetailPanel } from "@/components/works/work-detail-panel";
import { serializeUser } from "@/lib/prisma-mappers";
import { getEnv } from "@/lib/env";
import { getCurrentUserRecord } from "@/lib/server/current-user";
import { getWorkById } from "@/lib/server/works";
import { canViewWorkDetail } from "@/lib/work-showcase";

export const dynamic = "force-dynamic";

export default async function WorkDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [user, work] = await Promise.all([getCurrentUserRecord(), getWorkById(id)]);

  if (!work) {
    notFound();
  }

  const isOwner = user?.id === work.ownerId;
  if (!canViewWorkDetail({ isOwner, showcaseStatus: work.showcaseStatus })) {
    notFound();
  }

  const detailUrl = new URL(`/works/${work.id}`, getEnv().APP_URL).toString();

  return (
    <main className="pb-20">
      <SiteHeader currentUser={user ? serializeUser(user) : null} />

      <section className="mx-auto grid max-w-7xl gap-6 px-5 pb-12 pt-8 md:px-8">
        <div>
          <p className="text-sm text-[var(--ink-soft)]">
            {isOwner
              ? "作品详情同时承担你的公开状态管理页。"
              : "公开页面统一以匿名创作者展示，不显示用户邮箱。"}
          </p>
        </div>

        <WorkDetailPanel detailUrl={detailUrl} isOwner={isOwner} work={work} />
      </section>
    </main>
  );
}
