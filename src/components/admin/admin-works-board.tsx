"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useMemo, useState } from "react";
import { Expand, FileText } from "lucide-react";
import { useRouter } from "next/navigation";

import type { SerializedAdminWork } from "@/lib/prisma-mappers";
import type { AdminWorkReviewAction, WorkShowcaseStatus } from "@/lib/work-showcase";
import { getWorkShowcaseStatusLabel } from "@/lib/work-showcase";
import { ImageLightbox } from "@/components/works/image-lightbox";
import { PromptModal } from "@/components/works/prompt-modal";
import { WorkStatusBadge } from "@/components/works/work-showcase-controls";

type SectionConfig = {
  empty: string;
  status: WorkShowcaseStatus;
  title: string;
};

const sections: SectionConfig[] = [
  {
    empty: "还没有待审核投稿。",
    status: "PENDING",
    title: "投稿审核",
  },
  {
    empty: "还没有待处理的下架申请。",
    status: "TAKEDOWN_PENDING",
    title: "下架申请",
  },
  {
    empty: "当前没有公开中的作品。",
    status: "FEATURED",
    title: "已公开作品",
  },
];

function formatTime(value: string | null) {
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

function getActionButtons(status: WorkShowcaseStatus) {
  if (status === "PENDING") {
    return [
      { action: "approve_feature" as const, label: "通过投稿" },
      { action: "reject_feature" as const, label: "拒绝投稿" },
    ];
  }

  if (status === "TAKEDOWN_PENDING") {
    return [
      { action: "approve_unfeature" as const, label: "确认下架" },
      { action: "reject_unfeature" as const, label: "拒绝下架" },
    ];
  }

  return [];
}

export function AdminWorksBoard({ works }: { works: SerializedAdminWork[] }) {
  const router = useRouter();
  const [zoomedWork, setZoomedWork] = useState<SerializedAdminWork | null>(null);
  const [promptWork, setPromptWork] = useState<SerializedAdminWork | null>(null);
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});
  const [pendingWorkId, setPendingWorkId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  const groupedWorks = useMemo(
    () =>
      sections.map((section) => ({
        ...section,
        items: works.filter((work) => work.showcaseStatus === section.status),
      })),
    [works],
  );

  async function handleReview(workId: string, action: AdminWorkReviewAction) {
    setPendingWorkId(workId);
    setErrors((current) => ({
      ...current,
      [workId]: null,
    }));

    try {
      const response = await fetch(`/api/admin/works/${workId}/review`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action,
          reviewNote: draftNotes[workId] || null,
        }),
      });
      const result = (await response.json()) as {
        error?: string;
      };

      if (!response.ok) {
        setErrors((current) => ({
          ...current,
          [workId]: result.error || "处理失败，请稍后再试",
        }));
        return;
      }

      router.refresh();
    } finally {
      setPendingWorkId(null);
    }
  }

  return (
    <>
      <div className="grid gap-6">
        {groupedWorks.map((section) => (
          <section key={section.status} className="grid gap-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-semibold text-[var(--ink)]">{section.title}</h2>
                <p className="mt-1 text-sm text-[var(--ink-soft)]">
                  {section.status === "PENDING"
                    ? "审核用户发起的首页精选投稿。"
                    : section.status === "TAKEDOWN_PENDING"
                      ? "处理作者发起的下架申请。"
                      : "查看当前公开中的作品。"}
                </p>
              </div>
              <div className="rounded-full border border-[var(--line)] px-4 py-2 text-sm text-[var(--ink-soft)]">
                {section.items.length} 件
              </div>
            </div>

            {section.items.length === 0 ? (
              <div className="studio-card rounded-[1.8rem] border border-dashed border-[var(--line)] p-8 text-sm text-[var(--ink-soft)]">
                {section.empty}
              </div>
            ) : (
              <div className="grid gap-4 xl:grid-cols-2">
                {section.items.map((work) => (
                  <article key={work.id} className="studio-card grid gap-4 rounded-[1.8rem] p-5">
                    <div className="flex gap-4">
                      <button
                        type="button"
                        onClick={() => setZoomedWork(work)}
                        className="group relative shrink-0 overflow-hidden rounded-[1.3rem] border border-[var(--line)]"
                      >
                        <img
                          src={work.url}
                          alt="作品缩略图"
                          className="size-32 object-cover transition duration-500 group-hover:scale-[1.04]"
                        />
                        <span className="absolute right-2 top-2 rounded-full bg-black/55 p-1.5 text-white opacity-0 transition group-hover:opacity-100">
                          <Expand className="size-4" />
                        </span>
                      </button>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <WorkStatusBadge status={work.showcaseStatus} />
                          <span className="text-xs text-[var(--ink-soft)]">
                            作者：{work.author.email}
                          </span>
                        </div>

                        <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-[var(--ink)]">
                          {work.prompt}
                        </p>

                        <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--ink-soft)]">
                          <span className="rounded-full bg-[var(--surface-strong)] px-3 py-1">{work.model}</span>
                          <span className="rounded-full bg-[var(--surface-strong)] px-3 py-1">{work.size}</span>
                          <span className="rounded-full bg-[var(--surface-strong)] px-3 py-1">
                            提示词{work.showPromptPublic ? "公开" : "隐藏"}
                          </span>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-3 text-xs text-[var(--ink-soft)]">
                          {work.submittedAt ? <span>投稿：{formatTime(work.submittedAt)}</span> : null}
                          {work.featuredAt ? <span>公开：{formatTime(work.featuredAt)}</span> : null}
                          {work.reviewedAt ? <span>最近审核：{formatTime(work.reviewedAt)}</span> : null}
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setPromptWork(work)}
                            className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-3 py-1.5 text-sm text-[var(--ink)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                          >
                            <FileText className="size-4" />
                            完整提示词
                          </button>
                          {work.showcaseStatus === "FEATURED" ? (
                            <Link
                              href={`/works/${work.id}`}
                              className="rounded-full border border-[var(--line)] px-3 py-1.5 text-sm text-[var(--ink)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                            >
                              查看公开页
                            </Link>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    {getActionButtons(work.showcaseStatus).length > 0 ? (
                      <div className="grid gap-3 rounded-[1.4rem] border border-[var(--line)] bg-[var(--surface-strong)]/30 p-4">
                        <label className="grid gap-2">
                          <span className="text-sm font-medium text-[var(--ink)]">
                            审核备注
                          </span>
                          <textarea
                            value={draftNotes[work.id] ?? ""}
                            onChange={(event) =>
                              setDraftNotes((current) => ({
                                ...current,
                                [work.id]: event.target.value,
                              }))
                            }
                            placeholder={
                              work.showcaseStatus === "PENDING"
                                ? "可选：填写通过说明或拒绝原因"
                                : "可选：填写下架审核备注"
                            }
                            className="min-h-24 rounded-[1.1rem] border border-[var(--line)] bg-white/80 px-4 py-3 text-sm outline-none transition focus:border-[var(--accent)]"
                          />
                        </label>

                        <div className="flex flex-wrap gap-2">
                          {getActionButtons(work.showcaseStatus).map((button) => (
                            <button
                              key={button.action}
                              type="button"
                              disabled={pendingWorkId === work.id}
                              onClick={() => void handleReview(work.id, button.action)}
                              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                                button.action.startsWith("approve")
                                  ? "bg-[var(--ink)] text-white hover:bg-[var(--accent)]"
                                  : "border border-[var(--line)] text-[var(--ink)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                              } disabled:opacity-60`}
                            >
                              {pendingWorkId === work.id ? "处理中..." : button.label}
                            </button>
                          ))}
                        </div>

                        {errors[work.id] ? (
                          <p className="text-sm text-rose-600">{errors[work.id]}</p>
                        ) : null}
                      </div>
                    ) : (
                      <div className="rounded-[1.4rem] border border-[var(--line)] bg-[var(--surface-strong)]/30 px-4 py-3 text-sm text-[var(--ink-soft)]">
                        当前状态：{getWorkShowcaseStatusLabel(work.showcaseStatus)}。
                        {work.reviewNote ? ` 最近审核备注：${work.reviewNote}` : " 暂无额外审核备注。"}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>

      {zoomedWork ? (
        <ImageLightbox src={zoomedWork.url} onClose={() => setZoomedWork(null)} />
      ) : null}

      {promptWork ? (
        <PromptModal
          prompt={promptWork.prompt}
          negativePrompt={promptWork.negativePrompt}
          onClose={() => setPromptWork(null)}
        />
      ) : null}
    </>
  );
}
