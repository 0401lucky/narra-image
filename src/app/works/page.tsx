import { redirect } from "next/navigation";

import { SiteHeader } from "@/components/marketing/site-header";
import { MyWorksBoard } from "@/components/works/my-works-board";
import { serializeUser } from "@/lib/prisma-mappers";
import { getCurrentUserRecord } from "@/lib/server/current-user";
import { getUserWorksCounts, listUserWorksPage } from "@/lib/server/works";

export const dynamic = "force-dynamic";

export default async function WorksPage() {
  const user = await getCurrentUserRecord();
  if (!user) {
    redirect("/login");
  }

  const [initialPage, counts] = await Promise.all([
    listUserWorksPage({ userId: user.id, limit: 24 }),
    getUserWorksCounts(user.id),
  ]);
  const currentUser = serializeUser(user);

  return (
    <main className="pb-20">
      <SiteHeader currentUser={currentUser} />

      <section className="works-surface mx-auto grid max-w-[96rem] gap-6 px-5 pb-12 pt-8 md:px-8">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <span className="grid size-12 place-items-center rounded-full border border-[var(--line)] bg-[#fff7eb] text-[var(--accent)] shadow-[0_12px_30px_rgba(94,58,33,0.08)]">
                画
              </span>
              <div>
                <p className="text-xs font-semibold uppercase text-[var(--accent)]">
                  Works
                </p>
                <h1 className="text-3xl font-semibold tracking-tight text-[var(--ink)] md:text-4xl">
                  作品
                </h1>
              </div>
            </div>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--ink-soft)]">
              管理你的生成图片、投稿精选与公开状态。
              每张图都可以在这里查看详情、下载、分享或投稿首页精选。
            </p>
          </div>

          <div className="flex flex-col gap-3 lg:items-end">
            <div className="grid grid-cols-3 gap-2 text-center sm:gap-3">
              {[
                ["全部作品", counts.total],
                ["待审核", counts.pending],
                ["已精选", counts.featured],
              ].map(([label, value]) => (
                <div key={label} className="studio-card min-w-24 px-3 py-3">
                  <p className="text-xs text-[var(--ink-soft)]">{label}</p>
                  <p className="mt-1.5 text-xl font-semibold text-[var(--ink)] md:text-2xl">
                    {value}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <MyWorksBoard
          counts={counts}
          initialItems={initialPage.items}
          initialHasMore={initialPage.hasMore}
          initialCursor={initialPage.nextCursor}
        />
      </section>
    </main>
  );
}
