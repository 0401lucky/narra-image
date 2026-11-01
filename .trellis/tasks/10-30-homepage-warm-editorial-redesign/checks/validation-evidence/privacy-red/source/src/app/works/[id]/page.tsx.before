import { notFound } from "next/navigation";

import { db } from "@/lib/db";
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
    const video = await db.generatedVideo.findUnique({
      where: { id },
      include: { job: { select: { prompt: true, userId: true } } },
    });
    const isVideoOwner = user?.id === video?.job.userId;
    if (!video || !canViewWorkDetail({ isOwner: isVideoOwner, showcaseStatus: video.showcaseStatus })) {
      notFound();
    }
    return (
      <main className="pb-20">
        <SiteHeader currentUser={user ? serializeUser(user) : null} />
        <section className="mx-auto grid max-w-5xl gap-6 px-5 pb-12 pt-8 md:px-8">
          <video
            src={video.url}
            poster={video.posterUrl ?? undefined}
            controls
            playsInline
            className="w-full rounded-2xl border-[6px] border-white bg-black shadow-[0_18px_40px_rgba(84,52,29,0.18)]"
          />
          <p className="text-sm leading-relaxed text-[var(--ink-soft)]">
            {video.showPromptPublic ? video.job.prompt : "作者未公开提示词"}
          </p>
        </section>
      </main>
    );
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
