/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { GenerationStatus } from "@prisma/client";

import { db } from "@/lib/db";
import { serializeUser } from "@/lib/prisma-mappers";
import { getCurrentUserRecord } from "@/lib/server/current-user";
import { GeneratorStudio } from "@/components/create/generator-studio";
import { SiteHeader } from "@/components/marketing/site-header";

export const dynamic = "force-dynamic";

const fallbackWorks = [
  {
    id: "demo-1",
    image:
      "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=80",
    prompt: "雨后城市、银色风衣、胶片颗粒、时尚封面",
    title: "Raincoat Cover",
  },
  {
    id: "demo-2",
    image:
      "https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=900&q=80",
    prompt: "暖色落日、时装大片、柔焦、高级妆面",
    title: "Golden Issue",
  },
  {
    id: "demo-3",
    image:
      "https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=900&q=80",
    prompt: "未来建筑、极简镜面、竖版海报、编辑感",
    title: "Mirror City",
  },
];

export default async function Home() {
  const user = await getCurrentUserRecord();
  const currentUser = user ? serializeUser(user) : null;

  const featuredJobs = await db.generationJob
    .findMany({
      where: {
        featuredAt: {
          not: null,
        },
        status: GenerationStatus.SUCCEEDED,
      },
      include: {
        images: {
          orderBy: { createdAt: "asc" },
          take: 1,
        },
      },
      orderBy: { featuredAt: "desc" },
      take: 6,
    })
    .catch(() => []);

  const works =
    featuredJobs.length > 0
      ? featuredJobs
          .filter((job) => job.images[0])
          .map((job) => ({
            id: job.id,
            image: job.images[0]!.url,
            prompt: job.prompt,
            title: job.model,
          }))
      : fallbackWorks;

  return (
    <main className="pb-20">
      <SiteHeader currentUser={currentUser} />

      <section className="mx-auto max-w-7xl px-5 pt-8 pb-12 md:px-8">
        <div className="mb-6">
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--ink)] md:text-4xl">
            工作台
          </h1>
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            输入提示词即可开始创作，或切换自填渠道使用你的 API Key。
          </p>
        </div>
        
        <GeneratorStudio compact currentUser={currentUser} />
      </section>

      <section className="mx-auto mt-10 max-w-7xl px-5 md:px-8">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-[var(--ink)]">
              社区精选
            </h2>
            <p className="mt-2 text-sm text-[var(--ink-soft)]">
              探索其他创作者的灵感
            </p>
          </div>
          <Link
            href="/create"
            className="rounded-full bg-[var(--card-strong)] px-5 py-2.5 text-sm font-medium text-[var(--ink)] shadow-sm transition hover:bg-[var(--line)]"
          >
            去工作台继续创作
          </Link>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {works.map((work, index) => (
            <article
              key={`${work.id}-${index}`}
              className="studio-card overflow-hidden rounded-[2rem]"
            >
              <img src={work.image} alt={work.title} className="aspect-[4/5] w-full object-cover" />
              <div className="space-y-3 p-5">
                <div className="flex items-center justify-between text-xs uppercase tracking-[0.24em] text-[var(--ink-soft)]">
                  <span>精选作品</span>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                </div>
                <h3 className="text-xl font-medium text-[var(--ink)]">{work.title}</h3>
                <p className="line-clamp-3 text-sm leading-7 text-[var(--ink-soft)]">
                  {work.prompt}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
