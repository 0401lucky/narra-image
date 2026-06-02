import { Role } from "@prisma/client";

import { SiteHeader } from "@/components/marketing/site-header";
import { PromptLibraryBoard } from "@/components/prompts/prompt-library-board";
import { getCurrentUserRecord } from "@/lib/server/current-user";
import { serializeUser } from "@/lib/prisma-mappers";
import { listPrompts } from "@/lib/prompts/service";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "提示词库 — Narra Image",
  description: "浏览和使用来自 GitHub 开源项目的图像生成提示词。",
};

export default async function PromptsPage() {
  const user = await getCurrentUserRecord();
  const [initialData] = await Promise.all([
    listPrompts({ page: 1 }),
  ]);

  return (
    <main className="min-h-screen bg-[#f5efe6]">
      <SiteHeader
        activeHref="/prompts"
        currentUser={user ? serializeUser(user) : null}
      />
      <PromptLibraryBoard
        canCreate={Boolean(user)}
        initialData={initialData}
        isAdmin={user?.role === Role.ADMIN}
      />
    </main>
  );
}
