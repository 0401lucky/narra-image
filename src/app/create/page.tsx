import { redirect } from "next/navigation";

import { getCheckInSummary } from "@/lib/benefits/config";
import { db } from "@/lib/db";
import { serializeConversation, serializeGeneration, serializeUser } from "@/lib/prisma-mappers";
import { getCurrentUserRecord } from "@/lib/server/current-user";
import { getPublicTurnstileConfig } from "@/lib/auth/turnstile";
import { GeneratorStudio } from "@/components/create/generator-studio";
import { SiteHeader } from "@/components/marketing/site-header";
import { getActiveChannels } from "@/lib/providers/built-in-provider";
import { failStalePendingGenerationJobs } from "@/lib/generation/job-refund";

export const dynamic = "force-dynamic";

type CreatePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>;
};

export default async function CreatePage({ searchParams }: CreatePageProps) {
  const user = await getCurrentUserRecord();
  if (!user) {
    redirect("/login");
  }

  await failStalePendingGenerationJobs({ userId: user.id });

  const [jobs, channels, checkInSummary, conversations, savedProvider, turnstileConfig] = await Promise.all([
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
    db.conversation.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        generations: {
          select: { id: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        },
      },
      take: 100,
    }),
    db.savedProviderConfig.findUnique({
      where: { userId: user.id },
      select: {
        baseUrl: true,
        id: true,
        label: true,
        model: true,
        models: true,
        updatedAt: true,
      },
    }),
    getPublicTurnstileConfig(),
  ]);

  const currentUser = serializeUser(user);
  const params = await searchParams;
  const rawPrompt = Array.isArray(params?.prompt) ? params?.prompt[0] : params?.prompt;
  const initialPrompt = typeof rawPrompt === "string" ? rawPrompt.slice(0, 8000) : "";
  const serializedChannels = channels.map((ch) => ({
    creditCost: ch.creditCost,
    defaultModel: ch.defaultModel,
    id: ch.id,
    models: ch.models,
    name: ch.name,
  }));

  return (
    <main className="flex h-[100dvh] flex-col overflow-hidden bg-[#f5efe6]">
      <SiteHeader currentUser={currentUser} showCheckIn={false} activeHref="/create" />

      <section className="relative flex flex-1 flex-col overflow-hidden">
        <GeneratorStudio
          checkInSummary={checkInSummary}
          currentUser={currentUser}
          initialPrompt={initialPrompt}
          initialGenerations={jobs.map(serializeGeneration)}
          initialConversations={conversations.map(serializeConversation)}
          channels={serializedChannels}
          savedProvider={
            savedProvider
              ? {
                  ...savedProvider,
                  updatedAt: savedProvider.updatedAt.toISOString(),
                }
              : null
          }
          turnstile={{
            isEnabled: turnstileConfig.isEnabled,
            siteKey: turnstileConfig.siteKey,
            protectGenerate: turnstileConfig.protectGenerate,
          }}
        />
      </section>
    </main>
  );
}
