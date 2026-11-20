"use client";

/* eslint-disable @next/next/no-img-element */

// 右栏「生成结果」纯图片画廊：直接聚焦生成结果图、点击放大查看、下载与加入参考图。
import {
  AlertTriangle,
  Clock3,
  Download,
  ImagePlus,
  Loader2,
  RotateCcw,
  Ruler,
  SlidersHorizontal,
  Sparkles,
  X,
  ZoomIn,
} from "lucide-react";

import { ImageUnavailable } from "@/components/ui/image-unavailable";
import { getAspectRatio as getGenerationAspectRatio } from "@/lib/generation/sizes";
import { getThumbUrl } from "@/lib/image-url";
import { isImageAvailable } from "@/lib/storage/image-availability";
import { cn } from "@/lib/utils";

import { HISTORY_IMAGE_DRAG_MIME } from "../constants";
import type { GenerationItem } from "../types";
import {
  describeSizeDowngrade,
  getImageDimensionLabel,
  getImageRatioLabel,
} from "../utils";

type WorkbenchResultStageProps = {
  record: GenerationItem | null;
  onZoom: (url: string, meta?: { dimensionLabel?: string; ratioLabel?: string; recordId?: string; imageId?: string }) => void;
  onDownload: (url: string) => void;
  onAddToReference: (url: string) => void;
  onReuseConfig: (generation: GenerationItem) => void;
  onRetry: (generation: GenerationItem) => void;
  onCancel: (generation: GenerationItem) => void;
  className?: string;
};

function formatDuration(ms: number | null | undefined) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return null;
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}秒`;
  if (seconds === 0) return `${minutes}分钟`;
  return `${minutes}分${seconds}秒`;
}

function getGalleryGridClass(itemCount: number) {
  if (itemCount <= 1) return "max-w-[400px] grid-cols-1";
  if (itemCount === 3) return "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3";
  return "max-w-4xl grid-cols-1 sm:grid-cols-2";
}

export function WorkbenchResultStage({
  record,
  onZoom,
  onDownload,
  onAddToReference,
  onReuseConfig,
  onRetry,
  onCancel,
  className,
}: WorkbenchResultStageProps) {
  const durationLabel = formatDuration(record?.durationMs);
  const requestedAspect = record ? getGenerationAspectRatio(record.size) : undefined;

  return (
    <section
      aria-label="生成结果"
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-1 flex-col bg-[radial-gradient(circle_at_74%_10%,rgba(217,100,58,0.07),transparent_32%),linear-gradient(180deg,#faf6ef_0%,#f2e9dc_100%)]",
        className,
      )}
    >
      {/* 顶栏 */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--line)]/70 bg-[#fffaf2]/78 px-4 py-3 backdrop-blur-sm sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold tracking-tight text-[var(--ink)]">生成结果</h2>
          {record && (
            <>
              {record.status === "pending" ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/70 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700">
                  <Loader2 aria-hidden className="size-3 animate-spin" />
                  生成中
                </span>
              ) : record.status === "succeeded" ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                  已完成 · {record.images.length} 张
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-[11px] font-semibold text-rose-600">
                  生成失败
                </span>
              )}
              {durationLabel && (
                <span className="inline-flex items-center gap-1 rounded-full border border-[var(--line)]/80 bg-white/75 px-2.5 py-0.5 text-[11px] text-[var(--ink-soft)]">
                  <Clock3 aria-hidden className="size-3" />
                  用时 {durationLabel}
                </span>
              )}
            </>
          )}
        </div>

        {record && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onReuseConfig(record)}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-[var(--line)] bg-white/85 px-3 py-1.5 text-xs font-semibold text-[var(--ink)] shadow-2xs transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              <SlidersHorizontal aria-hidden className="size-3.5" />
              复用参数
            </button>
            {record.status === "pending" && (
              <button
                type="button"
                onClick={() => onCancel(record)}
                className="inline-flex cursor-pointer items-center gap-1 rounded-xl border border-[var(--line)] bg-white/85 px-3 py-1.5 text-xs font-semibold text-[var(--ink-soft)] transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600"
              >
                <X aria-hidden className="size-3.5" />
                取消生成
              </button>
            )}
            {record.status === "failed" && (
              <button
                type="button"
                onClick={() => onRetry(record)}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-[#24170f] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[var(--accent)]"
              >
                <RotateCcw aria-hidden className="size-3.5" />
                重新生成
              </button>
            )}
          </div>
        )}
      </div>

      {/* 主画廊内容（直接展示图片 / 生成卡片，不堆砌重复提示词块） */}
      <div className="premium-scrollbar flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        {!record ? (
          <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center text-center">
            <div className="mb-4 flex size-16 items-center justify-center rounded-3xl border border-[var(--line)] bg-[#fffaf2] shadow-[0_14px_30px_rgba(84,52,29,0.08)]">
              <Sparkles aria-hidden className="size-7 text-[var(--accent)]" />
            </div>
            <h3 className="text-base font-semibold text-[var(--ink)]">准备好开始创作了吗</h3>
            <p className="mt-2 text-xs leading-relaxed text-[var(--ink-soft)]">
              在中间「生图工作台」填写提示词或拖入参考图，点击「开始生成」后，图片会直接在这里呈现。
            </p>
          </div>
        ) : record.status === "pending" ? (
          (() => {
            const pendingTotal = Math.max(1, Math.min(4, record.count || 1));
            return (
              <div
                role="status"
                aria-label="图片生成中"
                className={cn("grid gap-4", getGalleryGridClass(pendingTotal))}
              >
                {Array.from({ length: pendingTotal }, (_, index) => (
                  <div
                    key={index}
                    className="relative flex min-h-[280px] flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed border-[var(--line)] bg-[#fffaf2]/88 p-6 shadow-2xs skeleton-shimmer"
                    style={requestedAspect ? { aspectRatio: requestedAspect } : { aspectRatio: "1 / 1" }}
                  >
                    <Loader2 aria-hidden className="mb-2.5 size-6 animate-spin text-[var(--accent)]" />
                    <p className="text-sm font-semibold text-[var(--ink)]">生成中</p>
                    {pendingTotal > 1 && (
                      <p className="mt-1 text-[11px] text-[var(--ink-soft)]">
                        第 {index + 1} / {pendingTotal} 张
                      </p>
                    )}
                  </div>
                ))}
              </div>
            );
          })()
        ) : record.status === "failed" || record.images.length === 0 ? (
          <div className="max-w-xl rounded-2xl border border-rose-200 bg-rose-50/85 p-5 shadow-2xs">
            <p className="text-sm font-semibold text-rose-700">本次生成未能完成</p>
            <p className="mt-1.5 text-xs leading-relaxed text-rose-600">
              {record.errorMessage || "生成失败或图片未能成功返回，预扣积分已按规则处理。"}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onRetry(record)}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-[#24170f] px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-[var(--accent)]"
              >
                <RotateCcw aria-hidden className="size-3.5" />
                重新生成
              </button>
              <button
                type="button"
                onClick={() => onReuseConfig(record)}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-[var(--line)] bg-white px-3.5 py-2 text-xs font-semibold text-[var(--ink)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                <SlidersHorizontal aria-hidden className="size-3.5" />
                复用参数修改
              </button>
            </div>
          </div>
        ) : (
          <div className={cn("grid gap-4", getGalleryGridClass(record.images.length))}>
            {record.images.map((image, index) => {
              const imageAvailable = isImageAvailable(image.availability);
              const downgrade = describeSizeDowngrade(record, image);
              const dimensionLabel = getImageDimensionLabel(record, image);
              const ratioLabel = getImageRatioLabel(record, image);
              const thumbWidth = record.images.length > 1 ? 640 : 1080;
              const imageAspect =
                image.actualWidth && image.actualHeight
                  ? `${image.actualWidth} / ${image.actualHeight}`
                  : requestedAspect;

              return (
                <article
                  key={image.id}
                  className="group overflow-hidden rounded-2xl border border-[var(--line)] bg-[#fffcf7] shadow-[0_14px_34px_rgba(84,52,29,0.09)]"
                >
                  <div
                    className="relative overflow-hidden bg-[#efe6d8]/65"
                    style={imageAspect ? { aspectRatio: imageAspect } : undefined}
                  >
                    {imageAvailable ? (
                      <>
                        <img
                          src={getThumbUrl(image.url, thumbWidth)}
                          alt={`生成结果 ${index + 1}`}
                          loading="lazy"
                          decoding="async"
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.setData(HISTORY_IMAGE_DRAG_MIME, image.url);
                            event.dataTransfer.setData("text/uri-list", image.url);
                            event.dataTransfer.effectAllowed = "copy";
                          }}
                          onClick={() => onZoom(image.url, { dimensionLabel, ratioLabel, recordId: record.id, imageId: image.id })}
                          className="block size-full max-h-[68vh] cursor-zoom-in object-contain transition-transform duration-200 ease-out group-hover:scale-[1.015]"
                        />
                        <span
                          aria-hidden
                          className="pointer-events-none absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white opacity-0 backdrop-blur-xs transition group-hover:opacity-100"
                        >
                          <ZoomIn className="size-3" />
                          点击放大
                        </span>
                      </>
                    ) : (
                      <ImageUnavailable availability={image.availability} className="min-h-60 size-full" />
                    )}
                  </div>

                  {downgrade && (
                    <div
                      className="flex items-start gap-1.5 border-t border-amber-400/35 bg-amber-50 px-3.5 py-2 text-[11px] leading-snug text-amber-800"
                      title="渠道返回的实际像素与请求不一致，常见于部分上游渠道对超大尺寸的静默降级"
                    >
                      <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                      <span>
                        {downgrade.shrunk ? "渠道降级了请求尺寸" : "渠道返回了不同尺寸"}：请求 {downgrade.requested}，实际 {downgrade.actual}
                      </span>
                    </div>
                  )}

                  <div className="space-y-2 border-t border-[var(--line)]/60 bg-[#fffaf2]/92 px-3.5 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--ink-soft)]">
                      <span className="inline-flex items-center gap-1 font-medium text-[var(--ink)]">
                        <Ruler aria-hidden className="size-3 text-[var(--ink-soft)]" />
                        {dimensionLabel}
                        <span className="text-[var(--ink-soft)]">· {ratioLabel}</span>
                      </span>
                      {durationLabel && <span>{durationLabel}</span>}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={!imageAvailable}
                        onClick={() => onAddToReference(image.url)}
                        className="inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-[var(--line)] bg-[#f4ebde] px-2.5 py-1.5 text-xs font-semibold text-[var(--ink)] transition hover:border-[var(--accent)] hover:bg-[#fff4e8] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <ImagePlus aria-hidden className="size-3.5" />
                        加入参考图
                      </button>
                      <button
                        type="button"
                        disabled={!imageAvailable}
                        onClick={() => onDownload(image.url)}
                        aria-label="下载保存"
                        title="下载保存"
                        className="inline-flex cursor-pointer items-center justify-center gap-1 rounded-xl border border-[var(--line)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--ink-soft)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <Download aria-hidden className="size-3.5" />
                        下载
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
