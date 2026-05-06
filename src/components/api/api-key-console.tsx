"use client";

import { useMemo, useState } from "react";
import { Copy, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";

import { Alert } from "@/components/ui/alert";

export type ApiKeyItem = {
  createdAt: string;
  id: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  name: string;
  revokedAt: string | null;
  status: string;
};

type ApiConfigView = {
  isEnabled: boolean;
  requestsPerDay: number;
  requestsPerMinute: number;
};

type ApiKeyConsoleProps = {
  apiKeys: ApiKeyItem[];
  apiConfig: ApiConfigView;
  apiBaseUrl: string;
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

export function ApiKeyConsole({ apiBaseUrl, apiKeys, apiConfig }: ApiKeyConsoleProps) {
  const [items, setItems] = useState(apiKeys);
  const [name, setName] = useState("默认 API Key");
  const [secret, setSecret] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const activeCount = useMemo(
    () => items.filter((item) => item.status === "active").length,
    [items],
  );
  const normalizedApiBaseUrl = apiBaseUrl.replace(/\/$/, "");
  const openAiBaseUrl = `${normalizedApiBaseUrl}/v1`;

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setMessage("已复制到剪贴板");
    } catch {
      setError("复制失败，请手动复制");
    }
  }

  async function createKey() {
    setError(null);
    setMessage(null);
    setCreating(true);
    try {
      const response = await fetch("/api/me/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        data?: { apiKey: ApiKeyItem; secret: string };
        error?: string;
      };

      if (!response.ok || !result.data) {
        setError(result.error || "创建 API Key 失败");
        return;
      }

      setItems((current) => [result.data!.apiKey, ...current]);
      setSecret(result.data.secret);
      setMessage("API Key 已创建，请立即复制保存");
    } finally {
      setCreating(false);
    }
  }

  async function revokeKey(id: string) {
    if (!confirm("确定要停用这个 API Key 吗？停用后外部调用会立刻失效。")) return;
    setError(null);
    setMessage(null);
    setRevokingId(id);
    try {
      const response = await fetch(`/api/me/api-keys/${id}`, {
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
        current.map((item) => (item.id === id ? result.data!.apiKey : item)),
      );
      setMessage("API Key 已停用");
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="grid gap-4 sm:gap-5 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
      <div className="grid gap-5 self-start">
        <div className="studio-card rounded-[1.4rem] p-4 sm:rounded-[1.8rem] sm:p-6">
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-[var(--accent)]/15 text-[var(--accent)]">
              <KeyRound className="size-6" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-[var(--ink)]">API Key</h2>
              <p className="text-sm text-[var(--ink-soft)]">
                当前启用 {activeCount} 个
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-3">
            <label className="text-sm font-medium text-[var(--ink)]" htmlFor="api-key-name">
              Key 名称
            </label>
            <input
              id="api-key-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="rounded-xl border border-[var(--line)] bg-white/70 px-4 py-3 text-sm outline-none transition focus:border-[var(--accent)]"
              maxLength={40}
            />
            <button
              type="button"
              disabled={creating}
              onClick={() => void createKey()}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--ink)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent)] disabled:opacity-60"
            >
              {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              创建 API Key
            </button>
          </div>
        </div>

        <div className="studio-card rounded-[1.4rem] p-4 sm:rounded-[1.8rem] sm:p-6">
          <h3 className="font-semibold text-[var(--ink)]">统一速率限制</h3>
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            管理员为全站 API Key 设置统一限制。
          </p>
          <div className="mt-4 grid gap-2 text-sm text-[var(--ink-soft)]">
            <div className="flex justify-between rounded-xl bg-[var(--surface-strong)]/60 px-3 py-2">
              <span>API 状态</span>
              <span className={apiConfig.isEnabled ? "text-emerald-700" : "text-rose-600"}>
                {apiConfig.isEnabled ? "开启" : "关闭"}
              </span>
            </div>
            <div className="flex justify-between rounded-xl bg-[var(--surface-strong)]/60 px-3 py-2">
              <span>每分钟</span>
              <span>{apiConfig.requestsPerMinute} 次 / Key</span>
            </div>
            <div className="flex justify-between rounded-xl bg-[var(--surface-strong)]/60 px-3 py-2">
              <span>每天</span>
              <span>{apiConfig.requestsPerDay} 次 / Key</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-5">
        {secret ? (
          <Alert variant="warning" title="只显示一次">
            <div className="mt-2 flex flex-col gap-3">
              <code className="break-all rounded-xl bg-white/70 px-3 py-2 text-xs text-[var(--ink)]">
                {secret}
              </code>
              <button
                type="button"
                onClick={() => void copyText(secret)}
                className="inline-flex w-fit items-center gap-2 rounded-full border border-[var(--line)] px-4 py-2 text-xs font-medium"
              >
                <Copy className="size-3.5" />
                复制完整 Key
              </button>
            </div>
          </Alert>
        ) : null}

        {message ? <Alert variant="success">{message}</Alert> : null}
        {error ? <Alert variant="error">{error}</Alert> : null}

        <div className="studio-card overflow-hidden rounded-[1.4rem] sm:rounded-[1.8rem]">
          <div className="border-b border-[var(--line)] px-5 py-4">
            <h2 className="font-semibold text-[var(--ink)]">我的 Key</h2>
          </div>
          <div className="divide-y divide-[var(--line)]">
            {items.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-[var(--ink-soft)]">
                还没有 API Key。
              </div>
            ) : (
              items.map((item) => (
                <div
                  key={item.id}
                  className="grid gap-3 px-4 py-4 md:grid-cols-[1fr_auto] md:items-center md:px-5"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-[var(--ink)]">{item.name}</p>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${
                        item.status === "active"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-rose-50 text-rose-600"
                      }`}>
                        {item.status === "active" ? "启用" : "已停用"}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-xs text-[var(--ink-soft)]">
                      {item.keyPrefix}...
                    </p>
                    <p className="mt-1 text-xs text-[var(--ink-soft)]">
                      创建：{formatDate(item.createdAt)} · 最近使用：{formatDate(item.lastUsedAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={item.status !== "active" || revokingId === item.id}
                    onClick={() => void revokeKey(item.id)}
                    className="inline-flex items-center justify-center gap-1.5 rounded-full border border-rose-200 px-3 py-2 text-xs font-medium text-rose-600 transition hover:border-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {revokingId === item.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                    停用
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="studio-card rounded-[1.4rem] p-4 sm:rounded-[1.8rem] sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="font-semibold text-[var(--ink)]">调用示例</h2>
              <p className="mt-1 text-xs text-[var(--ink-soft)]">
                OpenAI 客户端 Base URL：
                <span className="font-mono text-[var(--ink)]">{openAiBaseUrl}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => void copyText(openAiBaseUrl)}
              className="inline-flex w-fit items-center gap-2 rounded-full border border-[var(--line)] px-3 py-2 text-xs font-medium text-[var(--ink-soft)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              <Copy className="size-3.5" />
              复制地址
            </button>
          </div>
          <pre className="mt-4 overflow-x-auto rounded-2xl bg-[var(--ink)] p-4 text-xs leading-relaxed text-white">
{`curl -X POST ${openAiBaseUrl}/images/generations \\
  -H "Authorization: Bearer narra_sk_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{"prompt":"一张手绘风格的咖啡店海报","size":"1024x1024","response_format":"url"}'`}
          </pre>
          <pre className="mt-3 overflow-x-auto rounded-2xl bg-[var(--ink)] p-4 text-xs leading-relaxed text-white">
{`curl -X POST ${openAiBaseUrl}/chat/completions \\
  -H "Authorization: Bearer narra_sk_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"narra-image","messages":[{"role":"user","content":"画一只赛博风格的猫"}]}'`}
          </pre>
        </div>
      </div>
    </div>
  );
}
