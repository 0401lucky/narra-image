"use client";

/* eslint-disable @next/next/no-img-element */

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ImageIcon, Loader2, Sparkles } from "lucide-react";

import type { LoginCoverConfig } from "@/lib/server/login-cover";

type LoginCoverFormProps = {
  initialConfig: LoginCoverConfig;
};

export function LoginCoverForm({ initialConfig }: LoginCoverFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<"featured" | "custom">(initialConfig.mode);
  const [customUrl, setCustomUrl] = useState(initialConfig.customUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSave() {
    setError(null);
    setSuccess(false);

    const response = await fetch("/api/admin/login-cover", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode,
        customUrl: mode === "custom" ? customUrl || null : null,
      }),
    });

    if (!response.ok) {
      const result = (await response.json()) as { error?: string };
      setError(result.error || "保存失败");
      return;
    }

    setSuccess(true);
    setTimeout(() => setSuccess(false), 3000);
    startTransition(() => router.refresh());
  }

  return (
    <div className="studio-card rounded-[1.8rem] p-5 md:p-6">
      <h2 className="text-xl font-semibold text-[var(--ink)]">封面图来源</h2>
      <p className="mt-1 text-sm text-[var(--ink-soft)]">
        选择登录/注册页面左侧展示的图片来源。
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setMode("featured")}
          className={`flex flex-col items-start gap-3 rounded-2xl border p-5 text-left transition ${
            mode === "featured"
              ? "border-[var(--accent)] bg-[var(--accent)]/5 ring-1 ring-[var(--accent)]/30"
              : "border-[var(--line)] bg-white/60 hover:border-[var(--accent)]/50"
          }`}
        >
          <div className="flex size-10 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
            <Sparkles className="size-5" />
          </div>
          <div>
            <div className="font-medium text-[var(--ink)]">随机精选作品</div>
            <p className="mt-1 text-xs text-[var(--ink-soft)]">
              从首页精选作品中随机取一张展示，每次刷新不同。
            </p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setMode("custom")}
          className={`flex flex-col items-start gap-3 rounded-2xl border p-5 text-left transition ${
            mode === "custom"
              ? "border-[var(--accent)] bg-[var(--accent)]/5 ring-1 ring-[var(--accent)]/30"
              : "border-[var(--line)] bg-white/60 hover:border-[var(--accent)]/50"
          }`}
        >
          <div className="flex size-10 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
            <ImageIcon className="size-5" />
          </div>
          <div>
            <div className="font-medium text-[var(--ink)]">指定图片</div>
            <p className="mt-1 text-xs text-[var(--ink-soft)]">
              填入图片 URL，固定展示指定的图片。
            </p>
          </div>
        </button>
      </div>

      {mode === "custom" && (
        <div className="mt-5">
          <label className="block text-sm font-medium text-[var(--ink-soft)]">
            图片 URL
          </label>
          <input
            value={customUrl}
            onChange={(e) => setCustomUrl(e.target.value)}
            placeholder="https://example.com/cover.jpg"
            className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 text-sm outline-none transition focus:border-[var(--accent)]"
          />
          {customUrl && (
            <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--line)]">
              <p className="border-b border-[var(--line)] bg-white/60 px-4 py-2 text-xs text-[var(--ink-soft)]">
                预览
              </p>
              <div className="relative aspect-[3/4] max-h-80 bg-[var(--surface-strong)]">
                <img
                  src={customUrl}
                  alt="封面预览"
                  className="size-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          disabled={isPending}
          onClick={() => startTransition(handleSave)}
          className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-6 py-3 text-sm font-medium text-white shadow-lg transition hover:bg-[var(--accent)] disabled:opacity-60"
        >
          {isPending && <Loader2 className="size-4 animate-spin" />}
          {isPending ? "保存中..." : "保存配置"}
        </button>
        {success && (
          <span className="text-sm font-medium text-emerald-600">已保存</span>
        )}
        {error && <span className="text-sm text-rose-600">{error}</span>}
      </div>
    </div>
  );
}
