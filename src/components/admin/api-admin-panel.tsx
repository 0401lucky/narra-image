"use client";

import { Loader2, Power, RotateCcw, Save, Search, ShieldOff, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import type { ApiKeyItem } from "@/components/api/api-key-console";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { useAdminToast } from "./hooks/use-admin-toast";
import { AdminConfirmDialog } from "./ui/admin-modal";
import { AdminSwitch } from "./ui/admin-switch";

type ApiConfigView = {
  isEnabled: boolean;
  requestsPerDay: number;
  requestsPerMinute: number;
};

export type AdminApiKey = ApiKeyItem & {
  generationCount: number;
  user: {
    email: string;
    id: string;
  };
};

type ApiAdminPanelProps = {
  apiConfig: ApiConfigView;
  apiKeys: AdminApiKey[];
  q?: string;
  statusFilter?: "" | "active" | "revoked";
  totalCount?: number;
};

function formatDate(value: string | null) {
  if (!value) return "从未调用";
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

export function ApiAdminPanel({
  apiConfig,
  apiKeys,
  q = "",
  statusFilter = "",
  totalCount,
}: ApiAdminPanelProps) {
  const router = useRouter();
  const toast = useAdminToast();
  const [isPending, startTransition] = useTransition();
  const [isEnabled, setIsEnabled] = useState(apiConfig.isEnabled);
  const [requestsPerMinute, setRequestsPerMinute] = useState(apiConfig.requestsPerMinute);
  const [requestsPerDay, setRequestsPerDay] = useState(apiConfig.requestsPerDay);
  const [revokedOverrides, setRevokedOverrides] = useState<
    Record<string, ApiKeyItem>
  >({});
  const [saving, setSaving] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<AdminApiKey | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const items = useMemo(
    () =>
      apiKeys.map((item) =>
        revokedOverrides[item.id]
          ? { ...item, ...revokedOverrides[item.id]! }
          : item,
      ),
    [apiKeys, revokedOverrides],
  );

  async function saveConfig() {
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      const response = await fetch("/api/admin/api-config", {
        body: JSON.stringify({
          isEnabled,
          requestsPerDay,
          requestsPerMinute,
        }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        const msg = result.error || "保存失败";
        setError(msg);
        toast.error("API 限制保存失败", msg);
        return;
      }
      setMessage("API 速率限制已更新");
      toast.success(
        "API 配置已更新",
        `${isEnabled ? "已开启外部 API" : "已关闭外部 API"} · ${requestsPerMinute}/分钟 · ${requestsPerDay}/天`,
      );
      startTransition(() => router.refresh());
    } finally {
      setSaving(false);
    }
  }

  async function confirmRevokeKey() {
    if (!revokeTarget) return;
    setRevokeError(null);
    setError(null);
    setMessage(null);
    setRevoking(true);
    try {
      const response = await fetch(`/api/admin/api-keys/${revokeTarget.id}`, {
        method: "DELETE",
      });
      const result = (await response.json().catch(() => ({}))) as {
        data?: { apiKey: ApiKeyItem };
        error?: string;
      };
      if (!response.ok || !result.data) {
        const msg = result.error || "停用失败";
        setRevokeError(msg);
        toast.error("停用 API Key 失败", msg);
        return;
      }
      setRevokedOverrides((current) => ({
        ...current,
        [revokeTarget.id]: result.data!.apiKey,
      }));
      setMessage("API Key 已停用");
      toast.success("API Key 已停用", `${revokeTarget.name} (${revokeTarget.keyPrefix}...)`);
      setRevokeTarget(null);
      startTransition(() => router.refresh());
    } finally {
      setRevoking(false);
    }
  }

  return (
    <div className="grid gap-5">
      {message ? <Alert variant="success">{message}</Alert> : null}
      {error ? <Alert variant="error">{error}</Alert> : null}

      <div className="studio-card grid gap-5 p-5 sm:p-6 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "grid size-10 shrink-0 place-items-center rounded-xl border",
                isEnabled
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-rose-200 bg-rose-50 text-rose-600",
              )}
            >
              <Power className="size-5" aria-hidden />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink)]">统一速率限制与开关</h2>
              <p className="text-sm text-[var(--ink-soft)]">
                全站外部 `/v1/*` API Key 共享此配额，按单个 Key 独立计量。
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <div className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-[#faf7f1] px-4 py-3">
              <div>
                <div className="text-sm font-medium text-[var(--ink)]">开启外部 API</div>
                <div className="text-xs text-[var(--ink-soft)]">
                  {isEnabled ? "允许外部密钥调用" : "拒绝所有外部密钥"}
                </div>
              </div>
              <AdminSwitch
                ariaLabel="开启外部 API"
                checked={isEnabled}
                onCheckedChange={setIsEnabled}
              />
            </div>

            <label className="grid gap-1.5 text-xs font-medium text-[var(--ink-soft)]">
              <span>每分钟请求上限 / Key</span>
              <input
                type="number"
                min={1}
                max={1000}
                value={requestsPerMinute}
                onChange={(event) => setRequestsPerMinute(Number(event.target.value))}
                className="rounded-xl border border-[var(--line)] bg-white px-4 py-2.5 font-mono text-sm font-semibold text-[var(--ink)] outline-none"
              />
            </label>

            <label className="grid gap-1.5 text-xs font-medium text-[var(--ink-soft)]">
              <span>每日请求上限 / Key</span>
              <input
                type="number"
                min={1}
                max={100000}
                value={requestsPerDay}
                onChange={(event) => setRequestsPerDay(Number(event.target.value))}
                className="rounded-xl border border-[var(--line)] bg-white px-4 py-2.5 font-mono text-sm font-semibold text-[var(--ink)] outline-none"
              />
            </label>
          </div>
        </div>

        <button
          type="button"
          disabled={saving || isPending}
          onClick={() => void saveConfig()}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#c25934] px-5 py-2.5 text-sm font-semibold text-white shadow-2xs transition hover:bg-[#ad4c2a] disabled:opacity-60 sm:w-auto"
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Save className="size-4" aria-hidden />
          )}
          保存限制
        </button>
      </div>

      <div className="studio-card overflow-hidden">
        <div className="border-b border-[var(--line)] p-4 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-[var(--ink)]">API Key 列表</h2>
            <span className="text-xs text-[var(--ink-soft)]">
              匹配 {totalCount ?? items.length} 个密钥（本页展示 {items.length} 个）
            </span>
          </div>

          <form
            action="/admin/api"
            method="get"
            className="mt-3 flex flex-wrap items-center gap-2"
          >
            <div className="relative min-w-[200px] flex-1">
              <Search
                className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-[var(--ink-soft)]"
                aria-hidden
              />
              <input
                key={q}
                name="q"
                defaultValue={q}
                placeholder="搜索密钥名称、前缀或所属用户邮箱…"
                className="w-full rounded-xl border border-[var(--admin-line)] bg-white py-2 pr-8 pl-10 text-xs outline-none sm:text-sm"
              />
              {q ? (
                <Link
                  href={statusFilter ? `/admin/api?status=${statusFilter}` : "/admin/api"}
                  aria-label="清空密钥搜索"
                  className="absolute top-1/2 right-2.5 -translate-y-1/2 text-[var(--ink-soft)] hover:text-[var(--ink)]"
                >
                  <X className="size-3.5" aria-hidden />
                </Link>
              ) : null}
            </div>

            <select
              name="status"
              defaultValue={statusFilter}
              aria-label="按密钥状态筛选"
              className="rounded-xl border border-[var(--admin-line)] bg-white px-3 py-2 text-xs font-medium text-[var(--ink)] outline-none sm:text-sm"
            >
              <option value="">全部状态</option>
              <option value="active">仅启用中</option>
              <option value="revoked">已停用</option>
            </select>

            <button
              type="submit"
              className="rounded-xl bg-[#c25934] px-4 py-2 text-xs font-semibold text-white shadow-2xs transition hover:bg-[#ad4c2a] sm:text-sm"
            >
              筛选
            </button>

            {q || statusFilter ? (
              <Link
                href="/admin/api"
                className="inline-flex items-center gap-1 rounded-xl border border-[var(--line)] bg-[#faf7f1] px-3 py-2 text-xs font-medium text-[var(--ink-soft)] hover:text-[#c85a32]"
              >
                <RotateCcw className="size-3.5" aria-hidden />
                重置
              </Link>
            ) : null}
          </form>
        </div>

        <div className="grid gap-3 p-3 lg:hidden">
          {items.map((item) => (
            <article
              key={item.id}
              className="rounded-xl border border-[var(--line)] bg-[#faf7f1]/70 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-[var(--ink)]">{item.name}</p>
                  <p className="mt-0.5 font-mono text-xs text-[var(--ink-soft)]">
                    {item.keyPrefix}...
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                    item.status === "active"
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-stone-200 text-stone-600",
                  )}
                >
                  {item.status === "active" ? "启用" : "已停用"}
                </span>
              </div>
              <div className="mt-3 grid gap-1.5 rounded-xl bg-white p-3 text-xs text-[var(--ink-soft)]">
                <div className="flex justify-between gap-3">
                  <span>所属用户</span>
                  <span className="min-w-0 truncate text-right font-mono text-[var(--ink)]">
                    {item.user.email}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>累计调用</span>
                  <span className="font-mono font-semibold text-[var(--ink)]">
                    {item.generationCount}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span>最近使用</span>
                  <span className="text-right font-mono text-[var(--ink)]">
                    {formatDate(item.lastUsedAt)}
                  </span>
                </div>
              </div>
              <button
                type="button"
                disabled={item.status !== "active"}
                onClick={() => {
                  setRevokeError(null);
                  setRevokeTarget(item);
                }}
                className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-rose-200 bg-white px-3 py-2 text-xs font-medium text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <ShieldOff className="size-3.5" aria-hidden />
                {item.status === "active" ? "停用密钥" : "已停用"}
              </button>
            </article>
          ))}
          {items.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-[var(--ink-soft)]">
              暂无符合条件的 API Key。
            </div>
          ) : null}
        </div>

        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b border-[var(--line)] text-xs text-[var(--ink-soft)]">
              <tr>
                <th className="px-5 py-3.5 font-medium">密钥名称 / 前缀</th>
                <th className="px-5 py-3.5 font-medium">所属用户</th>
                <th className="px-5 py-3.5 font-medium">累计调用</th>
                <th className="px-5 py-3.5 font-medium">最近使用</th>
                <th className="px-5 py-3.5 font-medium">状态</th>
                <th className="px-5 py-3.5 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]/70">
              {items.map((item) => (
                <tr key={item.id} className="transition-colors hover:bg-[#faf6ee]/80">
                  <td className="px-5 py-3.5">
                    <p className="font-medium text-[var(--ink)]">{item.name}</p>
                    <p className="mt-0.5 font-mono text-xs text-[var(--ink-soft)]">
                      {item.keyPrefix}...
                    </p>
                  </td>
                  <td className="px-5 py-3.5 font-mono text-xs text-[var(--ink-soft)]">
                    {item.user.email}
                  </td>
                  <td className="px-5 py-3.5 font-mono font-semibold tabular-nums text-[var(--ink)]">
                    {item.generationCount}
                  </td>
                  <td className="px-5 py-3.5 font-mono text-xs text-[var(--ink-soft)]">
                    {formatDate(item.lastUsedAt)}
                  </td>
                  <td className="px-5 py-3.5">
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                        item.status === "active"
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-stone-200 text-stone-600",
                      )}
                    >
                      {item.status === "active" ? "启用" : "已停用"}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <button
                      type="button"
                      disabled={item.status !== "active"}
                      onClick={() => {
                        setRevokeError(null);
                        setRevokeTarget(item);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <ShieldOff className="size-3.5" aria-hidden />
                      停用
                    </button>
                  </td>
                </tr>
              ))}
              {items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-[var(--ink-soft)]">
                    暂无符合条件的 API Key。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <AdminConfirmDialog
        open={revokeTarget !== null}
        onClose={() => {
          if (!revoking) setRevokeTarget(null);
        }}
        onConfirm={() => void confirmRevokeKey()}
        busy={revoking}
        tone="danger"
        title="停用外部 API Key"
        description="停用后使用该密钥的所有外部 API 请求将立即被拒绝，且停用后不可重新激活（用户可自行新建密钥）。"
        confirmLabel={revoking ? "停用中…" : "确认停用"}
        error={revokeError}
      >
        {revokeTarget ? (
          <div className="grid gap-1.5 rounded-xl border border-[var(--line)] bg-[#f8f4ec] p-3 text-xs text-[var(--ink-soft)]">
            <div>密钥名称：{revokeTarget.name}</div>
            <div>密钥前缀：{revokeTarget.keyPrefix}...</div>
            <div>所属账号：{revokeTarget.user.email}</div>
          </div>
        ) : null}
      </AdminConfirmDialog>
    </div>
  );
}
