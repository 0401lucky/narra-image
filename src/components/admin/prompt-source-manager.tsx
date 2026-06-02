"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  XCircle,
} from "lucide-react";

import type { AdminPromptSource } from "@/lib/prompts/types";
import { cn } from "@/lib/utils";

type PromptSourceManagerProps = {
  initialSources: AdminPromptSource[];
};

type ApiResponse<T> = {
  data?: T;
  error?: string;
};

const statusText: Record<AdminPromptSource["status"], string> = {
  FAILED: "失败",
  IDLE: "待同步",
  SUCCESS: "已同步",
  SYNCING: "同步中",
};

export function PromptSourceManager({ initialSources }: PromptSourceManagerProps) {
  const [sources, setSources] = useState(initialSources);
  const [error, setError] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function syncSource(sourceId: string) {
    setError(null);
    setSyncingId(sourceId);
    const response = await fetch("/api/admin/prompt-sources/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceId }),
    });
    const result = (await response.json()) as ApiResponse<{ sources: AdminPromptSource[] }>;
    setSyncingId(null);
    if (!response.ok || !result.data) {
      setError(result.error || "同步失败");
      return;
    }
    setSources(result.data.sources);
  }

  async function toggleSource(source: AdminPromptSource) {
    setError(null);
    const response = await fetch("/api/admin/prompt-sources", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: source.id, isEnabled: !source.isEnabled }),
    });
    const result = (await response.json()) as ApiResponse<{ sources: AdminPromptSource[] }>;
    if (!response.ok || !result.data) {
      setError(result.error || "保存失败");
      return;
    }
    setSources(result.data.sources);
  }

  const totalItems = sources.reduce((sum, source) => sum + source.itemCount, 0);
  const activeSources = sources.filter((source) => source.isEnabled).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-[var(--ink)]">GitHub 提示词来源</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-soft)]">
            当前启用 {activeSources} 个来源，已入库 {totalItems} 条提示词。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/prompts"
            className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-white/70 px-4 py-2 text-sm font-semibold text-[var(--ink)] transition hover:border-[var(--accent)]"
          >
            查看提示词库
            <ExternalLink className="size-4" />
          </Link>
          <button
            type="button"
            onClick={() => startTransition(() => void syncSource("all"))}
            disabled={isPending || Boolean(syncingId)}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-5 py-2 text-sm font-semibold text-white shadow-lg transition hover:bg-[var(--accent)] disabled:opacity-55"
          >
            {syncingId === "all" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            同步全部
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {sources.map((source) => {
          const syncing = syncingId === source.id || syncingId === "all";
          return (
            <article key={source.id} className={cn("studio-card p-5", !source.isEnabled && "opacity-65")}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-[var(--ink)]">{source.name}</h3>
                    <StatusBadge status={syncing ? "SYNCING" : source.status} />
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-[var(--ink-soft)]">{source.slug}</p>
                </div>
                <button
                  type="button"
                  onClick={() => startTransition(() => void toggleSource(source))}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition",
                    source.isEnabled
                      ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                      : "bg-stone-100 text-stone-500 hover:bg-stone-200",
                  )}
                >
                  {source.isEnabled ? <PlayCircle className="size-3.5" /> : <PauseCircle className="size-3.5" />}
                  {source.isEnabled ? "启用" : "停用"}
                </button>
              </div>

              <p className="mt-4 min-h-12 text-sm leading-6 text-[var(--ink-soft)]">{source.description}</p>

              <div className="mt-4 grid gap-3 rounded-xl border border-[var(--line)] bg-white/58 p-4 text-sm sm:grid-cols-3">
                <Metric label="入库数量" value={String(source.itemCount)} />
                <Metric label="解析器" value={source.parser} mono />
                <Metric label="上次同步" value={formatTime(source.lastSyncedAt)} />
              </div>

              {source.lastSyncError && (
                <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700">
                  {source.lastSyncError}
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                <a
                  href={source.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold text-[var(--ink-soft)] transition hover:bg-white/70 hover:text-[var(--ink)]"
                >
                  GitHub
                  <ExternalLink className="size-4" />
                </a>
                <button
                  type="button"
                  onClick={() => startTransition(() => void syncSource(source.id))}
                  disabled={syncing || isPending}
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-white/70 px-4 py-2 text-sm font-semibold text-[var(--ink)] transition hover:border-[var(--accent)] disabled:opacity-55"
                >
                  {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  同步此来源
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
  const Icon = status === "FAILED" ? XCircle : status === "SUCCESS" ? CheckCircle2 : status === "SYNCING" ? Loader2 : PauseCircle;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        status === "FAILED" && "bg-rose-50 text-rose-700",
        status === "SUCCESS" && "bg-emerald-50 text-emerald-700",
        status === "SYNCING" && "bg-amber-50 text-amber-700",
        status === "IDLE" && "bg-stone-100 text-stone-600",
      )}
    >
      <Icon className={cn("size-3.5", status === "SYNCING" && "animate-spin")} />
      {statusText[status]}
    </span>
  );
}

function Metric({ label, mono, value }: { label: string; mono?: boolean; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-[var(--ink-soft)]">{label}</div>
      <div className={cn("mt-1 truncate font-semibold text-[var(--ink)]", mono && "font-mono text-xs")}>
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
