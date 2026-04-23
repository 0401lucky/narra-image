import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { serializeGeneration, serializeUser } from "@/lib/prisma-mappers";
import { getCurrentUserRecord } from "@/lib/server/current-user";
import { GeneratorStudio } from "@/components/create/generator-studio";
import { SiteHeader } from "@/components/marketing/site-header";
import { getBuiltInProviderConfig } from "@/lib/providers/built-in-provider";

export const dynamic = "force-dynamic";

export default async function CreatePage() {
  const user = await getCurrentUserRecord();
  if (!user) {
    redirect("/login");
  }

  const [savedProvider, jobs, builtInConfig] = await Promise.all([
    db.savedProviderConfig.findUnique({
      where: { userId: user.id },
      select: {
        baseUrl: true,
        label: true,
        model: true,
        models: true,
      },
    }),
    db.generationJob.findMany({
      where: { userId: user.id },
      include: {
        images: {
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 24,
    }),
    getBuiltInProviderConfig(),
  ]);

  const currentUser = serializeUser(user);

  return (
    <main className="pb-20">
      <SiteHeader currentUser={currentUser} />

      <section className="mx-auto max-w-6xl px-5 pt-8 pb-12 md:px-8">
        <div className="mb-6">
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--ink)] md:text-4xl">
            创作控制台
          </h1>
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            持续迭代你的提示词，或者切换到自定义的 API 渠道。
          </p>
        </div>

        <GeneratorStudio
          currentUser={currentUser}
          initialGenerations={jobs.map(serializeGeneration)}
          initialSavedProvider={savedProvider}
          builtInModels={builtInConfig.models || []}
          builtInDefaultModel={builtInConfig.model}
        />
      </section>
    </main>
  );
}
