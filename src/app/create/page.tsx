import { redirect } from "next/navigation";

import { getCheckInSummary } from "@/lib/benefits/config";
import { db } from "@/lib/db";
import { serializeGeneration, serializeUser } from "@/lib/prisma-mappers";
import { getCurrentUserRecord } from "@/lib/server/current-user";
import { GeneratorStudio } from "@/components/create/generator-studio";
import { SiteHeader } from "@/components/marketing/site-header";
import { getActiveChannels } from "@/lib/providers/built-in-provider";

export const dynamic = "force-dynamic";

export default async function CreatePage() {
  const user = await getCurrentUserRecord();
  if (!user) {
    redirect("/login");
  }

  const [jobs, channels, checkInSummary] = await Promise.all([
    db.generationJob.findMany({
      where: { userId: user.id },
      include: {
        images: {
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    getActiveChannels(),
    getCheckInSummary(user.id),
  ]);

  const currentUser = serializeUser(user);
  const serializedChannels = channels.map((ch) => ({
    creditCost: ch.creditCost,
    defaultModel: ch.defaultModel,
    id: ch.id,
    models: ch.models,
    name: ch.name,
  }));

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-[var(--surface)]">
      <SiteHeader currentUser={currentUser} showCheckIn={false} />

      <section className="relative flex flex-1 flex-col overflow-hidden">
        <GeneratorStudio
          checkInSummary={checkInSummary}
          currentUser={currentUser}
          initialGenerations={jobs.map(serializeGeneration)}
          channels={serializedChannels}
        />
      </section>
    </main>
  );
}
