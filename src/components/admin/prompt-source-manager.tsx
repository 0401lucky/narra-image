"use client";

import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  PauseCircle,
  RefreshCw,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { Alert } from "@/components/ui/alert";
import type { AdminPromptSource } from "@/lib/prompts/types";
import { cn } from "@/lib/utils";
import { useAdminToast } from "./hooks/use-admin-toast";
import { AdminSwitch } from "./ui/admin-switch";

type PromptSourceManagerProps = {
  initialSources: AdminPromptSource[];
};

type ApiResponse<T> = {
  data?: T;
  error?: string;
};

const statusText: Record<AdminPromptSource["status"], string> = {
  FAILED: "同步失败",
  IDLE: "待同步",
  SUCCESS: "已同步",
  SYNCING: "同步中",
};

export function PromptSourceManager({ initialSources }: PromptSourceManagerProps) {
  const toast = useAdminToast();
  const [sources, setSources] = useState(initialSources);
  const [error, setError] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function syncSource(sourceId: string) {
    setError(null);
    setSyncingId(sourceId);
    try {
      const response = await fetch("/api/admin/prompt-sources/sync", {
        body: JSON.stringify({ sourceId }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const result = (await response.json().catch(() => ({}))) as ApiResponse<{
        sources: AdminPromptSource[];
      }>;
      if (!response.ok || !result.data) {
        const msg = result.error || "同步失败";
        setError(msg);
        toast.error("提示词同步失败", msg);
        return;
      }
      setSources(result.data.sources);
      toast.success(
        sourceId === "all" ? "全部提示词源已同步" : "提示词来源同步完成",
      );
    } finally {
      setSyncingId(null);
    }
  }

  async function toggleSource(source: AdminPromptSource, nextEnabled: boolean) {
    setError(null);
    const response = await fetch("/api/admin/prompt-sources", {
      body: JSON.stringify({ id: source.id, isEnabled: nextEnabled }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    const result = (await response.json().catch(() => ({}))) as ApiResponse<{
      sources: AdminPromptSource[];
    }>;
    if (!response.ok || !result.data) {
      const msg = result.error || "保存失败";
      setError(msg);
      toast.error("切换来源状态失败", msg);
      return;
    }
    setSources(result.data.sources);
    toast.success(
      nextEnabled ? `已启用「${source.name}」` : `已停用「${source.name}」`,
    );
  }

  const totalItems = sources.reduce((sum, source) => sum + source.itemCount, 0);
  const activeSources = sources.filter((source) => source.isEnabled).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[var(--ink)]">GitHub 提示词同步源</h2>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            当前启用 {activeSources} 个来源，累计入库 {totalItems.toLocaleString("zh-CN")} 条提示词。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/prompts"
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-white px-4 py-2 text-xs font-semibold text-[var(--ink)] transition hover:border-[#c85a32] hover:text-[#c85a32]"
          >
            查看前台词库
            <ExternalLink className="size-3.5" aria-hidden />
          </Link>
          <button
            type="button"
            onClick={() => startTransition(() => void syncSource("all"))}
            disabled={isPending || Boolean(syncingId)}
            className="inline-flex items-center gap-2 rounded-full bg-[#c25934] px-5 py-2 text-xs font-semibold text-white shadow-2xs transition hover:bg-[#ad4c2a] disabled:opacity-55 sm:text-sm"
          >
            {syncingId === "all" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="size-4" aria-hidden />
            )}
            同步全部来源
          </button>
        </div>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {sources.map((source) => {
          const syncing = syncingId === source.id || syncingId === "all";
          return (
            <article
              key={source.id}
              className={cn(
                "studio-card flex flex-col justify-between p-5 transition-opacity",
                !source.isEnabled && "opacity-65",
              )}
            >
              <div>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-[var(--ink)]">
                        {source.name}
                      </h3>
                      <StatusBadge status={syncing ? "SYNCING" : source.status} />
                    </div>
                    <p className="mt-1 font-mono text-xs text-[var(--ink-soft)]">
                      {source.slug}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-[var(--ink-soft)]">
                      {source.isEnabled ? "已启用" : "已停用"}
                    </span>
                    <AdminSwitch
                      size="sm"
                      ariaLabel={`启用来源 ${source.name}`}
                      checked={source.isEnabled}
                      disabled={isPending}
                      onCheckedChange={(next) =>
                        startTransition(() => void toggleSource(source, next))
                      }
                    />
                  </div>
                </div>

                <p className="mt-3 text-sm leading-relaxed text-[var(--ink-soft)]">
                  {source.description}
                </p>

                <div className="mt-4 grid gap-3 rounded-xl border border-[var(--line)] bg-[#faf7f1] p-3.5 text-sm sm:grid-cols-3">
                  <Metric label="入库数量" value={source.itemCount.toLocaleString("zh-CN")} />
                  <Metric label="解析器" value={source.parser} mono />
                  <Metric label="最近同步" value={formatTime(source.lastSyncedAt)} />
                </div>

                {source.lastSyncError ? (
                  <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700">
                    {source.lastSyncError}
                  </div>
                ) : null}
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)]/70 pt-3.5">
                <a
                  href={source.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--ink-soft)] transition hover:text-[#c85a32]"
                >
                  查看 GitHub 源仓库
                  <ExternalLink className="size-3.5" aria-hidden />
                </a>
                <button
                  type="button"
                  onClick={() => startTransition(() => void syncSource(source.id))}
                  disabled={syncing || isPending}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-white px-3.5 py-1.5 text-xs font-semibold text-[var(--ink)] transition hover:border-[#c85a32] hover:text-[#c85a32] disabled:opacity-55"
                >
                  {syncing ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <RefreshCw className="size-3.5" aria-hidden />
                  )}
                  单独同步
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: AdminPromptSource["status"] }) {
  const Icon =
    status === "FAILED"
      ? XCircle
      : status === "SUCCESS"
        ? CheckCircle2
        : status === "SYNCING"
          ? Loader2
          : PauseCircle;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        status === "FAILED" && "bg-rose-100 text-rose-700",
        status === "SUCCESS" && "bg-emerald-100 text-emerald-800",
        status === "SYNCING" && "bg-amber-100 text-amber-800",
        status === "IDLE" && "bg-stone-200 text-stone-600",
      )}
    >
      <Icon className={cn("size-3.5", status === "SYNCING" && "animate-spin")} aria-hidden />
      {statusText[status]}
    </span>
  );
}

function Metric({ label, mono, value }: { label: string; mono?: boolean; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-[var(--ink-soft)]">{label}</div>
      <div
        className={cn(
          "mt-1 truncate font-semibold text-[var(--ink)]",
          mono && "font-mono text-xs",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function formatTime(value: string | null) {
  if (!value) return "尚未同步";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "尚未同步";
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(date);
}
