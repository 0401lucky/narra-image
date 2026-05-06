"use client";

/* eslint-disable @next/next/no-img-element */

import type { GenerationImage, GenerationJob, User } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  Copy,
  Download,
  FileText,
  ImageIcon,
  Loader2,
  Trash2,
  X,
} from "lucide-react";

import { downloadImage } from "@/components/works/download-image";
import { ImageLightbox } from "@/components/works/image-lightbox";
import { PromptModal } from "@/components/works/prompt-modal";
import { Alert } from "@/components/ui/alert";
import { getThumbUrl } from "@/lib/image-url";

export type GenerationAdminJob = GenerationJob & {
  images: GenerationImage[];
  user: Pick<User, "email">;
};

function getGenerationStatusLabel(status: GenerationAdminJob["status"]) {
  if (status === "PENDING") return "生成中";
  if (status === "FAILED") return "已失败";
  return "已完成";
}

function getMissingImageLabel(status: GenerationAdminJob["status"]) {
  if (status === "PENDING") return "生成中";
  if (status === "FAILED") return "生成失败";
  return "图片缺失";
}

function getCreditLabel(job: GenerationAdminJob) {
  if (job.status === "FAILED") return "已退还";
  if (job.status === "PENDING" && job.creditsSpent > 0) {
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

function getProviderModeLabel(job: GenerationAdminJob) {
  return job.providerMode === "BUILT_IN" ? "内置渠道" : "自填渠道";
}

function getGenerationTypeLabel(job: GenerationAdminJob) {
  return job.generationType === "IMAGE_TO_IMAGE" ? "图生图" : "文生图";
}

function getClientSourceLabel(job: GenerationAdminJob) {
  return job.clientSource === "API" ? "API 调用" : "网页";
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
          className="group relative overflow-hidden rounded-lg border border-amber-200 bg-amber-50/70 shadow-sm transition hover:border-amber-400"
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
          <span className="absolute inset-x-0 bottom-0 bg-amber-950/55 px-1 py-0.5 text-[9px] leading-none text-white opacity-0 transition group-hover:opacity-100">
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

export function GenerationAdminList({ jobs }: { jobs: GenerationAdminJob[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [promptJob, setPromptJob] = useState<GenerationAdminJob | null>(null);
  const [zoomedGeneratedImage, setZoomedGeneratedImage] = useState<string | null>(null);
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

  async function handleCopyImageUrl(job: GenerationAdminJob) {
    const url = job.images[0]?.url;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopyFeedback("图片地址已复制");
    } catch {
      setCopyFeedback("复制失败，请手动复制");
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTargetIds?.length) return;
    setDeleteError(null);
    setIsDeleting(true);
    try {
      const response = await fetch("/api/admin/generations", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: deleteTargetIds }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        setDeleteError(result.error || "删除失败，请稍后再试");
        return;
      }

      setHiddenIds((current) => {
        const next = new Set(current);
        deleteTargetIds.forEach((id) => next.add(id));
        return next;
      });
      setSelectedIds((current) => {
        const next = new Set(current);
        deleteTargetIds.forEach((id) => next.delete(id));
        return next;
      });
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
      <div className="studio-card overflow-hidden rounded-[1.4rem] border border-[var(--line)]">
        <div className="flex flex-col gap-3 border-b border-[var(--line)] bg-white/70 px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div className="text-sm text-[var(--ink-soft)]">
            已选{" "}
            <span className="font-semibold text-[var(--ink)]">
              {selectedVisibleCount}
            </span>{" "}
            条，本页共 {visibleJobs.length} 条
            {copyFeedback ? (
              <span className="ml-3 text-[var(--accent)]">{copyFeedback}</span>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={toggleAll}
              disabled={visibleJobs.length === 0}
              className="rounded-full border border-[var(--line)] px-3 py-2 text-xs font-medium text-[var(--ink-soft)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
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
              className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 px-3 py-2 text-xs font-medium text-rose-600 transition hover:border-rose-400 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 className="size-3.5" />
              批量删除
            </button>
          </div>
        </div>

        <div className="grid gap-3 p-3 lg:hidden">
          {visibleJobs.map((job) => {
            const image = job.images[0];
            const checked = selectedIds.has(job.id);
            return (
              <article
                key={job.id}
                className={`rounded-[1.2rem] border border-[var(--line)] bg-white/45 p-3 transition ${
                  checked ? "ring-2 ring-[var(--accent)]/30" : ""
                }`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    aria-label={`选择生成记录 ${job.id}`}
                    checked={checked}
                    onChange={() => toggleOne(job.id)}
                    className="mt-5 size-4 shrink-0 rounded border-[var(--line)]"
                  />
                  {image ? (
                    <button
                      type="button"
                      onClick={() => setZoomedGeneratedImage(image.url)}
                      className="shrink-0 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-strong)]"
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
                  ) : (
                    <div className="flex size-16 shrink-0 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--surface-strong)]/60 text-[var(--ink-soft)]">
                      <ImageIcon className="size-5" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[var(--ink)]">
                      {job.user?.email || "未知用户"}
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[var(--ink-soft)]">
                      {job.prompt}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-[var(--ink-soft)]">
                      <span className="rounded-full border border-[var(--line)] bg-white/60 px-2 py-0.5">
                        {getGenerationStatusLabel(job.status)}
                      </span>
                      <span className="rounded-full border border-[var(--line)] bg-white/60 px-2 py-0.5">
                        {getGenerationTypeLabel(job)}
                      </span>
                      <span className="rounded-full border border-[var(--line)] bg-white/60 px-2 py-0.5">
                        {getClientSourceLabel(job)}
                      </span>
                      <span className="rounded-full border border-[var(--line)] bg-white/60 px-2 py-0.5">
                        {getCreditLabel(job)}
                      </span>
                    </div>
                  </div>
                </div>

                {job.sourceImageUrls.length > 0 ? (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/55 p-2">
                    <div className="mb-2 flex items-center justify-between text-[11px] text-amber-800">
                      <span className="font-medium">上传参考图</span>
                      <span>{job.sourceImageUrls.length} 张</span>
                    </div>
                    <SourceImageThumbs
                      compact
                      urls={job.sourceImageUrls}
                      onZoom={setZoomedSourceImage}
                    />
                  </div>
                ) : null}

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)]/60 pt-3">
                  <span
                    className="max-w-full truncate rounded-lg bg-[var(--surface-strong)] px-2.5 py-1 text-[11px] text-[var(--ink-soft)]"
                    title={job.model}
                  >
                    {job.model}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setPromptJob(job)}
                      className="inline-flex size-9 items-center justify-center rounded-xl bg-[var(--surface-strong)] text-[var(--ink-soft)]"
                      title="完整提示词"
                    >
                      <FileText className="size-4" />
                    </button>
                    <button
                      type="button"
                      disabled={!image}
                      onClick={() => void handleCopyImageUrl(job)}
                      className="inline-flex size-9 items-center justify-center rounded-xl bg-[var(--surface-strong)] text-[var(--ink-soft)] disabled:opacity-35"
                      title="复制图片地址"
                    >
                      <Copy className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTargetIds([job.id])}
                      className="inline-flex size-9 items-center justify-center rounded-xl bg-rose-50 text-rose-600"
                      title="删除记录"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full min-w-[1280px] border-collapse text-left text-sm">
            <thead className="bg-[var(--surface-strong)]/55 text-xs text-[var(--ink-soft)]">
              <tr>
                <th className="w-14 px-5 py-4">
                  <input
                    type="checkbox"
                    aria-label="选择本页生成记录"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="size-4 rounded border-[var(--line)]"
                  />
                </th>
                <th className="px-4 py-4 font-medium">预览</th>
                <th className="px-4 py-4 font-medium">参考图</th>
                <th className="px-4 py-4 font-medium">记录</th>
                <th className="px-4 py-4 font-medium">标签</th>
                <th className="px-4 py-4 font-medium">渠道</th>
                <th className="px-4 py-4 font-medium">模型</th>
                <th className="px-4 py-4 font-medium">积分</th>
                <th className="px-4 py-4 font-medium">时间</th>
                <th className="px-4 py-4 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]/70">
              {visibleJobs.map((job) => {
                const image = job.images[0];
                const checked = selectedIds.has(job.id);
                return (
                  <tr
                    key={job.id}
                    className={`transition hover:bg-white/70 ${
                      checked ? "bg-[var(--surface-strong)]/45" : "bg-white/35"
                    }`}
                  >
                    <td className="px-5 py-4 align-middle">
                      <input
                        type="checkbox"
                        aria-label={`选择生成记录 ${job.id}`}
                        checked={checked}
                        onChange={() => toggleOne(job.id)}
                        className="size-4 rounded border-[var(--line)]"
                      />
                    </td>
                    <td className="px-4 py-4 align-middle">
                      {image ? (
                        <button
                          type="button"
                          onClick={() => setZoomedGeneratedImage(image.url)}
                          className="block overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-strong)]"
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
                      ) : (
                        <div className="flex size-14 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--surface-strong)]/60 text-[var(--ink-soft)]">
                          <ImageIcon className="size-5" />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-4 align-middle">
                      {job.sourceImageUrls.length > 0 ? (
                        <SourceImageThumbs
                          compact
                          urls={job.sourceImageUrls}
                          onZoom={setZoomedSourceImage}
                        />
                      ) : (
                        <span className="text-xs text-[var(--ink-soft)]/60">
                          -
                        </span>
                      )}
                    </td>
                    <td className="max-w-[360px] px-4 py-4 align-middle">
                      <p className="truncate font-medium text-[var(--ink)]">
                        {job.user?.email || "未知用户"}
                      </p>
                      <p className="mt-1 line-clamp-1 text-xs text-[var(--ink-soft)]">
                        {job.prompt}
                      </p>
                      <p className="mt-1 font-mono text-[11px] text-[var(--ink-soft)]/70">
                        {job.id}
                      </p>
                    </td>
                    <td className="px-4 py-4 align-middle text-xs text-[var(--ink-soft)]">
                      <div className="flex flex-wrap gap-1.5">
                        <span className="rounded-full border border-[var(--line)] bg-white/60 px-2 py-1">
                          {getGenerationStatusLabel(job.status)}
                        </span>
                        <span className="rounded-full border border-[var(--line)] bg-white/60 px-2 py-1">
                          {getGenerationTypeLabel(job)}
                        </span>
                        <span className="rounded-full border border-[var(--line)] bg-white/60 px-2 py-1">
                          {getClientSourceLabel(job)}
                        </span>
                        {job.sourceImageUrls.length > 0 ? (
                          <span className="rounded-full border border-[var(--line)] bg-white/60 px-2 py-1">
                            参考图 {job.sourceImageUrls.length}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-4 align-middle text-[var(--ink-soft)]">
                      {getProviderModeLabel(job)}
                    </td>
                    <td className="max-w-[180px] px-4 py-4 align-middle">
                      <span
                        className="inline-block max-w-full truncate rounded-lg bg-[var(--surface-strong)] px-2.5 py-1 text-xs text-[var(--ink-soft)]"
                        title={job.model}
                      >
                        {job.model}
                      </span>
                    </td>
                    <td className="px-4 py-4 align-middle text-sm font-medium text-[var(--accent-soft)]">
                      {getCreditLabel(job)}
                    </td>
                    <td className="px-4 py-4 align-middle text-[var(--ink-soft)]">
                      {formatAdminDate(job.createdAt)}
                    </td>
                    <td className="px-4 py-4 align-middle">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setPromptJob(job)}
                          className="inline-flex size-9 items-center justify-center rounded-xl bg-[var(--surface-strong)] text-[var(--ink-soft)] transition hover:text-[var(--accent)]"
                          title="完整提示词"
                        >
                          <FileText className="size-4" />
                        </button>
                        <button
                          type="button"
                          disabled={!image}
                          onClick={() => void handleCopyImageUrl(job)}
                          className="inline-flex size-9 items-center justify-center rounded-xl bg-[var(--surface-strong)] text-[var(--ink-soft)] transition hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-35"
                          title="复制图片地址"
                        >
                          <Copy className="size-4" />
                        </button>
                        <button
                          type="button"
                          disabled={!image}
                          onClick={() =>
                            image
                              ? void downloadImage(image.url, "narra-generation")
                              : undefined
                          }
                          className="inline-flex size-9 items-center justify-center rounded-xl bg-[var(--surface-strong)] text-[var(--ink-soft)] transition hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-35"
                          title="下载图片"
                        >
                          <Download className="size-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTargetIds([job.id])}
                          className="inline-flex size-9 items-center justify-center rounded-xl bg-rose-50 text-rose-600 transition hover:bg-rose-100"
                          title="删除记录"
                        >
                          <Trash2 className="size-4" />
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

      {zoomedGeneratedImage ? (
        <ImageLightbox
          src={zoomedGeneratedImage}
          alt="生成图片大图"
          onClose={() => setZoomedGeneratedImage(null)}
        >
          <span className="rounded-full bg-white/90 px-4 py-2 text-sm font-medium text-[var(--ink)]">
            生成图片
          </span>
        </ImageLightbox>
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

      {deleteTargetIds ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={() => {
            if (!isDeleting) setDeleteTargetIds(null);
          }}
        >
          <div
            className="studio-card w-full max-w-md rounded-[1.8rem] p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-[var(--ink)]">
              删除生成记录
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--ink-soft)]">
              将删除 {deleteCount} 条生成任务及其图片记录，操作不可恢复。是否继续？
            </p>
            {deleteError ? (
              <div className="mt-3">
                <Alert variant="error">{deleteError}</Alert>
              </div>
            ) : null}
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setDeleteTargetIds(null)}
                className="rounded-full border border-[var(--line)] px-4 py-2 text-sm text-[var(--ink-soft)] disabled:opacity-60"
              >
                取消
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => void handleConfirmDelete()}
                className="inline-flex items-center gap-2 rounded-full bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-700 disabled:opacity-60"
              >
                {isDeleting ? <Loader2 className="size-4 animate-spin" /> : null}
                {isDeleting ? "删除中" : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function InviteCreator() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [count, setCount] = useState(1);
  const [downloadAfterCreate, setDownloadAfterCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function downloadBatchTxt(batchId: string) {
    const exportRes = await fetch(`/api/admin/invites/batches/${batchId}/export`);
    if (!exportRes.ok) {
      throw new Error("下载邀请码文件失败");
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

  async function handleCreate() {
    setError(null);
    const response = await fetch("/api/admin/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note, count, isPublic }),
    });
    const result = (await response.json()) as {
      data?: { batchId: string; claimPageUrl: string; message: string };
      error?: string;
    };

    if (!response.ok) {
      setError(result.error || "创建失败");
      return;
    }

    if (downloadAfterCreate && result.data?.batchId) {
      try {
        await downloadBatchTxt(result.data.batchId);
      } catch (err) {
        // 下载失败不阻断创建流程，提示用户后续可从批次卡片手动下载
        setError(
          err instanceof Error
            ? `${err.message}，请稍后从批次卡片手动下载`
            : "下载失败，请稍后从批次卡片手动下载",
        );
      }
    }

    setNote("");
    setIsPublic(false);
    setCount(1);
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className="studio-card rounded-[1.8rem] p-5 md:p-6">
      <h3 className="text-lg font-medium">创建邀请码</h3>
      <p className="mt-1 text-sm text-[var(--ink-soft)]">
        建议为每个邀请码写备注，并可批量生成多个。
      </p>
      <div className="mt-4 flex flex-col gap-3">
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="备注，例如：首批设计师"
          className="flex-1 rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 outline-none transition-all focus:border-[var(--accent)]"
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap">
          <label className="inline-flex items-center gap-2 rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 text-sm text-[var(--ink-soft)]">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(event) => setIsPublic(event.target.checked)}
            />
            开放领取
          </label>
          <label className="inline-flex items-center gap-2 rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 text-sm text-[var(--ink-soft)]">
            <input
              type="checkbox"
              checked={downloadAfterCreate}
              onChange={(event) => setDownloadAfterCreate(event.target.checked)}
            />
            生成后下载 .txt
          </label>
          <input
            type="number"
            min={1}
            max={100}
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
            className="w-24 shrink-0 rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 text-center outline-none transition-all focus:border-[var(--accent)]"
            title="生成数量"
          />
          <button
            type="button"
            disabled={isPending}
            onClick={() => startTransition(handleCreate)}
            className="shrink-0 rounded-full bg-[var(--ink)] px-6 py-3 text-sm font-medium text-white shadow-lg transition hover:bg-[var(--accent)] disabled:opacity-60"
          >
            {isPending ? "创建中..." : "批量生成"}
          </button>
        </div>
      </div>
      {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}
    </div>
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
  const [isPending, startTransition] = useTransition();

  async function handleToggle() {
    await fetch(`/api/admin/invites/batches/${batchId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        isPublic: !isPublic,
      }),
    });

    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => startTransition(handleToggle)}
      className={`rounded-full px-3 py-2 text-xs font-medium ${
        isPublic
          ? "bg-[var(--accent)] text-white"
          : "border border-[var(--line)] text-[var(--ink-soft)]"
      }`}
    >
      {isPending ? "处理中..." : isPublic ? "关闭领取" : "开放领取"}
    </button>
  );
}

export function InviteBatchDelete({
  batchId,
  total,
  remaining,
}: {
  batchId: string;
  total: number;
  remaining: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  async function handleDelete() {
    const used = total - remaining;
    const message =
      used > 0
        ? `确定要删除整个批次吗？共 ${total} 个邀请码（其中 ${used} 个已使用/已发放），删除后不可恢复。`
        : `确定要删除整个批次吗？共 ${total} 个邀请码将被一并清除，且不可恢复。`;
    if (!confirm(message)) return;

    const response = await fetch(`/api/admin/invites/batches/${batchId}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      alert(result?.error || "删除失败");
      return;
    }

    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => startTransition(handleDelete)}
      className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 px-3 py-2 text-xs font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-60"
      title="删除整个批次"
    >
      <Trash2 className="size-3.5" />
      {isPending ? "删除中..." : "删除批次"}
    </button>
  );
}

export function CreditAdjuster({ userId }: { userId: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState(50);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleAdjust() {
    setError(null);

    const response = await fetch(`/api/admin/users/${userId}/credits`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount }),
    });
    const result = (await response.json()) as { error?: string };

    if (!response.ok) {
      setError(result.error || "调整失败");
      return;
    }

    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={amount}
          onChange={(event) => setAmount(Number(event.target.value))}
          className="w-24 rounded-xl border border-[var(--line)] bg-white/70 px-3 py-2 text-sm outline-none"
        />
        <button
          type="button"
          disabled={isPending}
          onClick={() => startTransition(handleAdjust)}
          className="rounded-full border border-[var(--line)] px-3 py-2 text-xs text-[var(--ink-soft)] disabled:opacity-60"
        >
          更新积分
        </button>
      </div>
      {error ? <span className="text-xs text-rose-600">{error}</span> : null}
    </div>
  );
}


export function GenerationAdminCard({ job }: { job: GenerationAdminJob }) {
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  return (
    <article className="studio-card flex flex-col xl:flex-row gap-5 p-5 rounded-[1.8rem]">
      {job.images && job.images[0] ? (
        <div className="shrink-0 flex justify-center">
          <img
            src={getThumbUrl(job.images[0].url, 384)}
            alt="Thumbnail"
            loading="lazy"
            decoding="async"
            className="size-32 xl:size-40 rounded-xl object-cover cursor-pointer hover:scale-105 transition border border-[var(--line)] shadow-sm"
            onClick={() => setZoomedImage(job.images[0].url)}
          />
        </div>
      ) : (
        <div className="flex size-32 xl:size-40 shrink-0 mx-auto xl:mx-0 items-center justify-center rounded-xl bg-[var(--surface-strong)]/50 text-xs text-[var(--ink-soft)] border border-[var(--line)]">
          {getMissingImageLabel(job.status)}
        </div>
      )}
      
      <div className="flex-1 min-w-0 flex flex-col justify-between">
        <div className="mb-3">
          <div className="flex items-center justify-between text-xs text-[var(--ink-soft)] mb-2">
            <span className="truncate max-w-[150px]" title={job.user?.email}>{job.user?.email || "未知用户"}</span>
            <div className="flex items-center gap-2">
              <span className="shrink-0 rounded-full bg-[var(--surface-strong)] border border-[var(--line)] px-2 py-0.5">
                {getGenerationStatusLabel(job.status)}
              </span>
              <span className="shrink-0 rounded-full bg-[var(--surface-strong)] border border-[var(--line)] px-2 py-0.5">
                {job.generationType === "IMAGE_TO_IMAGE" ? "图生图" : "文生图"}
              </span>
              <span className="shrink-0 rounded-full bg-[var(--surface-strong)] border border-[var(--line)] px-2 py-0.5">
                {getClientSourceLabel(job)}
              </span>
              <span className="shrink-0 rounded-full bg-[var(--surface-strong)] border border-[var(--line)] px-2 py-0.5">
                {job.providerMode === "BUILT_IN" ? "内置渠道" : "自填渠道"}
              </span>
            </div>
          </div>
          <p className="line-clamp-2 text-sm text-[var(--ink)] leading-relaxed">
            {job.prompt}
          </p>
          {job.sourceImageUrls.length > 0 ? (
            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50/55 p-3">
              <div className="mb-2 flex items-center justify-between gap-3 text-xs text-amber-800">
                <span className="font-medium">上传参考图</span>
                <span>{job.sourceImageUrls.length} 张</span>
              </div>
              <SourceImageThumbs
                urls={job.sourceImageUrls}
                onZoom={setZoomedImage}
              />
            </div>
          ) : null}
        </div>
        
        <div className="flex items-center justify-between mt-auto pt-2 border-t border-[var(--line)]/50">
          <button 
            type="button" 
            onClick={() => setShowPrompt(true)}
            className="text-xs text-[var(--accent)] hover:underline font-medium"
          >
            完整提示词
          </button>
          <div className="flex items-center gap-3 text-xs text-[var(--ink-soft)]">
            <span className="shrink-0 bg-[var(--surface-strong)] rounded px-1.5 py-0.5">{job.model}</span>
            <span className="shrink-0 font-medium text-[var(--accent-soft)]">{getCreditLabel(job)}</span>
          </div>
        </div>
      </div>

      {zoomedImage && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={() => setZoomedImage(null)}
        >
          <button 
            type="button"
            className="absolute top-6 right-6 text-white/70 transition hover:text-white hover:scale-110"
            onClick={() => setZoomedImage(null)}
            title="关闭"
          >
            <X className="size-8" />
          </button>
          <img
            src={zoomedImage}
            alt="Zoomed"
            decoding="async"
            className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {showPrompt && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setShowPrompt(false)}
        >
          <div 
            className="studio-card relative w-full max-w-2xl rounded-[2rem] p-6 md:p-8 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <button 
              type="button"
              className="absolute top-6 right-6 text-[var(--ink-soft)] transition hover:text-[var(--ink)]"
              onClick={() => setShowPrompt(false)}
            >
              <X className="size-6" />
            </button>
            <h3 className="text-xl font-semibold mb-6">完整提示词</h3>
            <p className="whitespace-pre-wrap text-[var(--ink)] leading-relaxed text-sm">
              {job.prompt}
            </p>
            {job.negativePrompt && (
              <div className="mt-6 border-t border-[var(--line)] pt-4">
                <h4 className="text-sm font-medium text-[var(--ink-soft)] mb-2">负向提示词</h4>
                <p className="whitespace-pre-wrap text-[var(--ink)]/80 leading-relaxed text-sm">
                  {job.negativePrompt}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
