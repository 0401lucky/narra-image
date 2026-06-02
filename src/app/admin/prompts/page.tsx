import { redirect } from "next/navigation";
import type { ComponentType } from "react";
import { BookOpenText, Database, GitBranch } from "lucide-react";

import { PromptSourceManager } from "@/components/admin/prompt-source-manager";
import { listPromptSourcesForAdmin } from "@/lib/prompts/service";
import { requireAdminRecord } from "@/lib/server/current-user";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "提示词库管理 — Narra Image",
};

export default async function AdminPromptsPage() {
  try {
    await requireAdminRecord();
  } catch {
    redirect("/login");
  }

  const sources = await listPromptSourcesForAdmin();
  const totalItems = sources.reduce((sum, source) => sum + source.itemCount, 0);
  const activeSources = sources.filter((source) => source.isEnabled).length;
  const failedSources = sources.filter((source) => source.status === "FAILED").length;

  return (
    <main className="pb-16">
      <section className="mx-auto grid max-w-7xl gap-6 px-5 pt-8 md:px-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="admin-eyebrow">Prompts</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[var(--ink)] md:text-4xl">
              提示词库管理
            </h1>
            <p className="mt-2 text-sm text-[var(--ink-soft)]">
              同步 GitHub 开源提示词来源，并控制用户侧提示词库展示范围。
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <MetricCard icon={GitBranch} label="启用来源" value={activeSources} />
          <MetricCard icon={BookOpenText} label="提示词总量" value={totalItems} />
          <MetricCard icon={Database} label="同步异常" value={failedSources} />
        </div>

        <div className="studio-card rounded-[1.8rem] p-5 md:p-6">
          <PromptSourceManager initialSources={sources} />
        </div>
      </section>
    </main>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: number;
}) {
  return (
    <div className="studio-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm text-[var(--ink-soft)]">{label}</div>
          <div className="mt-3 text-4xl font-semibold text-[var(--ink)]">{value}</div>
        </div>
        <span className="admin-metric-icon">
          <Icon className="size-5" />
        </span>
      </div>
    </div>
  );
}
