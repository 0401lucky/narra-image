import { BookOpenText, Database, GitBranch } from "lucide-react";
import { redirect } from "next/navigation";
import type { ComponentType } from "react";

import { PromptSourceManager } from "@/components/admin/prompt-source-manager";
import { AdminPageHeader } from "@/components/admin/ui/admin-page-header";
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
      <section className="mx-auto grid max-w-7xl gap-6 px-5 pt-7 md:px-8">
        <AdminPageHeader
          eyebrow="Prompts"
          icon={BookOpenText}
          title="提示词库同步管理"
          description="同步 GitHub 开源精选提示词仓库，并控制用户侧灵感词库的展示来源。"
        />

        <div className="grid gap-4 md:grid-cols-3">
          <MetricCard icon={GitBranch} label="启用同步源" value={activeSources} />
          <MetricCard icon={BookOpenText} label="入库提示词总量" value={totalItems} />
          <MetricCard
            icon={Database}
            label="同步异常源"
            value={failedSources}
            highlight={failedSources > 0}
          />
        </div>

        <div className="studio-card p-5 md:p-6">
          <PromptSourceManager initialSources={sources} />
        </div>
      </section>
    </main>
  );
}

function MetricCard({
  highlight = false,
  icon: Icon,
  label,
  value,
}: {
  highlight?: boolean;
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: number;
}) {
  return (
    <div className="studio-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm text-[var(--ink-soft)]">{label}</div>
          <div
            className={`mt-2 font-mono text-3xl font-semibold tabular-nums ${
              highlight ? "text-rose-600" : "text-[var(--ink)]"
            }`}
          >
            {value.toLocaleString("zh-CN")}
          </div>
        </div>
        <span className="admin-metric-icon">
          <Icon className="size-4.5" aria-hidden />
        </span>
      </div>
    </div>
  );
}
