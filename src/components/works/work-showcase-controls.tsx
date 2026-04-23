"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { SerializedWork } from "@/lib/prisma-mappers";
import {
  getWorkShowcaseStatusLabel,
  type WorkShowcaseStatus,
} from "@/lib/work-showcase";

const statusToneClasses: Record<WorkShowcaseStatus, string> = {
  PRIVATE: "border-[var(--line)] bg-[var(--surface-strong)]/60 text-[var(--ink-soft)]",
  PENDING: "border-amber-200 bg-amber-50 text-amber-700",
  FEATURED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  TAKEDOWN_PENDING: "border-orange-200 bg-orange-50 text-orange-700",
};

function formatWorkTime(value: string | null) {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "numeric",
  }).format(new Date(value));
}

function getStatusHint(work: SerializedWork) {
  if (work.showcaseStatus === "PRIVATE" && work.reviewedAt && work.submittedAt) {
    return work.reviewNote || "本次投稿未通过审核，你可以调整后重新投稿。";
  }

  if (work.showcaseStatus === "PRIVATE" && work.reviewNote) {
    return work.reviewNote;
  }

  if (work.showcaseStatus === "PENDING") {
    return `投稿已提交${work.submittedAt ? `，提交时间 ${formatWorkTime(work.submittedAt)}` : ""}。`;
  }

  if (work.showcaseStatus === "FEATURED") {
    return `作品已公开${work.featuredAt ? `，公开时间 ${formatWorkTime(work.featuredAt)}` : ""}。公开页统一显示为匿名创作者。`;
  }

  if (work.showcaseStatus === "TAKEDOWN_PENDING") {
    return "下架申请已提交，等待管理员处理。";
  }

  return "作品当前仅自己可见，投稿通过后才会出现在首页和公开详情页。";
}

export function WorkStatusBadge({ status }: { status: WorkShowcaseStatus }) {
  return (
    <span
      className={`rounded-full border px-3 py-1 text-xs font-medium ${statusToneClasses[status]}`}
    >
      {getWorkShowcaseStatusLabel(status)}
    </span>
  );
}

type WorkShowcaseControlsProps = {
  compact?: boolean;
  work: SerializedWork;
};

export function WorkShowcaseControls({
  compact = false,
  work,
}: WorkShowcaseControlsProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [showPromptPublic, setShowPromptPublic] = useState(work.showPromptPublic);

  async function handleAction(
    action: "request_unfeature" | "submit" | "withdraw",
    options?: { showPromptPublic?: boolean },
  ) {
    setError(null);
    setIsPending(true);

    try {
      const response = await fetch(`/api/me/works/${work.id}/showcase`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action,
          showPromptPublic: options?.showPromptPublic,
        }),
      });
      const result = (await response.json()) as {
        error?: string;
      };

      if (!response.ok) {
        setError(result.error || "操作失败，请稍后再试");
        return;
      }

      setShowSubmitModal(false);
      router.refresh();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <>
      <div className={`grid gap-3 ${compact ? "" : "rounded-[1.4rem] border border-[var(--line)] bg-[var(--surface-strong)]/30 p-4"}`}>
        <div className="flex flex-wrap items-center gap-2">
          <WorkStatusBadge status={work.showcaseStatus} />
          <span className="text-xs text-[var(--ink-soft)]">{getStatusHint(work)}</span>
        </div>

        {work.showcaseStatus === "FEATURED" ? (
          <p className="text-xs text-[var(--ink-soft)]">
            当前完整提示词{work.showPromptPublic ? "对外公开" : "对外隐藏"}。
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {work.showcaseStatus === "PRIVATE" ? (
            <button
              type="button"
              disabled={isPending}
              onClick={() => setShowSubmitModal(true)}
              className="rounded-full bg-[var(--ink)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--accent)] disabled:opacity-60"
            >
              {isPending ? "处理中..." : "投稿首页"}
            </button>
          ) : null}

          {work.showcaseStatus === "PENDING" ? (
            <button
              type="button"
              disabled={isPending}
              onClick={() => void handleAction("withdraw")}
              className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-medium text-[var(--ink)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-60"
            >
              {isPending ? "处理中..." : "撤回投稿"}
            </button>
          ) : null}

          {work.showcaseStatus === "FEATURED" ? (
            <button
              type="button"
              disabled={isPending}
              onClick={() => void handleAction("request_unfeature")}
              className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-medium text-[var(--ink)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-60"
            >
              {isPending ? "处理中..." : "申请下架"}
            </button>
          ) : null}
        </div>

        {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      </div>

      {showSubmitModal ? (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={() => setShowSubmitModal(false)}
        >
          <div
            className="studio-card w-full max-w-lg rounded-[1.8rem] p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-[var(--ink)]">投稿首页精选</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--ink-soft)]">
              投稿通过后，作品会出现在首页和公开详情页，公开页统一显示为匿名创作者。
            </p>

            <label className="mt-5 flex items-start gap-3 rounded-[1.2rem] border border-[var(--line)] bg-[var(--surface-strong)]/40 px-4 py-4 text-sm text-[var(--ink)]">
              <input
                type="checkbox"
                checked={showPromptPublic}
                onChange={(event) => setShowPromptPublic(event.target.checked)}
                className="mt-0.5 rounded border-[var(--line)]"
              />
              <span>允许公开页面显示完整提示词</span>
            </label>

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowSubmitModal(false)}
                className="rounded-full border border-[var(--line)] px-4 py-2 text-sm text-[var(--ink-soft)]"
              >
                取消
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() =>
                  void handleAction("submit", {
                    showPromptPublic,
                  })
                }
                className="rounded-full bg-[var(--ink)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--accent)] disabled:opacity-60"
              >
                {isPending ? "提交中..." : "确认投稿"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
