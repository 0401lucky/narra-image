"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";

type CleanupFailedButtonProps = {
  failedCount: number;
};

export function CleanupFailedButton({ failedCount }: CleanupFailedButtonProps) {
  const router = useRouter();
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
        error?: string;
      };
      if (!response.ok) {
        setError(result.error || "清理失败，请稍后再试");
        return;
      }
      setShowConfirm(false);
      startTransition(() => {
        router.refresh();
      });
    } finally {
      setIsCleaning(false);
    }
  }

  return (
    <div className="studio-card flex flex-col gap-3 rounded-[1.4rem] p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm text-[var(--ink-soft)]">
        历史失败任务：
        <span className="ml-1 text-base font-semibold text-[var(--ink)]">
          {failedCount}
        </span>{" "}
        条。失败记录不会出现在列表中，可一次性物理清理。
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setError(null);
          setShowConfirm(true);
        }}
        className="inline-flex items-center justify-center gap-1.5 rounded-full border border-rose-200 px-4 py-2 text-sm font-medium text-rose-600 transition hover:border-rose-400 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Trash2 className="size-4" />
        清理 {failedCount} 条失败记录
      </button>

      {showConfirm ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={() => {
            if (!isCleaning) setShowConfirm(false);
          }}
        >
          <div
            className="studio-card w-full max-w-md rounded-[1.8rem] p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-[var(--ink)]">
              清理失败记录
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--ink-soft)]">
              将删除全部 {failedCount} 条 status=FAILED 的生成任务，操作不可撤销。是否继续？
            </p>
            {error ? (
              <p className="mt-3 text-sm text-rose-600">{error}</p>
            ) : null}
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={isCleaning}
                onClick={() => setShowConfirm(false)}
                className="rounded-full border border-[var(--line)] px-4 py-2 text-sm text-[var(--ink-soft)] disabled:opacity-60"
              >
                取消
              </button>
              <button
                type="button"
                disabled={isCleaning}
                onClick={() => void handleConfirm()}
                className="rounded-full bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-700 disabled:opacity-60"
              >
                {isCleaning ? "清理中..." : "确认清理"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
