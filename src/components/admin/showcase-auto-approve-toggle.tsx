"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ShieldCheck, ShieldOff } from "lucide-react";

export function ShowcaseAutoApproveToggle({
  initialValue,
}: {
  initialValue: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialValue);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleToggle() {
    setError(null);
    const newValue = !enabled;

    const response = await fetch("/api/admin/benefits/showcase-config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autoApproveShowcase: newValue }),
    });
    const result = (await response.json()) as { error?: string };

    if (!response.ok) {
      setError(result.error || "操作失败");
      return;
    }

    setEnabled(newValue);
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className="studio-card flex flex-col gap-3 rounded-[1.6rem] p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl ${
            enabled
              ? "bg-emerald-500/10 text-emerald-600"
              : "bg-[var(--surface-strong)] text-[var(--ink-soft)]"
          }`}
        >
          {enabled ? (
            <ShieldOff className="size-5" />
          ) : (
            <ShieldCheck className="size-5" />
          )}
        </div>
        <div>
          <h3 className="font-medium text-[var(--ink)]">
            投稿审核{enabled ? "已关闭" : "已开启"}
          </h3>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            {enabled
              ? "作者投稿后直接公开到首页，无需管理员审核。"
              : "作者投稿后需管理员手动审核通过才会公开。"}
          </p>
        </div>
      </div>

      <button
        type="button"
        disabled={isPending}
        onClick={() => startTransition(handleToggle)}
        className={`shrink-0 rounded-full px-5 py-2.5 text-sm font-medium transition disabled:opacity-60 ${
          enabled
            ? "border border-emerald-200 text-emerald-700 hover:bg-emerald-50"
            : "bg-[var(--ink)] text-white hover:bg-[var(--accent)]"
        }`}
      >
        {isPending
          ? "切换中…"
          : enabled
            ? "开启审核"
            : "关闭审核"}
      </button>

      {error && <p className="text-sm text-rose-600">{error}</p>}
    </div>
  );
}
