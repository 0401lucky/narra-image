"use client";

/* eslint-disable @next/next/no-img-element */

import { CheckSquare, Expand, FileText, Film, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { ImageUnavailable } from "@/components/ui/image-unavailable";
import { ImageLightbox } from "@/components/works/image-lightbox";
import { PromptModal } from "@/components/works/prompt-modal";
import { WorkStatusBadge } from "@/components/works/work-showcase-controls";
import { getThumbUrl } from "@/lib/image-url";
import type { SerializedAdminWork } from "@/lib/prisma-mappers";
import { isImageAvailable } from "@/lib/storage/image-availability";
import { cn } from "@/lib/utils";
import type {
  AdminWorkReviewAction,
  WorkShowcaseStatus,
} from "@/lib/work-showcase";
import { getWorkShowcaseStatusLabel } from "@/lib/work-showcase";
import { useAdminToast } from "./hooks/use-admin-toast";
import { AdminConfirmDialog, AdminModal } from "./ui/admin-modal";

export type AdminReviewableWork = SerializedAdminWork & {
  durationSeconds?: number | null;
  mediaType?: "image" | "video";
  posterUrl?: string | null;
};

type SectionConfig = {
  description: string;
  empty: string;
  status: WorkShowcaseStatus;
  title: string;
};

const sections: SectionConfig[] = [
  {
    description: "审核用户发起的首页精选投稿。",
    empty: "当前没有待审核的投稿作品。",
    status: "PENDING",
    title: "待审核投稿",
  },
  {
    description: "处理作者发起的公开下架申请。",
    empty: "当前没有待处理的下架申请。",
    status: "TAKEDOWN_PENDING",
    title: "下架申请",
  },
  {
    description: "查看与管理当前正在精选画廊公开展示的作品。",
    empty: "当前没有公开展示中的作品。",
    status: "FEATURED",
    title: "公开中作品",
  },
];

function formatTime(value: string | null) {
  if (!value) return null;
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
      { action: "approve_feature" as const, label: "通过投稿", variant: "primary" as const },
      { action: "reject_feature" as const, label: "拒绝投稿", variant: "secondary" as const },
      { action: "force_takedown" as const, label: "强制下架", variant: "danger" as const },
    ];
  }
  if (status === "TAKEDOWN_PENDING") {
    return [
      { action: "approve_unfeature" as const, label: "确认下架", variant: "primary" as const },
      { action: "reject_unfeature" as const, label: "驳回下架", variant: "secondary" as const },
      { action: "force_takedown" as const, label: "强制下架", variant: "danger" as const },
    ];
  }
  if (status === "FEATURED") {
    return [
      { action: "force_takedown" as const, label: "强制下架", variant: "danger" as const },
    ];
  }
  return [];
}

function itemKey(work: AdminReviewableWork) {
  return `${work.mediaType ?? "image"}:${work.id}`;
}

type AdminWorksBoardProps = {
  activeStatus?: WorkShowcaseStatus;
  enableBatch?: boolean;
  works: AdminReviewableWork[];
};

export function AdminWorksBoard({
  activeStatus,
  enableBatch = false,
  works,
}: AdminWorksBoardProps) {
  const router = useRouter();
  const toast = useAdminToast();
  const [zoomedWorkKey, setZoomedWorkKey] = useState<string | null>(null);
  const [previewVideoWork, setPreviewVideoWork] = useState<AdminReviewableWork | null>(null);
  const [promptWork, setPromptWork] = useState<AdminReviewableWork | null>(null);
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [confirmTakedownWork, setConfirmTakedownWork] =
    useState<AdminReviewableWork | null>(null);

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [batchNote, setBatchNote] = useState("");
  const [batchBusy, setBatchBusy] = useState(false);
  const [confirmBatchAction, setConfirmBatchAction] =
    useState<AdminWorkReviewAction | null>(null);

  const currentZoomedWork = zoomedWorkKey
    ? works.find((work) => itemKey(work) === zoomedWorkKey)
    : null;

  const visibleSections = useMemo(() => {
    const filtered = activeStatus
      ? sections.filter((s) => s.status === activeStatus)
      : sections;
    return filtered.map((section) => ({
      ...section,
      items: works.filter((work) => work.showcaseStatus === section.status),
    }));
  }, [activeStatus, works]);

  const selectableWorks = useMemo(
    () => (activeStatus ? works.filter((w) => w.showcaseStatus === activeStatus) : works),
    [activeStatus, works],
  );

  const selectedItems = useMemo(
    () => selectableWorks.filter((w) => selectedKeys.has(itemKey(w))),
    [selectableWorks, selectedKeys],
  );

  const allSelected =
    selectableWorks.length > 0 && selectedItems.length === selectableWorks.length;

  function toggleOne(work: AdminReviewableWork) {
    const key = itemKey(work);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        selectableWorks.forEach((w) => next.delete(itemKey(w)));
      } else {
        selectableWorks.forEach((w) => next.add(itemKey(w)));
      }
      return next;
    });
  }

  async function handleReview(
    work: AdminReviewableWork,
    action: AdminWorkReviewAction,
  ) {
    const key = itemKey(work);
    setPendingKey(key);
    setErrors((current) => ({ ...current, [key]: null }));

    try {
      const response = await fetch(`/api/admin/works/${work.id}/review`, {
        body: JSON.stringify({
          action,
          mediaType: work.mediaType ?? "image",
          reviewNote: draftNotes[key] || null,
        }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        const msg = result.error || "处理失败，请稍后再试";
        setErrors((current) => ({ ...current, [key]: msg }));
        toast.error("作品审核操作失败", msg);
        return false;
      }

      toast.success("审核操作已完成");
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      router.refresh();
      return true;
    } finally {
      setPendingKey(null);
    }
  }

  async function executeBatchReview(action: AdminWorkReviewAction) {
    if (selectedItems.length === 0) return;
    setBatchBusy(true);
    try {
      const res = await fetch("/api/admin/works/batch-review", {
        body: JSON.stringify({
          action,
          items: selectedItems.map((item) => ({
            id: item.id,
            mediaType: item.mediaType ?? "image",
          })),
          reviewNote: batchNote.trim() || null,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const json = (await res.json().catch(() => ({}))) as {
        data?: { skippedCount?: number; updatedCount?: number };
        error?: string;
      };
      if (!res.ok || !json.data) {
        toast.error("批量审核失败", json.error || "请稍后再试");
        return;
      }
      const { updatedCount = 0, skippedCount = 0 } = json.data;
      toast.success(
        `已批量处理 ${updatedCount} 件作品`,
        skippedCount > 0 ? `${skippedCount} 件因状态已变更自动跳过` : undefined,
      );
      setSelectedKeys(new Set());
      setBatchNote("");
      setConfirmBatchAction(null);
      router.refresh();
    } finally {
      setBatchBusy(false);
    }
  }

  const batchButtons = activeStatus ? getActionButtons(activeStatus) : [];

  return (
    <>
      {enableBatch && activeStatus && selectableWorks.length > 0 ? (
        <div className="studio-card flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={toggleAll}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-white px-3.5 py-1.5 text-xs font-semibold text-[var(--ink)] transition hover:border-[#c85a32] hover:text-[#c85a32]"
            >
              <CheckSquare className="size-3.5" aria-hidden />
              {allSelected ? "取消全选" : "全选本页"}
            </button>
            <span className="text-xs text-[var(--ink-soft)]">
              已选{" "}
              <strong className="font-mono text-[var(--ink)]">
                {selectedItems.length}
              </strong>{" "}
              / {selectableWorks.length} 件
            </span>
          </div>

          <div className="flex flex-1 flex-wrap items-center gap-2 lg:justify-end">
            <input
              type="text"
              value={batchNote}
              onChange={(e) => setBatchNote(e.target.value)}
              placeholder="批量审核备注（可选，写入所选作品）…"
              className="min-w-[200px] flex-1 rounded-xl border border-[var(--line)] bg-white px-3.5 py-1.5 text-xs outline-none lg:max-w-xs"
            />
            {batchButtons.map((btn) => (
              <button
                key={btn.action}
                type="button"
                disabled={selectedItems.length === 0 || batchBusy}
                onClick={() => {
                  if (btn.variant === "danger") {
                    setConfirmBatchAction(btn.action);
                  } else {
                    void executeBatchReview(btn.action);
                  }
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-45",
                  btn.variant === "primary" &&
                    "bg-[#231810] text-white hover:bg-[#c85a32]",
                  btn.variant === "secondary" &&
                    "border border-[var(--line)] bg-white text-[var(--ink)] hover:border-[#c85a32] hover:text-[#c85a32]",
                  btn.variant === "danger" &&
                    "border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100",
                )}
              >
                {batchBusy ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : null}
                批量{btn.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-6">
        {visibleSections.map((section) => (
          <section key={section.status} className="grid gap-4">
            {!activeStatus ? (
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-[var(--ink)]">
                    {section.title}
                  </h2>
                  <p className="mt-0.5 text-xs text-[var(--ink-soft)] sm:text-sm">
                    {section.description}
                  </p>
                </div>
                <span className="rounded-full border border-[var(--line)] bg-white px-3.5 py-1 font-mono text-xs font-semibold text-[var(--ink-soft)]">
                  {section.items.length} 件
                </span>
              </div>
            ) : null}

            {section.items.length === 0 ? (
              <div className="studio-card border border-dashed p-8 text-center text-sm text-[var(--ink-soft)]">
                {section.empty}
              </div>
            ) : (
              <div className="grid gap-4 xl:grid-cols-2">
                {section.items.map((work) => {
                  const key = itemKey(work);
                  const isVideo = work.mediaType === "video";
                  const checked = selectedKeys.has(key);
                  const actions = getActionButtons(work.showcaseStatus);
                  const isItemBusy = pendingKey === key;

                  return (
                    <article
                      key={key}
                      className={cn(
                        "studio-card grid gap-4 p-5 transition",
                        checked && "ring-2 ring-[#c85a32]/35",
                      )}
                    >
                      <div className="flex gap-4">
                        {enableBatch ? (
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleOne(work)}
                            aria-label={`选择作品 ${work.id}`}
                            className="mt-2 size-4 shrink-0 rounded accent-[#c85a32]"
                          />
                        ) : null}

                        {isVideo ? (
                          <button
                            type="button"
                            onClick={() => setPreviewVideoWork(work)}
                            className="group relative flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-violet-200 bg-violet-50 text-violet-700 sm:size-32"
                            aria-label="预览视频作品"
                          >
                            {work.posterUrl ? (
                              <img
                                src={getThumbUrl(work.posterUrl, 256)}
                                alt="视频作品封面"
                                loading="lazy"
                                decoding="async"
                                className="size-full object-cover transition duration-300 group-hover:scale-[1.04]"
                              />
                            ) : (
                              <Film className="size-8" aria-hidden />
                            )}
                            <span className="absolute bottom-2 left-2 rounded-md bg-black/65 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white">
                              视频{work.durationSeconds ? ` ${work.durationSeconds}s` : ""}
                            </span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={!isImageAvailable(work.availability)}
                            onClick={() => setZoomedWorkKey(key)}
                            className="group relative shrink-0 overflow-hidden rounded-2xl border border-[var(--line)] bg-[#f4ede1]"
                          >
                            {isImageAvailable(work.availability) ? (
                              <img
                                src={getThumbUrl(work.url, 256)}
                                alt="作品缩略图"
                                loading="lazy"
                                decoding="async"
                                className="size-28 object-cover transition duration-300 group-hover:scale-[1.04] sm:size-32"
                              />
                            ) : (
                              <ImageUnavailable
                                availability={work.availability}
                                className="size-28 sm:size-32"
                              />
                            )}
                            <span className="absolute top-2 right-2 rounded-full bg-black/55 p-1.5 text-white opacity-0 transition group-hover:opacity-100">
                              <Expand className="size-3.5" aria-hidden />
                            </span>
                          </button>
                        )}

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <WorkStatusBadge status={work.showcaseStatus} />
                            {isVideo ? (
                              <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-800">
                                视频投稿
                              </span>
                            ) : null}
                            <span className="truncate font-mono text-xs text-[var(--ink-soft)]">
                              {work.author.email}
                            </span>
                          </div>

                          <p className="mt-2.5 line-clamp-3 text-sm leading-relaxed text-[var(--ink)]">
                            {work.prompt}
                          </p>

                          <div className="mt-2.5 flex flex-wrap gap-1.5 text-xs text-[var(--ink-soft)]">
                            <span className="rounded-md bg-[#f4ede1] px-2.5 py-0.5 font-mono">
                              {work.model}
                            </span>
                            <span className="rounded-md bg-[#f4ede1] px-2.5 py-0.5 font-mono">
                              {work.size}
                            </span>
                            <span className="rounded-md bg-[#f4ede1] px-2.5 py-0.5">
                              提示词{work.showPromptPublic ? "公开" : "隐藏"}
                            </span>
                          </div>

                          <div className="mt-2.5 flex flex-wrap gap-3 font-mono text-[11px] text-[var(--ink-soft)]">
                            {work.submittedAt ? (
                              <span>投稿：{formatTime(work.submittedAt)}</span>
                            ) : null}
                            {work.featuredAt ? (
                              <span>公开：{formatTime(work.featuredAt)}</span>
                            ) : null}
                            {work.reviewedAt ? (
                              <span>审核：{formatTime(work.reviewedAt)}</span>
                            ) : null}
                          </div>

                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => setPromptWork(work)}
                              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-white px-3 py-1 text-xs font-medium text-[var(--ink)] transition hover:border-[#c85a32] hover:text-[#c85a32]"
                            >
                              <FileText className="size-3.5" aria-hidden />
                              完整提示词
                            </button>
                            {!isVideo && work.showcaseStatus === "FEATURED" ? (
                              <Link
                                href={`/works/${work.id}`}
                                className="rounded-full border border-[var(--line)] bg-white px-3 py-1 text-xs font-medium text-[var(--ink)] transition hover:border-[#c85a32] hover:text-[#c85a32]"
                              >
                                查看公开页
                              </Link>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      {actions.length > 0 ? (
                        <div className="grid gap-3 rounded-xl border border-[var(--line)] bg-[#faf7f1] p-3.5">
                          <label className="grid gap-1.5">
                            <span className="text-xs font-medium text-[var(--ink-soft)]">
                              审核备注（可选）
                            </span>
                            <input
                              type="text"
                              value={draftNotes[key] ?? ""}
                              onChange={(event) =>
                                setDraftNotes((current) => ({
                                  ...current,
                                  [key]: event.target.value,
                                }))
                              }
                              placeholder={
                                work.showcaseStatus === "PENDING"
                                  ? "填写通过说明或拒绝原因…"
                                  : "填写下架审核备注…"
                              }
                              className="rounded-xl border border-[var(--line)] bg-white px-3.5 py-2 text-xs outline-none sm:text-sm"
                            />
                          </label>

                          <div className="flex flex-wrap gap-2">
                            {actions.map((button) => {
                              const isDanger = button.variant === "danger";
                              const isPrimary = button.variant === "primary";
                              return (
                                <button
                                  key={button.action}
                                  type="button"
                                  disabled={isItemBusy}
                                  onClick={() => {
                                    if (isDanger) {
                                      setConfirmTakedownWork(work);
                                    } else {
                                      void handleReview(work, button.action);
                                    }
                                  }}
                                  className={cn(
                                    "rounded-full px-4 py-1.5 text-xs font-semibold transition disabled:opacity-60 sm:text-sm",
                                    isDanger &&
                                      "border border-rose-200 bg-white text-rose-600 hover:bg-rose-50",
                                    isPrimary &&
                                      "bg-[#231810] text-white hover:bg-[#c85a32]",
                                    !isDanger &&
                                      !isPrimary &&
                                      "border border-[var(--line)] bg-white text-[var(--ink)] hover:border-[#c85a32] hover:text-[#c85a32]",
                                  )}
                                >
                                  {isItemBusy ? "处理中…" : button.label}
                                </button>
                              );
                            })}
                          </div>

                          {errors[key] ? (
                            <p className="text-xs text-rose-600">{errors[key]}</p>
                          ) : null}
                        </div>
                      ) : (
                        <div className="rounded-xl border border-[var(--line)] bg-[#faf7f1] px-3.5 py-2.5 text-xs text-[var(--ink-soft)]">
                          当前状态：{getWorkShowcaseStatusLabel(work.showcaseStatus)}。
                          {work.reviewNote
                            ? ` 最近审核备注：${work.reviewNote}`
                            : " 暂无额外审核备注。"}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        ))}
      </div>

      {currentZoomedWork &&
      currentZoomedWork.mediaType !== "video" &&
      isImageAvailable(currentZoomedWork.availability) ? (
        <ImageLightbox
          src={currentZoomedWork.url}
          onClose={() => setZoomedWorkKey(null)}
        />
      ) : null}

      {previewVideoWork ? (
        <AdminModal
          open
          onClose={() => setPreviewVideoWork(null)}
          size="lg"
          eyebrow="VIDEO REVIEW"
          title="视频作品审核预览"
          description={`作者：${previewVideoWork.author.email} · 模型：${previewVideoWork.model}`}
        >
          <video
            src={previewVideoWork.url}
            poster={previewVideoWork.posterUrl ?? undefined}
            controls
            autoPlay
            playsInline
            className="max-h-[68vh] w-full rounded-xl bg-black"
          />
        </AdminModal>
      ) : null}

      {promptWork ? (
        <PromptModal
          prompt={promptWork.prompt}
          negativePrompt={promptWork.negativePrompt}
          onClose={() => setPromptWork(null)}
        />
      ) : null}

      <AdminConfirmDialog
        open={confirmTakedownWork !== null}
        onClose={() => {
          if (!confirmTakedownWork || pendingKey !== itemKey(confirmTakedownWork)) {
            setConfirmTakedownWork(null);
          }
        }}
        onConfirm={() => {
          if (!confirmTakedownWork) return;
          const target = confirmTakedownWork;
          void handleReview(target, "force_takedown").then((ok) => {
            if (ok) {
              setConfirmTakedownWork((cur) =>
                cur && itemKey(cur) === itemKey(target) ? null : cur,
              );
            }
          });
        }}
        busy={
          confirmTakedownWork !== null &&
          pendingKey === itemKey(confirmTakedownWork)
        }
        tone="danger"
        title="强制下架作品"
        description="作品将被立即撤回至私有（PRIVATE）状态，不再在公开画廊展示；下架理由会写入作品审核备注。"
        confirmLabel="确认强制下架"
        error={
          confirmTakedownWork ? errors[itemKey(confirmTakedownWork)] : null
        }
      >
        {confirmTakedownWork ? (
          <div className="grid gap-1.5 rounded-xl border border-[var(--line)] bg-[#f8f4ec] p-3 text-xs text-[var(--ink-soft)]">
            <div>作者：{confirmTakedownWork.author.email}</div>
            <div>
              当前状态：{getWorkShowcaseStatusLabel(confirmTakedownWork.showcaseStatus)}
            </div>
            <div className="line-clamp-2 text-[var(--ink)]">
              提示词：{confirmTakedownWork.prompt}
            </div>
          </div>
        ) : null}
      </AdminConfirmDialog>

      <AdminConfirmDialog
        open={confirmBatchAction !== null}
        onClose={() => {
          if (!batchBusy) setConfirmBatchAction(null);
        }}
        onConfirm={() => {
          if (confirmBatchAction) void executeBatchReview(confirmBatchAction);
        }}
        busy={batchBusy}
        tone="danger"
        title={`批量强制下架 ${selectedItems.length} 件作品`}
        description="所选作品将全部撤回至私有（PRIVATE）状态，不再在公开精选画廊展示。"
        confirmLabel={batchBusy ? "下架中…" : "确认批量下架"}
      />
    </>
  );
}
