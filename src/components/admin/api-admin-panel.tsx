"use client";

import { useState, useTransition } from "react";
import { Loader2, Power, Save, ShieldOff } from "lucide-react";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import type { ApiKeyItem } from "@/components/api/api-key-console";

type ApiConfigView = {
  isEnabled: boolean;
  requestsPerDay: number;
  requestsPerMinute: number;
};

type AdminApiKey = ApiKeyItem & {
  generationCount: number;
  user: {
    email: string;
    id: string;
  };
};

type ApiAdminPanelProps = {
  apiConfig: ApiConfigView;
  apiKeys: AdminApiKey[];
};

function formatDate(value: string | null) {
  if (!value) return "从未";
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

export function ApiAdminPanel({ apiConfig, apiKeys }: ApiAdminPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isEnabled, setIsEnabled] = useState(apiConfig.isEnabled);
  const [requestsPerMinute, setRequestsPerMinute] = useState(apiConfig.requestsPerMinute);
  const [requestsPerDay, setRequestsPerDay] = useState(apiConfig.requestsPerDay);
  const [items, setItems] = useState(apiKeys);
  const [saving, setSaving] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveConfig() {
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      const response = await fetch("/api/admin/api-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isEnabled,
          requestsPerDay,
          requestsPerMinute,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        setError(result.error || "保存失败");
        return;
      }
      setMessage("API 速率限制已更新");
      startTransition(() => router.refresh());
    } finally {
      setSaving(false);
    }
  }

  async function revokeKey(id: string) {
    if (!confirm("确定要停用这个 API Key 吗？")) return;
    setError(null);
    setMessage(null);
    setRevokingId(id);
    try {
      const response = await fetch(`/api/admin/api-keys/${id}`, {
        method: "DELETE",
      });
      const result = (await response.json().catch(() => ({}))) as {
        data?: { apiKey: ApiKeyItem };
        error?: string;
      };
      if (!response.ok || !result.data) {
        setError(result.error || "停用失败");
        return;
      }
      setItems((current) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                ...result.data!.apiKey,
              }
            : item,
        ),
      );
      setMessage("API Key 已停用");
      startTransition(() => router.refresh());
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="grid gap-5">
      {message ? <Alert variant="success">{message}</Alert> : null}
      {error ? <Alert variant="error">{error}</Alert> : null}

      <div className="studio-card grid gap-5 rounded-[1.4rem] p-4 sm:rounded-[1.8rem] sm:p-6 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <div className="flex items-center gap-3">
            <div className={`flex size-10 shrink-0 items-center justify-center rounded-2xl sm:size-11 ${
              isEnabled ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-600"
            }`}>
              <Power className="size-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink)] sm:text-xl">统一 API 限制</h2>
              <p className="text-sm text-[var(--ink-soft)]">
                全站 API Key 共用这套限制，按每个 Key 分别统计。
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:gap-4 md:grid-cols-3">
            <label className="flex items-center gap-2 rounded-2xl border border-[var(--line)] bg-white/65 px-4 py-3 text-sm text-[var(--ink)]">
              <input
                type="checkbox"
                checked={isEnabled}
                onChange={(event) => setIsEnabled(event.target.checked)}
              />
              开启外部 API
            </label>
            <label className="grid gap-1 text-sm text-[var(--ink)]">
              每分钟 / Key
              <input
                type="number"
                min={1}
                max={1000}
                value={requestsPerMinute}
                onChange={(event) => setRequestsPerMinute(Number(event.target.value))}
                className="rounded-xl border border-[var(--line)] bg-white/70 px-4 py-3 outline-none focus:border-[var(--accent)]"
              />
            </label>
            <label className="grid gap-1 text-sm text-[var(--ink)]">
              每天 / Key
              <input
                type="number"
                min={1}
                max={100000}
                value={requestsPerDay}
                onChange={(event) => setRequestsPerDay(Number(event.target.value))}
                className="rounded-xl border border-[var(--line)] bg-white/70 px-4 py-3 outline-none focus:border-[var(--accent)]"
              />
            </label>
          </div>
        </div>

        <button
          type="button"
          disabled={saving || isPending}
          onClick={() => void saveConfig()}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--ink)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent)] disabled:opacity-60 sm:w-auto"
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          保存限制
        </button>
      </div>

      <div className="studio-card overflow-hidden rounded-[1.4rem] sm:rounded-[1.8rem]">
        <div className="border-b border-[var(--line)] px-5 py-4">
          <h2 className="font-semibold text-[var(--ink)]">全站 API Key</h2>
        </div>
        <div className="grid gap-3 p-3 lg:hidden">
          {items.map((item) => (
            <article
              key={item.id}
              className="rounded-[1.2rem] border border-[var(--line)] bg-white/40 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-[var(--ink)]">{item.name}</p>
                  <p className="mt-1 font-mono text-xs text-[var(--ink-soft)]">
                    {item.keyPrefix}...
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${
                  item.status === "active"
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-rose-50 text-rose-600"
                }`}>
                  {item.status === "active" ? "启用" : "已停用"}
                </span>
              </div>
              <div className="mt-3 grid gap-2 rounded-xl bg-[var(--surface-strong)]/45 p-3 text-xs text-[var(--ink-soft)]">
                <div className="flex justify-between gap-3">
                  <span>用户</span>
                  <span className="min-w-0 truncate text-right text-[var(--ink)]">{item.user.email}</span>
                </div>
                <div className="flex justify-between">
                  <span>调用</span>
                  <span className="text-[var(--ink)]">{item.generationCount}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span>最近使用</span>
                  <span className="text-right text-[var(--ink)]">{formatDate(item.lastUsedAt)}</span>
                </div>
              </div>
              <button
                type="button"
                disabled={item.status !== "active" || revokingId === item.id}
                onClick={() => void revokeKey(item.id)}
                className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-rose-200 px-3 py-2 text-xs font-medium text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {revokingId === item.id ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldOff className="size-3.5" />}
                停用
              </button>
            </article>
          ))}
          {items.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-[var(--ink-soft)]">
              暂无 API Key。
            </div>
          ) : null}
        </div>
        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full min-w-[880px] text-left text-sm">
            <thead className="bg-[var(--surface-strong)]/60 text-xs text-[var(--ink-soft)]">
              <tr>
                <th className="px-5 py-4 font-medium">Key</th>
                <th className="px-5 py-4 font-medium">用户</th>
                <th className="px-5 py-4 font-medium">调用</th>
                <th className="px-5 py-4 font-medium">最近使用</th>
                <th className="px-5 py-4 font-medium">状态</th>
                <th className="px-5 py-4 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]/70">
              {items.map((item) => (
                <tr key={item.id} className="bg-white/35">
                  <td className="px-5 py-4">
                    <p className="font-medium text-[var(--ink)]">{item.name}</p>
                    <p className="mt-1 font-mono text-xs text-[var(--ink-soft)]">
                      {item.keyPrefix}...
                    </p>
                  </td>
                  <td className="px-5 py-4 text-[var(--ink-soft)]">{item.user.email}</td>
                  <td className="px-5 py-4 text-[var(--ink)]">{item.generationCount}</td>
                  <td className="px-5 py-4 text-[var(--ink-soft)]">{formatDate(item.lastUsedAt)}</td>
                  <td className="px-5 py-4">
                    <span className={`rounded-full px-2.5 py-1 text-xs ${
                      item.status === "active"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-rose-50 text-rose-600"
                    }`}>
                      {item.status === "active" ? "启用" : "已停用"}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <button
                      type="button"
                      disabled={item.status !== "active" || revokingId === item.id}
                      onClick={() => void revokeKey(item.id)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 px-3 py-2 text-xs font-medium text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {revokingId === item.id ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldOff className="size-3.5" />}
                      停用
                    </button>
                  </td>
                </tr>
              ))}
              {items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-[var(--ink-soft)]">
                    暂无 API Key。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
