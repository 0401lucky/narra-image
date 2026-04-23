/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { GenerationStatus } from "@prisma/client";

import { db } from "@/lib/db";
import { serializeUser } from "@/lib/prisma-mappers";
import { getCurrentUserRecord } from "@/lib/server/current-user";
import { SiteHeader } from "@/components/marketing/site-header";
import { FeaturedGallery } from "@/components/marketing/featured-gallery";

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

        <FeaturedGallery works={works} />
      </section>
    </main>
  );
}
