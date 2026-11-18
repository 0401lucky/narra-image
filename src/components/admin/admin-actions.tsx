"use client";

/* eslint-disable @next/next/no-img-element */

import type {
  GeneratedVideo,
  GenerationImage,
  GenerationJob,
  User,
} from "@prisma/client";
import {
  Check,
  Copy,
  Download,
  Eye,
  FileSearch,
  FileText,
  Film,
  ImageIcon,
  Loader2,
  Minus,
  Plus,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

import { Alert } from "@/components/ui/alert";
import { downloadImage } from "@/components/works/download-image";
import { ImageLightbox } from "@/components/works/image-lightbox";
import { PromptModal } from "@/components/works/prompt-modal";
import { getThumbUrl } from "@/lib/image-url";
import {
  getImageAvailability,
  imageUnavailableMessage,
  type ImageAvailabilitySource,
} from "@/lib/storage/image-availability";
import type { ImageAvailability } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useAdminToast } from "./hooks/use-admin-toast";
import { AdminConfirmDialog, AdminModal } from "./ui/admin-modal";
import { AdminSwitch } from "./ui/admin-switch";

export type GenerationAdminJob = GenerationJob & {
  images: Array<
    GenerationImage &
      ImageAvailabilitySource & { availability?: ImageAvailability }
  >;
  user: Pick<User, "email" | "nickname">;
  videos?: GeneratedVideo[];
};

type AdminImagePreview = { id: string | null; url: string };

function adminImageAvailability(image: GenerationAdminJob["images"][number]) {
  return image.availability ?? getImageAvailability(image);
}

function getUserDisplayName(user: GenerationAdminJob["user"] | null | undefined) {
  return user?.nickname?.trim() || user?.email || "未知用户";
}

export function isGenerationCoordinationRequired(job: GenerationAdminJob) {
  return (
    job.contractVersion >= 1 &&
    (job.handoffState === "UNKNOWN" || job.errorCode === "HANDOFF_UNKNOWN")
  );
}

export function getGenerationStatusBadge(job: GenerationAdminJob): {
  className: string;
  label: string;
} {
  if (isGenerationCoordinationRequired(job)) {
    return {
      className: "border-amber-300 bg-amber-50 text-amber-800",
      label: "需人工协调",
    };
  }
  if (job.status === "PENDING" || job.status === "PROCESSING") {
    return {
      className: "border-sky-200 bg-sky-50 text-sky-800",
      label: "生成中",
    };
  }
  if (job.status === "FAILED") {
    return {
      className: "border-rose-200 bg-rose-50 text-rose-700",
      label: "已失败",
    };
  }
  return {
    className: "border-emerald-200 bg-emerald-50 text-emerald-800",
    label: "已完成",
  };
}

function isVideoJob(job: GenerationAdminJob) {
  return (
    job.generationType === "TEXT_TO_VIDEO" ||
    job.generationType === "IMAGE_TO_VIDEO"
  );
}

function getMissingMediaLabel(job: GenerationAdminJob) {
  const image = job.images[0];
  if (image && adminImageAvailability(image) !== "available") {
    return imageUnavailableMessage(adminImageAvailability(image));
  }
  if (isGenerationCoordinationRequired(job)) return "待协调";
  if (job.status === "PENDING" || job.status === "PROCESSING") return "生成中";
  if (job.status === "FAILED") return "已失败";
  return isVideoJob(job) ? "视频缺失" : "图片缺失";
}

function readableAdminImage(job: GenerationAdminJob) {
  return job.images.find(
    (image) => adminImageAvailability(image) === "available" && image.url,
  );
}

function readableAdminVideo(job: GenerationAdminJob) {
  return job.videos?.find((video) => Boolean(video.url));
}

export function getCreditLabel(job: GenerationAdminJob) {
  if (isGenerationCoordinationRequired(job)) {
    return job.creditsSpent > 0
      ? `保留 ${job.creditsSpent}`
      : "未扣积分";
  }
  if (job.status === "FAILED") {
    if (job.creditsSpent > 0 && !job.refundAppliedAt) {
      return `待处理 ${job.creditsSpent}`;
    }
    return job.refundAppliedAt ? "已退还" : "未扣分";
  }
  if (
    (job.status === "PENDING" || job.status === "PROCESSING") &&
    job.creditsSpent > 0
  ) {
    return `预扣 -${job.creditsSpent}`;
  }
  return `-${job.creditsSpent}`;
}

function formatAdminDate(value: Date | string) {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

export function getProviderModeLabel(job: GenerationAdminJob) {
  return job.providerMode === "BUILT_IN" ? "内置渠道" : "自填渠道";
}

export function getGenerationTypeLabel(job: GenerationAdminJob) {
  switch (job.generationType) {
    case "IMAGE_TO_IMAGE":
      return "图生图";
    case "TEXT_TO_VIDEO":
      return "文生视频";
    case "IMAGE_TO_VIDEO":
      return "图生视频";
    default:
      return "文生图";
  }
}

export function getClientSourceLabel(job: GenerationAdminJob) {
  return job.clientSource === "API" ? "API 调用" : "网页端";
}

function SourceImageThumbs({
  compact = false,
  onZoom,
  urls,
}: {
  compact?: boolean;
  onZoom: (url: string) => void;
  urls: string[];
}) {
  if (urls.length === 0) return null;

  const visibleCount = compact ? 3 : 4;
  const visibleUrls = urls.slice(0, visibleCount);
  const remaining = urls.length - visibleUrls.length;

  return (
    <div className="flex items-center gap-1.5">
      {visibleUrls.map((url, index) => (
        <button
          key={`${url}-${index}`}
          type="button"
          onClick={() => onZoom(url)}
          className="group relative overflow-hidden rounded-lg border border-amber-200 bg-amber-50/70 transition hover:border-amber-400"
          title={`查看参考图 ${index + 1}`}
          aria-label={`查看参考图 ${index + 1}`}
        >
          <img
            src={getThumbUrl(url, 96)}
            alt={`参考图 ${index + 1}`}
            loading="lazy"
            decoding="async"
            className={compact ? "size-10 object-cover" : "size-12 object-cover"}
          />
          <span className="absolute inset-x-0 bottom-0 bg-amber-950/60 px-1 py-0.5 text-[9px] leading-none text-white opacity-0 transition group-hover:opacity-100">
            来源
          </span>
        </button>
      ))}
      {remaining > 0 ? (
        <span className="inline-flex size-10 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 text-xs font-medium text-amber-700">
          +{remaining}
        </span>
      ) : null}
    </div>
  );
}

type GenerationAdminListProps = {
  jobs: GenerationAdminJob[];
  onInspectJob?: (job: GenerationAdminJob) => void;
};

export function GenerationAdminList({
  jobs,
  onInspectJob,
}: GenerationAdminListProps) {
  const router = useRouter();
  const toast = useAdminToast();
  const [isPending, startTransition] = useTransition();
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [promptJob, setPromptJob] = useState<GenerationAdminJob | null>(null);
  const [zoomedGeneratedImage, setZoomedGeneratedImage] =
    useState<AdminImagePreview | null>(null);
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);
  const [zoomedSourceImage, setZoomedSourceImage] = useState<string | null>(null);
  const [deleteTargetIds, setDeleteTargetIds] = useState<string[] | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  const visibleJobs = useMemo(
    () => jobs.filter((job) => !hiddenIds.has(job.id)),
    [hiddenIds, jobs],
  );
  const selectedVisibleCount = visibleJobs.filter((job) =>
    selectedIds.has(job.id),
  ).length;
  const allSelected =
    visibleJobs.length > 0 && selectedVisibleCount === visibleJobs.length;
  const deleteCount = deleteTargetIds?.length ?? 0;

  function toggleAll() {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allSelected) {
        visibleJobs.forEach((job) => next.delete(job.id));
      } else {
        visibleJobs.forEach((job) => next.add(job.id));
      }
      return next;
    });
  }

  function toggleOne(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleCopyMediaUrl(job: GenerationAdminJob) {
    const url = readableAdminImage(job)?.url ?? readableAdminVideo(job)?.url;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopyFeedback("媒体地址已复制");
      toast.success("地址已复制到剪贴板");
    } catch {
      setCopyFeedback("复制失败，请手动复制");
      toast.error("复制失败", "浏览器拒绝写入剪贴板");
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTargetIds?.length) return;
    setDeleteError(null);
    setIsDeleting(true);
    try {
      const response = await fetch("/api/admin/generations", {
        body: JSON.stringify({ ids: deleteTargetIds }),
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
      });
      const result = (await response.json().catch(() => ({}))) as {
        data?: {
          deletedIds?: string[];
          protectedIds?: string[];
        };
        error?: string;
      };
      if (!response.ok) {
        const msg = result.error || "删除失败，请稍后再试";
        setDeleteError(msg);
        toast.error("删除生成记录失败", msg);
        return;
      }

      const deletedIds = result.data?.deletedIds ?? [];
      const protectedIds = result.data?.protectedIds ?? [];
      setHiddenIds((current) => {
        const next = new Set(current);
        deletedIds.forEach((id) => next.add(id));
        return next;
      });
      setSelectedIds((current) => {
        const next = new Set(current);
        deletedIds.forEach((id) => next.delete(id));
        return next;
      });
      if (protectedIds.length > 0) {
        const msg = `已删除 ${deletedIds.length} 条；${protectedIds.length} 条契约任务需保留协调证据，未删除。`;
        setCopyFeedback(msg);
        toast.warning("部分记录受契约保护", msg);
      } else if (deletedIds.length > 0) {
        const msg = `已删除 ${deletedIds.length} 条记录。`;
        setCopyFeedback(msg);
        toast.success("删除成功", msg);
      } else {
        setCopyFeedback("没有记录被删除，列表已刷新。");
      }
      setDeleteTargetIds(null);
      startTransition(() => {
        router.refresh();
      });
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <>
      <div className="studio-card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[var(--line)] bg-[#faf7f1] px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div className="text-xs text-[var(--ink-soft)] sm:text-sm">
            已选{" "}
            <span className="font-mono font-semibold text-[var(--ink)]">
              {selectedVisibleCount}
            </span>{" "}
            条 · 本页共{" "}
            <span className="font-mono font-semibold text-[var(--ink)]">
              {visibleJobs.length}
            </span>{" "}
            条
            {copyFeedback ? (
              <span className="ml-3 font-medium text-[#b54722]">{copyFeedback}</span>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={toggleAll}
              disabled={visibleJobs.length === 0}
              className="rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--ink-soft)] transition hover:border-[#c85a32] hover:text-[#c85a32] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {allSelected ? "取消全选" : "全选本页"}
            </button>
            <button
              type="button"
              disabled={selectedVisibleCount === 0 || isDeleting || isPending}
              onClick={() =>
                setDeleteTargetIds(
                  visibleJobs
                    .filter((job) => selectedIds.has(job.id))
                    .map((job) => job.id),
                )
              }
              className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 className="size-3.5" aria-hidden />
              批量删除
            </button>
          </div>
        </div>

        {/* Mobile List */}
        <div className="grid gap-3 p-3 lg:hidden">
          {visibleJobs.map((job) => {
            const image = readableAdminImage(job);
            const video = readableAdminVideo(job);
            const checked = selectedIds.has(job.id);
            const badge = getGenerationStatusBadge(job);
            return (
              <article
                key={job.id}
                className={cn(
                  "rounded-xl border border-[var(--line)] bg-white p-3 transition",
                  checked && "ring-2 ring-[#c85a32]/30",
                )}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    aria-label={`选择生成记录 ${job.id}`}
                    checked={checked}
                    onChange={() => toggleOne(job.id)}
                    className="mt-5 size-4 shrink-0 rounded accent-[#c85a32]"
                  />
                  {image ? (
                    <button
                      type="button"
                      onClick={() =>
                        setZoomedGeneratedImage({ id: image.id, url: image.url })
                      }
                      className="shrink-0 overflow-hidden rounded-xl border border-[var(--line)] bg-[#f4ede1]"
                      title="查看生成图片"
                      aria-label={`查看生成图片 ${job.id}`}
                    >
                      <img
                        src={getThumbUrl(image.url, 128)}
                        alt="生成预览"
                        loading="lazy"
                        decoding="async"
                        className="size-16 object-cover"
                      />
                    </button>
                  ) : video ? (
                    <button
                      type="button"
                      onClick={() => setPreviewVideoUrl(video.url)}
                      className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-violet-200 bg-violet-50 text-violet-700"
                      aria-label={`预览生成视频 ${job.id}`}
                    >
                      {video.posterUrl ? (
                        <img
                          src={getThumbUrl(video.posterUrl, 128)}
                          alt="视频封面"
                          className="size-full object-cover"
                        />
                      ) : (
                        <Film className="size-6" aria-hidden />
                      )}
                    </button>
                  ) : (
                    <div className="flex size-16 shrink-0 items-center justify-center rounded-xl border border-[var(--line)] bg-[#f4ede1]/70 px-1 text-center text-[11px] text-[var(--ink-soft)]">
                      {job.images.length || job.status !== "SUCCEEDED" ? (
                        <span>{getMissingMediaLabel(job)}</span>
                      ) : (
                        <ImageIcon className="size-5" aria-hidden />
                      )}
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[var(--ink)]">
                      {getUserDisplayName(job.user)}
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[var(--ink-soft)]">
                      {job.prompt}
                    </p>
                    {job.status === "FAILED" && job.errorMessage ? (
                      <p className="mt-1 line-clamp-1 text-[11px] text-rose-600">
                        错误：{job.errorMessage}
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-[var(--ink-soft)]">
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 font-medium",
                          badge.className,
                        )}
                      >
                        {badge.label}
                      </span>
                      <span className="rounded-full border border-[var(--line)] bg-[#faf7f1] px-2 py-0.5">
                        {getGenerationTypeLabel(job)}
                      </span>
                      <span className="rounded-full border border-[var(--line)] bg-[#faf7f1] px-2 py-0.5 font-mono font-semibold text-[var(--admin-ink-credit)]">
                        {getCreditLabel(job)}
                      </span>
                    </div>
                  </div>
                </div>

                {job.sourceImageUrls.length > 0 ? (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/50 p-2">
                    <div className="mb-1.5 flex items-center justify-between text-[11px] text-amber-800">
                      <span className="font-medium">参考输入图</span>
                      <span>{job.sourceImageUrls.length} 张</span>
                    </div>
                    <SourceImageThumbs
                      compact
                      urls={job.sourceImageUrls}
                      onZoom={setZoomedSourceImage}
                    />
                  </div>
                ) : null}

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)]/60 pt-2.5">
                  <span
                    className="max-w-[55%] truncate rounded-md bg-[#f4ede1] px-2 py-1 font-mono text-[11px] text-[var(--ink-soft)]"
                    title={job.model}
                  >
                    {job.model}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {onInspectJob ? (
                      <button
                        type="button"
                        onClick={() => onInspectJob(job)}
                        aria-label="排障详情"
                        title="排障详情与重试记录"
                        className="inline-flex size-8 items-center justify-center rounded-lg border border-[var(--line)] bg-white text-[var(--ink-soft)] hover:text-[#c85a32]"
                      >
                        <FileSearch className="size-4" aria-hidden />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setPromptJob(job)}
                      aria-label="完整提示词"
                      title="完整提示词"
                      className="inline-flex size-8 items-center justify-center rounded-lg border border-[var(--line)] bg-white text-[var(--ink-soft)] hover:text-[#c85a32]"
                    >
                      <FileText className="size-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      disabled={!image && !video}
                      onClick={() => void handleCopyMediaUrl(job)}
                      aria-label="复制媒体地址"
                      title="复制媒体地址"
                      className="inline-flex size-8 items-center justify-center rounded-lg border border-[var(--line)] bg-white text-[var(--ink-soft)] disabled:opacity-35"
                    >
                      <Copy className="size-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTargetIds([job.id])}
                      aria-label="删除记录"
                      title="删除记录"
                      className="inline-flex size-8 items-center justify-center rounded-lg border border-rose-200 bg-rose-50/70 text-rose-600"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {/* Desktop Table */}
        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full min-w-[1160px] text-left text-sm">
            <thead className="border-b border-[var(--line)] text-xs text-[var(--ink-soft)]">
              <tr>
                <th className="w-12 px-4 py-3.5">
                  <input
                    type="checkbox"
                    aria-label="选择本页生成记录"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="size-4 rounded accent-[#c85a32]"
                  />
                </th>
                <th className="px-3 py-3.5 font-medium">产物</th>
                <th className="px-3 py-3.5 font-medium">参考图</th>
                <th className="px-3 py-3.5 font-medium">用户 / 提示词 / 任务 ID</th>
                <th className="px-3 py-3.5 font-medium">状态与类型</th>
                <th className="px-3 py-3.5 font-medium">渠道 / 模型</th>
                <th className="px-3 py-3.5 font-medium">积分结算</th>
                <th className="px-3 py-3.5 font-medium">创建时间</th>
                <th className="px-4 py-3.5 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]/70">
              {visibleJobs.map((job) => {
                const image = readableAdminImage(job);
                const video = readableAdminVideo(job);
                const checked = selectedIds.has(job.id);
                const badge = getGenerationStatusBadge(job);
                return (
                  <tr
                    key={job.id}
                    className={cn(
                      "transition-colors hover:bg-[#faf6ee]/80",
                      checked ? "bg-[#f6efe3]" : "bg-white",
                    )}
                  >
                    <td className="px-4 py-3.5 align-middle">
                      <input
                        type="checkbox"
                        aria-label={`选择生成记录 ${job.id}`}
                        checked={checked}
                        onChange={() => toggleOne(job.id)}
                        className="size-4 rounded accent-[#c85a32]"
                      />
                    </td>
                    <td className="px-3 py-3.5 align-middle">
                      {image ? (
                        <button
                          type="button"
                          onClick={() =>
                            setZoomedGeneratedImage({
                              id: image.id,
                              url: image.url,
                            })
                          }
                          className="block overflow-hidden rounded-xl border border-[var(--line)] bg-[#f4ede1]"
                          title="查看生成图片"
                          aria-label={`查看生成图片 ${job.id}`}
                        >
                          <img
                            src={getThumbUrl(image.url, 96)}
                            alt="生成预览"
                            loading="lazy"
                            decoding="async"
                            className="size-14 object-cover"
                          />
                        </button>
                      ) : video ? (
                        <button
                          type="button"
                          onClick={() => setPreviewVideoUrl(video.url)}
                          className="flex size-14 items-center justify-center overflow-hidden rounded-xl border border-violet-200 bg-violet-50 text-violet-700"
                          title="预览生成视频"
                          aria-label={`预览生成视频 ${job.id}`}
                        >
                          {video.posterUrl ? (
                            <img
                              src={getThumbUrl(video.posterUrl, 96)}
                              alt="视频封面"
                              className="size-full object-cover"
                            />
                          ) : (
                            <Film className="size-5" aria-hidden />
                          )}
                        </button>
                      ) : (
                        <div className="flex size-14 items-center justify-center rounded-xl border border-[var(--line)] bg-[#faf7f1] px-1 text-center text-[11px] text-[var(--ink-soft)]">
                          {job.images.length || job.status !== "SUCCEEDED" ? (
                            <span>{getMissingMediaLabel(job)}</span>
                          ) : (
                            <ImageIcon className="size-4" aria-hidden />
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3.5 align-middle">
                      {job.sourceImageUrls.length > 0 ? (
                        <SourceImageThumbs
                          compact
                          urls={job.sourceImageUrls}
                          onZoom={setZoomedSourceImage}
                        />
                      ) : (
                        <span className="text-xs text-[var(--ink-soft)]/50">—</span>
                      )}
                    </td>
                    <td className="max-w-[340px] px-3 py-3.5 align-middle">
                      <p className="truncate font-medium text-[var(--ink)]">
                        {getUserDisplayName(job.user)}
                      </p>
                      {job.user?.nickname?.trim() && job.user.email ? (
                        <p className="truncate font-mono text-[11px] text-[var(--ink-soft)]">
                          {job.user.email}
                        </p>
                      ) : null}
                      <p className="mt-1 line-clamp-1 text-xs text-[var(--ink-soft)]">
                        {job.prompt}
                      </p>
                      {job.status === "FAILED" && (job.errorCode || job.errorMessage) ? (
                        <p className="mt-0.5 line-clamp-1 text-[11px] text-rose-600">
                          {job.errorCode ? `[${job.errorCode}] ` : ""}
                          {job.errorMessage}
                        </p>
                      ) : null}
                      <p className="mt-0.5 font-mono text-[11px] text-[var(--ink-soft)]/65">
                        {job.id}
                      </p>
                    </td>
                    <td className="px-3 py-3.5 align-middle text-xs">
                      <div className="flex flex-wrap gap-1.5">
                        <span
                          className={cn(
                            "rounded-full border px-2.5 py-0.5 font-semibold",
                            badge.className,
                          )}
                        >
                          {badge.label}
                        </span>
                        <span className="rounded-full border border-[var(--line)] bg-[#faf7f1] px-2 py-0.5 text-[var(--ink-soft)]">
                          {getGenerationTypeLabel(job)}
                        </span>
                        <span className="rounded-full border border-[var(--line)] bg-[#faf7f1] px-2 py-0.5 text-[var(--ink-soft)]">
                          {getClientSourceLabel(job)}
                        </span>
                      </div>
                    </td>
                    <td className="max-w-[190px] px-3 py-3.5 align-middle">
                      <div className="text-xs text-[var(--ink-soft)]">
                        {getProviderModeLabel(job)}
                      </div>
                      <span
                        className="mt-1 inline-block max-w-full truncate rounded-md bg-[#f4ede1] px-2 py-0.5 font-mono text-xs text-[var(--ink)]"
                        title={job.model}
                      >
                        {job.model}
                      </span>
                    </td>
                    <td className="px-3 py-3.5 align-middle font-mono text-sm font-semibold tabular-nums text-[var(--admin-ink-credit)]">
                      {getCreditLabel(job)}
                    </td>
                    <td className="px-3 py-3.5 align-middle font-mono text-xs text-[var(--ink-soft)]">
                      {formatAdminDate(job.createdAt)}
                    </td>
                    <td className="px-4 py-3.5 text-right align-middle">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        {onInspectJob ? (
                          <button
                            type="button"
                            onClick={() => onInspectJob(job)}
                            className="inline-flex size-8 items-center justify-center rounded-lg border border-[var(--line)] bg-white text-[var(--ink-soft)] transition hover:border-[#c85a32] hover:text-[#c85a32]"
                            title="排障与重试详情"
                            aria-label={`查看任务排障详情 ${job.id}`}
                          >
                            <FileSearch className="size-4" aria-hidden />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => setPromptJob(job)}
                          className="inline-flex size-8 items-center justify-center rounded-lg border border-[var(--line)] bg-white text-[var(--ink-soft)] transition hover:border-[#c85a32] hover:text-[#c85a32]"
                          title="完整提示词"
                          aria-label="完整提示词"
                        >
                          <FileText className="size-4" aria-hidden />
                        </button>
                        <button
                          type="button"
                          disabled={!image && !video}
                          onClick={() => void handleCopyMediaUrl(job)}
                          className="inline-flex size-8 items-center justify-center rounded-lg border border-[var(--line)] bg-white text-[var(--ink-soft)] transition hover:border-[#c85a32] hover:text-[#c85a32] disabled:cursor-not-allowed disabled:opacity-35"
                          title="复制地址"
                          aria-label="复制媒体地址"
                        >
                          <Copy className="size-4" aria-hidden />
                        </button>
                        <button
                          type="button"
                          disabled={!image}
                          onClick={() =>
                            image
                              ? void downloadImage(image.url, "narra-generation")
                              : undefined
                          }
                          className="inline-flex size-8 items-center justify-center rounded-lg border border-[var(--line)] bg-white text-[var(--ink-soft)] transition hover:border-[#c85a32] hover:text-[#c85a32] disabled:cursor-not-allowed disabled:opacity-35"
                          title="下载图片"
                          aria-label="下载图片"
                        >
                          <Download className="size-4" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteError(null);
                            setDeleteTargetIds([job.id]);
                          }}
                          className="inline-flex size-8 items-center justify-center rounded-lg border border-rose-200 bg-rose-50/70 text-rose-600 transition hover:bg-rose-100"
                          title="删除记录"
                          aria-label={`删除记录 ${job.id}`}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {visibleJobs.length === 0 ? (
          <div className="border-t border-[var(--line)] px-6 py-12 text-center text-sm text-[var(--ink-soft)]">
            本页记录已清空。
          </div>
        ) : null}
      </div>

      {promptJob ? (
        <PromptModal
          prompt={promptJob.prompt}
          negativePrompt={promptJob.negativePrompt}
          onClose={() => setPromptJob(null)}
        />
      ) : null}

      {zoomedGeneratedImage &&
      visibleJobs.some((job) =>
        job.images.some(
          (image) =>
            image.id === zoomedGeneratedImage.id &&
            adminImageAvailability(image) === "available",
        ),
      ) ? (
        <ImageLightbox
          src={zoomedGeneratedImage.url}
          alt="生成图片大图"
          onClose={() => setZoomedGeneratedImage(null)}
        >
          <span className="rounded-full bg-white/90 px-4 py-2 text-sm font-medium text-[var(--ink)]">
            生成图片
          </span>
        </ImageLightbox>
      ) : null}

      {previewVideoUrl ? (
        <AdminModal
          open
          onClose={() => setPreviewVideoUrl(null)}
          size="lg"
          eyebrow="VIDEO PREVIEW"
          title="生成视频预览"
        >
          <video
            src={previewVideoUrl}
            controls
            autoPlay
            playsInline
            className="max-h-[70vh] w-full rounded-xl bg-black"
          />
        </AdminModal>
      ) : null}

      {zoomedSourceImage ? (
        <ImageLightbox
          src={zoomedSourceImage}
          alt="参考图大图"
          onClose={() => setZoomedSourceImage(null)}
        >
          <span className="rounded-full bg-amber-100 px-4 py-2 text-sm font-medium text-amber-800">
            图生图上传参考图
          </span>
        </ImageLightbox>
      ) : null}

      <AdminConfirmDialog
        open={deleteTargetIds !== null}
        onClose={() => {
          if (!isDeleting) setDeleteTargetIds(null);
        }}
        onConfirm={() => void handleConfirmDelete()}
        busy={isDeleting}
        tone="danger"
        title="删除生成记录"
        description={`将尝试永久删除 ${deleteCount} 条生成任务及其关联图片记录，操作不可恢复。v1 契约任务及含重试证据的任务会自动受保护保留。`}
        confirmLabel={isDeleting ? "删除中…" : "确认删除"}
        error={deleteError}
      />
    </>
  );
}

export function InviteCreator() {
  const router = useRouter();
  const toast = useAdminToast();
  const [isPending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [count, setCount] = useState(10);
  const [error, setError] = useState<string | null>(null);
  const [createdCodes, setCreatedCodes] = useState<string[]>([]);
  const [createdBatchId, setCreatedBatchId] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);

  async function downloadBatchTxt(batchId: string) {
    const exportRes = await fetch(`/api/admin/invites/batches/${batchId}/export`);
    if (!exportRes.ok) {
      toast.error("导出邀请码失败");
      return;
    }
    const dispo = exportRes.headers.get("Content-Disposition") ?? "";
    const match = dispo.match(/filename="([^"]+)"/);
    const filename = match?.[1] ?? `invite-codes-${batchId}.txt`;
    const blob = await exportRes.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleCopy(codes: string[]) {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopySuccess(true);
      toast.success("已复制全部邀请码", `共 ${codes.length} 个邀请码`);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      toast.error("复制失败", "请点击下载 .txt 导出");
    }
  }

  async function handleCreate() {
    setError(null);
    setCreatedCodes([]);
    setCreatedBatchId(null);
    const response = await fetch("/api/admin/invites", {
      body: JSON.stringify({ count, isPublic, note }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const result = (await response.json().catch(() => ({}))) as {
      data?: {
        batchId: string;
        claimPageUrl: string;
        codes: string[];
        message: string;
      };
      error?: string;
    };

    if (!response.ok) {
      const msg = result.error || "创建失败";
      setError(msg);
      toast.error("生成邀请码失败", msg);
      return;
    }

    if (result.data?.codes) {
      setCreatedCodes(result.data.codes);
      setCreatedBatchId(result.data.batchId);
      toast.success(
        "邀请码批次已生成",
        `共生成 ${result.data.codes.length} 个准入邀请码`,
      );
    }

    setNote("");
    setIsPublic(false);
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <section className="studio-card p-5 md:p-6">
      <h2 className="text-lg font-semibold text-[var(--ink)]">批量生成邀请码</h2>
      <p className="mt-1 text-sm text-[var(--ink-soft)]">
        每次批量生成会自动归入独立批次，可随时开启或关闭公开自助领取。
      </p>

      <div className="mt-4 grid gap-3.5 md:grid-cols-[1fr_180px]">
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-[var(--ink-soft)]">
            批次标题 / 渠道备注
          </span>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="例如：内测首批设计师邀请"
            className="rounded-xl border border-[var(--line)] bg-white px-3.5 py-2.5 text-sm outline-none"
          />
        </label>

        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-[var(--ink-soft)]">
            生成数量（1 - 100）
          </span>
          <input
            type="number"
            min={1}
            max={100}
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
            className="rounded-xl border border-[var(--line)] bg-white px-3.5 py-2.5 font-mono text-sm font-semibold tabular-nums outline-none"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--line)] pt-4">
        <div className="flex items-center gap-3">
          <AdminSwitch
            ariaLabel="开放公开领取"
            checked={isPublic}
            onCheckedChange={setIsPublic}
          />
          <div>
            <span className="text-sm font-medium text-[var(--ink)]">
              同步开放至公开领取页（/invite-claim）
            </span>
          </div>
        </div>

        <button
          type="button"
          disabled={isPending}
          onClick={() => startTransition(() => void handleCreate())}
          className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#c85a32] disabled:opacity-60"
        >
          {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {isPending ? "创建中…" : "批量生成"}
        </button>
      </div>

      {error ? (
        <div className="mt-4">
          <Alert variant="error">{error}</Alert>
        </div>
      ) : null}

      {createdCodes.length > 0 ? (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/55 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-emerald-900">
              已生成 {createdCodes.length} 个邀请码
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleCopy(createdCodes)}
                className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-800 transition hover:bg-emerald-50"
              >
                <Copy className="size-3.5" aria-hidden />
                {copySuccess ? "已复制" : "复制全部"}
              </button>
              {createdBatchId ? (
                <button
                  type="button"
                  onClick={() => void downloadBatchTxt(createdBatchId)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-800 transition hover:bg-emerald-50"
                >
                  <Download className="size-3.5" aria-hidden />
                  下载 .txt
                </button>
              ) : null}
            </div>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {createdCodes.slice(0, 12).map((code) => (
              <span
                key={code}
                className="rounded-lg border border-emerald-200 bg-white px-2.5 py-1 font-mono text-xs font-semibold text-[var(--ink)]"
              >
                {code}
              </span>
            ))}
            {createdCodes.length > 12 ? (
              <span className="rounded-lg bg-white/70 px-2.5 py-1 text-xs text-[var(--ink-soft)]">
                另有 {createdCodes.length - 12} 个
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function InviteBatchToggle({
  batchId,
  isPublic,
}: {
  batchId: string;
  isPublic: boolean;
}) {
  const router = useRouter();
  const toast = useAdminToast();
  const [isPending, startTransition] = useTransition();

  async function handleToggle(nextPublic: boolean) {
    const response = await fetch(`/api/admin/invites/batches/${batchId}`, {
      body: JSON.stringify({ isPublic: nextPublic }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      toast.error("更新批次开放状态失败", result.error || "请稍后重试");
      return;
    }
    toast.success(nextPublic ? "已开放公开领取" : "已关闭公开领取");
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-white px-3 py-1.5">
      <span
        className={cn(
          "text-xs font-medium",
          isPublic ? "text-emerald-700" : "text-[var(--ink-soft)]",
        )}
      >
        {isPublic ? "公开领取中" : "未公开"}
      </span>
      <AdminSwitch
        size="sm"
        ariaLabel={isPublic ? "关闭公开领取" : "开放公开领取"}
        checked={isPublic}
        disabled={isPending}
        onCheckedChange={(next) => startTransition(() => void handleToggle(next))}
      />
    </div>
  );
}

export function InviteBatchDelete({
  batchId,
  remaining,
  total,
}: {
  batchId: string;
  remaining: number;
  total: number;
}) {
  const router = useRouter();
  const toast = useAdminToast();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const used = total - remaining;

  async function handleDelete() {
    setError(null);
    setDeleting(true);
    try {
      const response = await fetch(`/api/admin/invites/batches/${batchId}`, {
        method: "DELETE",
      });
      const result = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        const msg = result?.error || "删除失败";
        setError(msg);
        toast.error("删除邀请批次失败", msg);
        return;
      }

      setOpen(false);
      toast.success("邀请码批次已删除");
      startTransition(() => {
        router.refresh();
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={deleting}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-60"
        title="删除整个批次"
      >
        <Trash2 className="size-3.5" aria-hidden />
        删除批次
      </button>

      <AdminConfirmDialog
        open={open}
        onClose={() => {
          if (!deleting) setOpen(false);
        }}
        onConfirm={() => void handleDelete()}
        busy={deleting}
        tone="danger"
        title="删除邀请码批次"
        description={
          used > 0
            ? `确定要删除整个批次吗？共 ${total} 个邀请码（其中 ${used} 个已使用或已发放），删除后不可恢复。`
            : `确定要删除整个批次吗？共 ${total} 个邀请码将被一并清除，不可恢复。`
        }
        confirmLabel={deleting ? "删除中…" : "确认删除批次"}
        error={error}
      />
    </>
  );
}

export function InviteBatchCopy({ batchId }: { batchId: string }) {
  const toast = useAdminToast();
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function handleCopy() {
    const res = await fetch(`/api/admin/invites/batches/${batchId}/export`);
    if (!res.ok) {
      toast.error("获取可用邀请码失败", "该批次可能已无剩余可用码");
      return;
    }
    const text = await res.text();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("批次可用邀请码已复制");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("复制失败", "请使用下载 .txt 导出");
    }
  }

  return (
    <button
      type="button"
      disabled={isPending || copied}
      onClick={() => startTransition(() => void handleCopy())}
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--ink-soft)] transition hover:border-[#c85a32] hover:text-[#c85a32] disabled:opacity-60"
      title="复制本批次所有可用邀请码"
    >
      {copied ? (
        <Check className="size-3.5 text-emerald-600" aria-hidden />
      ) : (
        <Copy className="size-3.5" aria-hidden />
      )}
      {copied ? "已复制" : isPending ? "复制中…" : "复制可用码"}
    </button>
  );
}

type InviteCodeData = {
  claimedAt: string | null;
  code: string;
  id: string;
  usedAt: string | null;
  usedBy: { email: string } | null;
};

type InviteBatchDetailResponse = {
  data?: {
    codes?: InviteCodeData[];
  };
  error?: string;
};

async function readInviteBatchCodes(response: Response) {
  const payload = (await response.json().catch(() => null)) as InviteBatchDetailResponse | null;
  if (!response.ok || !payload?.data) {
    throw new Error(payload?.error || "获取邀请码失败");
  }
  return payload.data.codes || [];
}

export function InviteBatchViewButton({
  batchId,
  title,
}: {
  batchId: string;
  title: string | null;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--ink)] transition hover:border-[#c85a32] hover:text-[#c85a32]"
        title="查看批次内的邀请码详情"
      >
        <Eye className="size-3.5" aria-hidden />
        查看
      </button>

      {isOpen ? (
        <InviteBatchViewModal
          batchId={batchId}
          batchTitle={title}
          onClose={() => setIsOpen(false)}
        />
      ) : null}
    </>
  );
}

function InviteBatchViewModal({
  batchId,
  batchTitle,
  onClose,
}: {
  batchId: string;
  batchTitle: string | null;
  onClose: () => void;
}) {
  const toast = useAdminToast();
  const [codes, setCodes] = useState<InviteCodeData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function fetchCodes() {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/admin/invites/batches/${batchId}`, {
          credentials: "same-origin",
        });
        const nextCodes = await readInviteBatchCodes(response);
        if (active) setCodes(nextCodes);
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "网络请求出错");
        }
      } finally {
        if (active) setIsLoading(false);
      }
    }
    void fetchCodes();
    return () => {
      active = false;
    };
  }, [batchId]);

  const availableCodes = useMemo(
    () => codes.filter((c) => !c.usedAt && !c.claimedAt),
    [codes],
  );

  const unavailableCodes = useMemo(
    () => codes.filter((c) => c.usedAt || c.claimedAt),
    [codes],
  );

  async function handleCopyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      toast.success("邀请码已复制", code);
      setTimeout(() => setCopiedCode(null), 1500);
    } catch {
      toast.error("复制失败，请手动复制");
    }
  }

  return (
    <AdminModal
      open
      onClose={onClose}
      size="xl"
      eyebrow="INVITE BATCH"
      title={batchTitle || "未命名邀请批次"}
      description="点击任意可用邀请码即可复制；右侧展示已发放或完成注册的记录。"
    >
      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--ink-soft)]">
          <Loader2 className="size-5 animate-spin text-[#c85a32]" aria-hidden />
          <span>正在加载邀请码明细…</span>
        </div>
      ) : error ? (
        <Alert variant="error">{error}</Alert>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-sm font-semibold text-[var(--ink)]">
                可用邀请码 ({availableCodes.length})
              </h4>
              <span className="text-xs text-[var(--ink-soft)]">点击卡片复制</span>
            </div>
            {availableCodes.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--line)] p-8 text-center text-xs text-[var(--ink-soft)]">
                没有剩余可用的邀请码
              </div>
            ) : (
              <div className="premium-scrollbar grid max-h-96 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
                {availableCodes.map((c) => {
                  const isCopied = copiedCode === c.code;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => void handleCopyCode(c.code)}
                      className={cn(
                        "flex flex-col items-center justify-center rounded-xl border p-3 text-center transition",
                        isCopied
                          ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                          : "border-[var(--line)] bg-white hover:border-[#c85a32]",
                      )}
                    >
                      <span className="font-mono text-xs font-semibold tracking-wide">
                        {c.code}
                      </span>
                      <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-[var(--ink-soft)]">
                        {isCopied ? (
                          <>
                            <Check className="size-3 text-emerald-600" aria-hidden />
                            <span className="text-emerald-700">已复制</span>
                          </>
                        ) : (
                          <span>未使用</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <h4 className="mb-3 text-sm font-semibold text-[var(--ink)]">
              已发放 / 已使用邀请码 ({unavailableCodes.length})
            </h4>
            {unavailableCodes.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--line)] p-8 text-center text-xs text-[var(--ink-soft)]">
                尚无已发放或已使用的邀请码
              </div>
            ) : (
              <div className="premium-scrollbar max-h-96 space-y-2 overflow-y-auto pr-1">
                {unavailableCodes.map((c) => {
                  const isUsed = Boolean(c.usedAt);
                  const statusTime = c.usedAt || c.claimedAt;
                  return (
                    <div
                      key={c.id}
                      className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-[#faf7f1] px-3.5 py-2.5"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-[var(--ink)]">
                          {c.code}
                        </span>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                            isUsed
                              ? "bg-[#231810] text-white"
                              : "bg-amber-100 text-amber-800",
                          )}
                        >
                          {isUsed ? "已使用" : "已发放"}
                        </span>
                      </div>
                      <div className="min-w-0 text-right">
                        <p
                          className="truncate font-mono text-xs text-[var(--ink)]"
                          title={c.usedBy?.email}
                        >
                          {isUsed ? c.usedBy?.email || "未知账号" : "等待注册"}
                        </p>
                        {statusTime ? (
                          <p className="font-mono text-[10px] text-[var(--ink-soft)]">
                            {new Date(statusTime).toLocaleString("zh-CN", {
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                              month: "numeric",
                            })}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </AdminModal>
  );
}

type CreditAdjusterProps = {
  currentCredits?: number;
  userId: string;
};

export function CreditAdjuster({
  currentCredits,
  userId,
}: CreditAdjusterProps) {
  const router = useRouter();
  const toast = useAdminToast();
  const [direction, setDirection] = useState<"add" | "deduct">("add");
  const [rawAmount, setRawAmount] = useState(50);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const absAmount = Math.max(1, Math.min(10000, Math.abs(Math.trunc(rawAmount)) || 1));
  const signedAmount = direction === "add" ? absAmount : -absAmount;
  const nextPreview =
    currentCredits !== undefined ? currentCredits + signedAmount : undefined;
  const insufficient = nextPreview !== undefined && nextPreview < 0;

  async function handleAdjust() {
    setError(null);

    const response = await fetch(`/api/admin/users/${userId}/credits`, {
      body: JSON.stringify({ amount: signedAmount }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    const result = (await response.json().catch(() => ({}))) as {
      data?: { user?: { credits: number; email: string } };
      error?: string;
    };

    if (!response.ok) {
      const msg = result.error || "调整积分失败";
      setError(msg);
      toast.error("积分调整失败", msg);
      return;
    }

    toast.success(
      signedAmount > 0 ? `已发放 +${absAmount} 积分` : `已扣减 -${absAmount} 积分`,
      result.data?.user
        ? `当前最新余额：${result.data.user.credits.toLocaleString("zh-CN")} 积分`
        : undefined,
    );
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="inline-flex rounded-lg border border-[var(--line)] bg-[#f4ede1] p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setDirection("add")}
            aria-label="增加积分模式"
            className={cn(
              "inline-flex items-center gap-0.5 rounded-md px-2 py-1 font-medium transition",
              direction === "add"
                ? "bg-white text-emerald-700 shadow-2xs"
                : "text-[var(--ink-soft)]",
            )}
          >
            <Plus className="size-3" aria-hidden />
            增加
          </button>
          <button
            type="button"
            onClick={() => setDirection("deduct")}
            aria-label="扣减积分模式"
            className={cn(
              "inline-flex items-center gap-0.5 rounded-md px-2 py-1 font-medium transition",
              direction === "deduct"
                ? "bg-white text-rose-600 shadow-2xs"
                : "text-[var(--ink-soft)]",
            )}
          >
            <Minus className="size-3" aria-hidden />
            扣减
          </button>
        </div>

        <input
          type="number"
          min={1}
          max={10000}
          aria-label="调整积分数量"
          value={absAmount}
          onChange={(event) => setRawAmount(Number(event.target.value))}
          className="w-20 rounded-lg border border-[var(--line)] bg-white px-2.5 py-1 text-center font-mono text-xs font-semibold tabular-nums outline-none"
        />

        <button
          type="button"
          disabled={isPending || insufficient}
          onClick={() => startTransition(() => void handleAdjust())}
          className={cn(
            "rounded-full px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
            direction === "add"
              ? "bg-[#231810] text-white hover:bg-[#c85a32]"
              : "border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100",
          )}
        >
          {isPending ? "提交中…" : direction === "add" ? `+${absAmount}` : `-${absAmount}`}
        </button>
      </div>

      {nextPreview !== undefined ? (
        <span
          className={cn(
            "font-mono text-[11px]",
            insufficient ? "text-rose-600" : "text-[var(--ink-soft)]",
          )}
        >
          {insufficient
            ? `余额不足（当前 ${currentCredits}）`
            : `变更预览：${currentCredits} → ${nextPreview}`}
        </span>
      ) : null}
      {error ? <span className="text-xs text-rose-600">{error}</span> : null}
    </div>
  );
}

type GenerationAdminCardProps = {
  job: GenerationAdminJob;
  onInspectJob?: (job: GenerationAdminJob) => void;
};

export function GenerationAdminCard({
  job,
  onInspectJob,
}: GenerationAdminCardProps) {
  const router = useRouter();
  const toast = useAdminToast();
  const [, startTransition] = useTransition();
  const image = readableAdminImage(job);
  const video = readableAdminVideo(job);
  const badge = getGenerationStatusBadge(job);
  const [zoomedImage, setZoomedImage] = useState<AdminImagePreview | null>(null);
  const [previewVideo, setPreviewVideo] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleCopyUrl() {
    const url = image?.url ?? video?.url;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("媒体地址已复制");
    } catch {
      toast.error("复制失败");
    }
  }

  async function handleDelete() {
    setDeleteError(null);
    setDeleting(true);
    try {
      const res = await fetch("/api/admin/generations", {
        body: JSON.stringify({ ids: [job.id] }),
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
      });
      const json = (await res.json().catch(() => ({}))) as {
        data?: { deletedIds?: string[]; protectedIds?: string[] };
        error?: string;
      };
      if (!res.ok) {
        setDeleteError(json.error || "删除失败");
        return;
      }
      if ((json.data?.protectedIds?.length ?? 0) > 0) {
        toast.warning("该任务受契约保护，不可删除");
      } else {
        toast.success("生成记录已删除");
      }
      setConfirmDelete(false);
      startTransition(() => router.refresh());
    } finally {
      setDeleting(false);
    }
  }

  return (
    <article className="studio-card flex flex-col gap-4 p-5 xl:flex-row">
      {image ? (
        <button
          type="button"
          onClick={() => setZoomedImage({ id: image.id, url: image.url })}
          className="mx-auto shrink-0 overflow-hidden rounded-xl border border-[var(--line)] bg-[#f4ede1] xl:mx-0"
          aria-label={`查看生成图片 ${job.id}`}
        >
          <img
            src={getThumbUrl(image.url, 384)}
            alt="生成缩略图"
            loading="lazy"
            decoding="async"
            className="size-32 object-cover transition duration-300 hover:scale-[1.03] xl:size-36"
          />
        </button>
      ) : video ? (
        <button
          type="button"
          onClick={() => setPreviewVideo(true)}
          className="mx-auto flex size-32 shrink-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border border-violet-200 bg-violet-50 text-violet-700 xl:mx-0 xl:size-36"
          aria-label={`预览生成视频 ${job.id}`}
        >
          {video.posterUrl ? (
            <img
              src={getThumbUrl(video.posterUrl, 384)}
              alt="视频封面"
              className="size-full object-cover"
            />
          ) : (
            <>
              <Film className="size-7" aria-hidden />
              <span className="text-xs font-medium">播放视频</span>
            </>
          )}
        </button>
      ) : (
        <div className="mx-auto flex size-32 shrink-0 items-center justify-center rounded-xl border border-[var(--line)] bg-[#faf7f1] px-2 text-center text-xs text-[var(--ink-soft)] xl:mx-0 xl:size-36">
          {getMissingMediaLabel(job)}
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span
              className="max-w-[180px] truncate font-semibold text-[var(--ink)]"
              title={
                job.user?.nickname?.trim()
                  ? `${job.user.nickname} / ${job.user.email}`
                  : job.user?.email
              }
            >
              {getUserDisplayName(job.user)}
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                  badge.className,
                )}
              >
                {badge.label}
              </span>
              <span className="rounded-full border border-[var(--line)] bg-[#faf7f1] px-2 py-0.5 text-[11px] text-[var(--ink-soft)]">
                {getGenerationTypeLabel(job)}
              </span>
              <span className="rounded-full border border-[var(--line)] bg-[#faf7f1] px-2 py-0.5 text-[11px] text-[var(--ink-soft)]">
                {getClientSourceLabel(job)}
              </span>
              <span className="rounded-full border border-[var(--line)] bg-[#faf7f1] px-2 py-0.5 text-[11px] text-[var(--ink-soft)]">
                {getProviderModeLabel(job)}
              </span>
            </div>
          </div>

          <p className="line-clamp-2 text-sm leading-relaxed text-[var(--ink)]">
            {job.prompt}
          </p>

          {job.status === "FAILED" && (job.errorCode || job.errorMessage) ? (
            <p className="mt-1.5 line-clamp-2 rounded-lg border border-rose-200 bg-rose-50/70 px-2.5 py-1.5 text-xs text-rose-700">
              {job.errorCode ? `[${job.errorCode}] ` : ""}
              {job.errorMessage || "任务执行失败"}
            </p>
          ) : null}

          {job.sourceImageUrls.length > 0 ? (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/50 p-2.5">
              <div className="mb-1.5 flex items-center justify-between text-xs text-amber-800">
                <span className="font-medium">上传参考图</span>
                <span>{job.sourceImageUrls.length} 张</span>
              </div>
              <SourceImageThumbs
                compact
                urls={job.sourceImageUrls}
                onZoom={(url) => setZoomedImage({ id: null, url })}
              />
            </div>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)]/60 pt-3">
          <div className="flex items-center gap-1.5">
            {onInspectJob ? (
              <button
                type="button"
                onClick={() => onInspectJob(job)}
                className="inline-flex items-center gap-1 rounded-lg border border-[var(--line)] bg-white px-2.5 py-1 text-xs font-medium text-[var(--ink)] transition hover:border-[#c85a32] hover:text-[#c85a32]"
              >
                <FileSearch className="size-3.5" aria-hidden />
                排障
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setShowPrompt(true)}
              className="rounded-lg border border-[var(--line)] bg-white px-2.5 py-1 text-xs font-medium text-[var(--ink-soft)] transition hover:border-[#c85a32] hover:text-[#c85a32]"
            >
              提示词
            </button>
            <button
              type="button"
              disabled={!image && !video}
              onClick={() => void handleCopyUrl()}
              aria-label="复制媒体地址"
              title="复制地址"
              className="inline-flex size-7 items-center justify-center rounded-lg border border-[var(--line)] bg-white text-[var(--ink-soft)] transition hover:text-[#c85a32] disabled:opacity-35"
            >
              <Copy className="size-3.5" aria-hidden />
            </button>
            {image ? (
              <button
                type="button"
                onClick={() => void downloadImage(image.url, "narra-generation")}
                aria-label="下载图片"
                title="下载图片"
                className="inline-flex size-7 items-center justify-center rounded-lg border border-[var(--line)] bg-white text-[var(--ink-soft)] transition hover:text-[#c85a32]"
              >
                <Download className="size-3.5" aria-hidden />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setDeleteError(null);
                setConfirmDelete(true);
              }}
              aria-label={`删除记录 ${job.id}`}
              title="删除记录"
              className="inline-flex size-7 items-center justify-center rounded-lg border border-rose-200 bg-rose-50/70 text-rose-600 transition hover:bg-rose-100"
            >
              <Trash2 className="size-3.5" aria-hidden />
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span
              className="max-w-[140px] truncate rounded bg-[#f4ede1] px-2 py-0.5 font-mono text-[11px] text-[var(--ink-soft)]"
              title={job.model}
            >
              {job.model}
            </span>
            <span className="font-mono font-semibold tabular-nums text-[var(--admin-ink-credit)]">
              {getCreditLabel(job)}
            </span>
          </div>
        </div>
      </div>

      {zoomedImage &&
      (zoomedImage.id === null ||
        job.images.some(
          (img) =>
            img.id === zoomedImage.id && adminImageAvailability(img) === "available",
        )) ? (
        <ImageLightbox
          src={zoomedImage.url}
          alt="Zoomed"
          rawSrc
          onClose={() => setZoomedImage(null)}
        />
      ) : null}

      {previewVideo && video ? (
        <AdminModal
          open
          onClose={() => setPreviewVideo(false)}
          size="lg"
          eyebrow="VIDEO PREVIEW"
          title="生成视频预览"
        >
          <video
            src={video.url}
            controls
            autoPlay
            playsInline
            className="max-h-[70vh] w-full rounded-xl bg-black"
          />
        </AdminModal>
      ) : null}

      {showPrompt ? (
        <PromptModal
          prompt={job.prompt}
          negativePrompt={job.negativePrompt}
          onClose={() => setShowPrompt(false)}
        />
      ) : null}

      <AdminConfirmDialog
        open={confirmDelete}
        onClose={() => {
          if (!deleting) setConfirmDelete(false);
        }}
        onConfirm={() => void handleDelete()}
        busy={deleting}
        tone="danger"
        title="删除此条生成记录"
        description="删除后该生成任务及关联产物记录将被物理清除（v1 契约协调任务除外）。"
        confirmLabel={deleting ? "删除中…" : "确认删除"}
        error={deleteError}
      />
    </article>
  );
}
