"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useAdminToast } from "./hooks/use-admin-toast";
import { AdminConfirmDialog } from "./ui/admin-modal";

type CleanupFailedButtonProps = {
  failedCount: number;
};

export function CleanupFailedButton({ failedCount }: CleanupFailedButtonProps) {
  const router = useRouter();
  const toast = useAdminToast();
  const [isPending, startTransition] = useTransition();
  const [isCleaning, setIsCleaning] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disabled = failedCount === 0 || isCleaning || isPending;

  async function handleConfirm() {
    setError(null);
    setIsCleaning(true);
    try {
      const response = await fetch("/api/admin/generations/cleanup-failed", {
        method: "POST",
      });
      const result = (await response.json().catch(() => ({}))) as {
        data?: { deleted?: number };
        error?: string;
      };
      if (!response.ok) {
        const msg = result.error || "清理失败，请稍后再试";
        setError(msg);
        toast.error("清理失败记录未成功", msg);
        return;
      }
      setShowConfirm(false);
      toast.success(
        "历史失败记录已清理",
        result.data?.deleted !== undefined
          ? `共物理移除 ${result.data.deleted} 条可清理失败任务`
          : undefined,
      );
      startTransition(() => {
        router.refresh();
      });
    } finally {
      setIsCleaning(false);
    }
  }

  return (
    <>
      <div className="studio-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-[var(--ink-soft)]">
          可清理历史失败任务：
          <span className="mx-1 font-mono text-base font-semibold tabular-nums text-[var(--ink)]">
            {failedCount}
          </span>
          条（普通失败记录默认折叠，契约协调任务受保护不会被误删）。
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setError(null);
            setShowConfirm(true);
          }}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border border-rose-200 bg-white px-4 py-2 text-xs font-semibold text-rose-600 transition hover:border-rose-400 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Trash2 className="size-3.5" aria-hidden />
          清理 {failedCount} 条失败记录
        </button>
      </div>

      <AdminConfirmDialog
        open={showConfirm}
        onClose={() => {
          if (!isCleaning) setShowConfirm(false);
        }}
        onConfirm={() => void handleConfirm()}
        busy={isCleaning}
        tone="danger"
        title="清理历史失败记录"
        description={`将物理删除全部 ${failedCount} 条可清理的 status=FAILED 旧任务，操作不可撤销。v1 契约任务及含重试证据的记录会自动跳过保留。`}
        confirmLabel={isCleaning ? "清理中…" : "确认清理"}
        error={error}
      />
    </>
  );
}
