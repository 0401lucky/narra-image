import Link from "next/link";

import { serializeUser } from "@/lib/prisma-mappers";
import { getCurrentUserRecord } from "@/lib/server/current-user";
import { listFeaturedWorks } from "@/lib/server/works";
import { SiteHeader } from "@/components/marketing/site-header";
import { FeaturedGallery } from "@/components/marketing/featured-gallery";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getCurrentUserRecord();
  const currentUser = user ? serializeUser(user) : null;
  const works = await listFeaturedWorks().catch(() => []);

  return (
    <main className="pb-20">
      <SiteHeader currentUser={currentUser} />

      <section className="mx-auto mt-6 max-w-7xl px-5 md:px-8">
        <div className="mb-8 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-semibold tracking-tight text-[var(--ink)]">
              社区精选
            </h1>
            <p className="mt-3 text-base text-[var(--ink-soft)]">
              探索其他创作者的绝妙灵感。
            </p>
          </div>
          <Link
            href="/create"
            className="rounded-full bg-[var(--ink)] px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-[var(--accent)]"
          >
            开启我的创作
          </Link>
        </div>

        {works.length > 0 ? (
          <FeaturedGallery works={works} />
        ) : (
          <div className="studio-card rounded-[2rem] border border-dashed border-[var(--line)] p-10 text-center">
            <h2 className="text-2xl font-semibold text-[var(--ink)]">精选作品还在审核中</h2>
            <p className="mt-3 text-sm leading-relaxed text-[var(--ink-soft)]">
              当前还没有公开展示的作品。登录后去创作台生成图片，再到作品页投稿精选。
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
