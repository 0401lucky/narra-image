import { redirect } from "next/navigation";
import { GenerationType } from "@prisma/client";

import { db } from "@/lib/db";
import { serializeGeneration, serializeUser } from "@/lib/prisma-mappers";
import { getCurrentUserRecord } from "@/lib/server/current-user";
import { SiteHeader } from "@/components/marketing/site-header";
import { VideoStudio } from "@/components/video/video-studio";
import { getActiveChannels } from "@/lib/providers/built-in-provider";
import { failStalePendingGenerationJobs } from "@/lib/generation/job-refund";

export const dynamic = "force-dynamic";

export default async function VideoPage() {
  const user = await getCurrentUserRecord();
  if (!user) {
    redirect("/login");
  }

  await failStalePendingGenerationJobs({ userId: user.id });

  const [jobs, channels] = await Promise.all([
    db.generationJob.findMany({
      where: {
        userId: user.id,
        generationType: { in: [GenerationType.TEXT_TO_VIDEO, GenerationType.IMAGE_TO_VIDEO] },
      },
      include: {
        images: { orderBy: { createdAt: "asc" } },
        videos: { orderBy: { createdAt: "asc" } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    getActiveChannels(),
  ]);

  const currentUser = serializeUser(user);
  const serializedChannels = channels.map((ch) => ({
    defaultModel: ch.defaultModel,
    id: ch.id,
    models: ch.models,
    name: ch.name,
    videoCreditCost: ch.videoCreditCost,
  }));

  return (
    <main className="flex h-[100dvh] flex-col overflow-hidden bg-[#f5efe6]">
      <SiteHeader currentUser={currentUser} showCheckIn={false} activeHref="/video" />

      <section className="relative flex flex-1 flex-col overflow-hidden">
        <VideoStudio
          currentUser={currentUser}
          initialGenerations={jobs.map(serializeGeneration)}
          channels={serializedChannels}
        />
      </section>
    </main>
  );
}
