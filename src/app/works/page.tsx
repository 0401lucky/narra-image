import { redirect } from "next/navigation";

import { SiteHeader } from "@/components/marketing/site-header";
import { MyWorksBoard } from "@/components/works/my-works-board";
import { serializeUser } from "@/lib/prisma-mappers";
import { getCurrentUserRecord } from "@/lib/server/current-user";
import { listUserWorks } from "@/lib/server/works";

export const dynamic = "force-dynamic";

export default async function WorksPage() {
  const user = await getCurrentUserRecord();
  if (!user) {
    redirect("/login");
  }

  const works = await listUserWorks(user.id);
  const currentUser = serializeUser(user);
  const counts = {
    featured: works.filter((work) => work.showcaseStatus === "FEATURED").length,
    pending: works.filter((work) => work.showcaseStatus === "PENDING").length,
    total: works.length,
  };

  return (
    <main className="pb-20">
      <SiteHeader currentUser={currentUser} />

      <section className="mx-auto grid max-w-7xl gap-6 px-5 pb-12 pt-8 md:px-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--ink)] md:text-4xl">
              我的作品
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--ink-soft)]">
              这里按单张图片管理你的全部作品。新生成的图片默认私有，你可以在这里查看详情、下载、投稿首页精选，或查看审核结果。
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3 text-center">
            {[
              ["全部作品", counts.total],
              ["待审核", counts.pending],
              ["已公开", counts.featured],
            ].map(([label, value]) => (
              <div key={label} className="studio-card min-w-28 rounded-[1.4rem] px-4 py-4">
                <p className="text-xs text-[var(--ink-soft)]">{label}</p>
                <p className="mt-2 text-2xl font-semibold text-[var(--ink)]">{value}</p>
              </div>
            ))}
          </div>
        </div>

        <MyWorksBoard works={works} />
      </section>
    </main>
  );
}
