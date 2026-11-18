"use client";

import { ShieldCheck, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { cn } from "@/lib/utils";
import { useAdminToast } from "./hooks/use-admin-toast";
import { AdminSwitch } from "./ui/admin-switch";

type ShowcaseAutoApproveToggleProps = {
  initialValue: boolean;
};

export function ShowcaseAutoApproveToggle({
  initialValue,
}: ShowcaseAutoApproveToggleProps) {
  const router = useRouter();
  const toast = useAdminToast();
  const [autoApprove, setAutoApprove] = useState(initialValue);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleToggle(nextAutoApprove: boolean) {
    setError(null);

    const response = await fetch("/api/admin/benefits/showcase-config", {
      body: JSON.stringify({ autoApproveShowcase: nextAutoApprove }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    const result = (await response.json().catch(() => ({}))) as { error?: string };

    if (!response.ok) {
      const msg = result.error || "切换投稿审核模式失败";
      setError(msg);
      toast.error("配置更新失败", msg);
      return;
    }

    setAutoApprove(nextAutoApprove);
    toast.success(
      nextAutoApprove ? "已开启投稿自动公开" : "已恢复人工审核模式",
      nextAutoApprove
        ? "后续新投稿将直接进入公开精选画廊"
        : "后续新投稿需管理员审核通过后才会公开",
    );
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className="studio-card flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3.5">
        <div
          className={cn(
            "mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl border",
            autoApprove
              ? "border-amber-200 bg-amber-50 text-amber-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-700",
          )}
        >
          {autoApprove ? (
            <Sparkles className="size-5" aria-hidden />
          ) : (
            <ShieldCheck className="size-5" aria-hidden />
          )}
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-[var(--ink)] sm:text-base">
              投稿自动免审公开
            </h3>
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                autoApprove
                  ? "bg-amber-100 text-amber-800"
                  : "bg-emerald-100 text-emerald-800",
              )}
            >
              {autoApprove ? "自动公开中" : "需人工审核"}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-[var(--ink-soft)] sm:text-sm">
            {autoApprove
              ? "开启后，作者发起精选投稿将直接公开到首页画廊，跳过待审队列。"
              : "关闭时，作者发起精选投稿将进入「待审核」队列，由管理员把关后公开。"}
          </p>
          {error ? <p className="mt-1.5 text-xs text-rose-600">{error}</p> : null}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2.5">
        <span className="text-xs text-[var(--ink-soft)]">
          {autoApprove ? "已开启免审" : "已关闭免审"}
        </span>
        <AdminSwitch
          ariaLabel="投稿自动免审公开"
          checked={autoApprove}
          disabled={isPending}
          onCheckedChange={(next) => startTransition(() => void handleToggle(next))}
        />
      </div>
    </div>
  );
}
