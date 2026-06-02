"use client";

/* eslint-disable @next/next/no-img-element */

// 单条生成消息气泡（用户提示 + Narra 结果）。
import { AlertTriangle, Clock3, Download, ImagePlus, RotateCcw, Ruler, SlidersHorizontal, Sparkles, X, ZoomIn } from "lucide-react";

import { getAspectRatio as getGenerationAspectRatio } from "@/lib/generation/sizes";
import { getThumbUrl } from "@/lib/image-url";

import {
  describeSizeDowngrade,
  getImageDimensionLabel,
  getImageRatioLabel,
  getGenerationOptionSummary,
  getGenerationSourceImageUrls,
} from "../utils";
import type { GenerationItem } from "../types";

type GenerationBubbleProps = {
  generation: GenerationItem;
  onZoom: (url: string, meta?: { dimensionLabel?: string; ratioLabel?: string }) => void;
  onDownload: (url: string) => void;
  onUseForEdit: (url: string) => void;
  onReuseConfig?: (generation: GenerationItem) => void;
  onRetry?: (generation: GenerationItem) => void;
  onCancel?: (generation: GenerationItem) => void;
};

function formatDuration(ms: number | null | undefined) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
    return null;
  }

  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}秒`;
  }
  if (seconds === 0) {
    return `${minutes}分钟`;
  }
  return `${minutes}分${seconds}秒`;
}

export function GenerationBubble({
  generation,
  onZoom,
  onDownload,
  onUseForEdit,
  onReuseConfig,
  onRetry,
  onCancel,
}: GenerationBubbleProps) {
  const sourceUrls = getGenerationSourceImageUrls(generation);
  const durationLabel = formatDuration(generation.durationMs);
  return (
    <div
      id={`gen-${generation.id}`}
      className="generation-bubble space-y-6"
    >
      <div className="flex gap-3 sm:gap-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full border border-[var(--line)] bg-[#efe4d4] text-xs font-semibold text-[#3a281d] shadow-sm sm:size-10 sm:text-sm">
          You
        </div>
        <div className="flex max-w-[calc(100%-2.5rem)] flex-col gap-2 sm:max-w-[85%]">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--ink)]">You</span>
            <span className="text-xs text-[var(--ink-soft)] bg-[var(--surface-strong)] px-2 py-0.5 rounded-full">
              {generation.generationType === "image_to_image" ? "图生图" : "文生图"}
            </span>
          </div>
          <div className="whitespace-pre-wrap break-words rounded-[1.15rem] rounded-tl-md border border-[var(--line)] bg-[#fffaf2]/82 px-4 py-3 text-sm leading-relaxed text-[var(--ink)] shadow-[0_10px_24px_rgba(84,52,29,0.08)] sm:px-5 sm:py-3.5">
            {generation.prompt}
            {sourceUrls.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {sourceUrls.map((url, index) => (
                  <img
                    key={`${url}_${index}`}
                    src={getThumbUrl(url, 192)}
                    alt="Reference"
                    loading="lazy"
                    decoding="async"
                    className="h-20 w-auto rounded-lg border border-[var(--line)] object-cover shadow-sm sm:h-24"
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex gap-3 sm:gap-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#e06b47] via-[#cc5aa5] to-[#9a77c7] text-white shadow-[0_12px_24px_rgba(154,79,139,0.25)] sm:size-10">
          <Sparkles className={`size-4 sm:size-5 ${generation.status === "pending" ? "animate-pulse" : ""}`} />
        </div>
        <div className="flex w-full max-w-[calc(100%-2.5rem)] flex-col gap-2 sm:max-w-[85%]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-[var(--ink)]">Narra AI</span>
            {generation.status === "pending" ? (
              <span className="text-xs text-[var(--ink-soft)] animate-pulse">正在生成中...</span>
            ) : (
              <span className="text-xs text-[var(--ink-soft)]">{getGenerationOptionSummary(generation)}</span>
            )}
          </div>

          {generation.status === "pending" ? (
            <div className="flex flex-col gap-2">
              <div className="relative flex w-full max-w-[18rem] items-center gap-3.5 overflow-hidden rounded-[1.15rem] border border-[var(--line)] bg-gradient-to-r from-[#fffaf2]/90 to-[#fdf6e9]/90 px-4 py-3.5 shadow-sm backdrop-blur-xl skeleton-shimmer" role="status" aria-label="图片生成中">
                <div className="relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-rose-400 via-amber-300 to-sky-400 shadow-[0_4px_12px_rgba(217,100,58,0.25)] animate-pulse">
                  <Sparkles className="size-4 text-white" />
                </div>
                <div className="relative z-10 flex flex-col gap-0.5">
                  <span className="text-sm font-bold text-[var(--ink)] tracking-tight">正在显影中<span className="animate-pulse">...</span></span>
                  <span className="text-xs font-medium text-[var(--ink-soft)]">Narra 正在挥动魔杖</span>
                </div>
              </div>
              {onCancel && (
                <button
                  type="button"
                  onClick={() => onCancel(generation)}
                  className="inline-flex w-fit items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface)]/80 px-3 py-1 text-xs text-[var(--ink-soft)] transition hover:border-rose-400 hover:text-rose-500"
                  title="停止前端轮询并把任务标记为已取消（后端可能仍在生成，但结果不再展示）"
                >
                  <X className="size-3" />
                  取消生成
                </button>
              )}
            </div>
          ) : generation.images.length > 0 ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--ink-soft)]">
                <span>结果 {generation.images.length}</span>
                {durationLabel && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full border border-[var(--line)]/70 bg-[#fffaf2]/70 px-2 py-0.5"
                    title="从提交任务到结果写入完成的总耗时"
                  >
                    <Clock3 className="size-3" />
                    用时 {durationLabel}
                  </span>
                )}
              </div>
              <div
                className={`grid w-full gap-3 ${generation.images.length > 1 ? "grid-cols-1 min-[520px]:grid-cols-2" : "grid-cols-1"}`}
                style={{ maxWidth: generation.images.length === 1 ? "min(100%, 360px)" : "min(100%, 740px)" }}
              >
                {generation.images.map((image) => {
                  const downgrade = describeSizeDowngrade(generation, image);
                  const dimensionLabel = getImageDimensionLabel(generation, image);
                  const ratioLabel = getImageRatioLabel(generation, image);
                  return (
                    <div
                      key={image.id}
                      className="group relative overflow-hidden rounded-[1.15rem] border border-[var(--line)] bg-[#fffaf2]/90 shadow-[0_16px_34px_rgba(84,52,29,0.12)]"
                    >
                      <div
                        className="relative overflow-hidden bg-[var(--surface-strong)]/40"
                        style={getGenerationAspectRatio(generation.size) ? { aspectRatio: getGenerationAspectRatio(generation.size) } : undefined}
                      >
                        <img
                          src={getThumbUrl(image.url, 640)}
                          alt="生成结果"
                          loading="lazy"
                          decoding="async"
                          className="size-full cursor-pointer object-cover transition-transform duration-200 ease-out hover:scale-[1.015]"
                          onClick={() => onZoom(image.url, { dimensionLabel, ratioLabel })}
                        />
                        <div className="absolute bottom-2 left-2 flex flex-wrap gap-1.5">
                          <span className="inline-flex items-center gap-1 rounded-full bg-black/58 px-2 py-1 text-[10px] font-medium text-white shadow-sm backdrop-blur-sm">
                            <Ruler className="size-3" />
                            {dimensionLabel}
                          </span>
                          <span className="rounded-full bg-black/58 px-2 py-1 text-[10px] font-medium text-white shadow-sm backdrop-blur-sm">
                            {ratioLabel}
                          </span>
                        </div>
                      </div>
                      {downgrade && (
                        <div
                          className="flex items-start gap-1.5 border-t border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-snug text-amber-600 dark:text-amber-300"
                          title="渠道返回的实际像素与请求不一致，常见于 free 号池/反向代理对超大尺寸的静默降级"
                        >
                          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                          <span>
                            {downgrade.shrunk ? "渠道把请求降级了" : "渠道返回了不同尺寸"}：请求 {downgrade.requested}，实际 {downgrade.actual}
                          </span>
                        </div>
                      )}
                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)]/50 bg-[#fffaf2]/88 px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onUseForEdit(image.url)}
                            className="relative z-10 inline-flex min-h-9 cursor-pointer touch-manipulation items-center gap-1.5 rounded-full border border-[var(--line)] bg-[#f3eadc] px-3.5 py-1.5 text-xs font-medium text-[var(--ink)] transition-colors duration-150 hover:border-[var(--accent)] hover:bg-[#fff6e8] hover:text-[var(--accent)] active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                          >
                            <ImagePlus className="size-3.5" />
                            加入编辑
                          </button>
                          {onReuseConfig && (
                            <button
                              type="button"
                              onClick={() => onReuseConfig(generation)}
                              className="relative z-10 inline-flex min-h-9 cursor-pointer touch-manipulation items-center gap-1.5 rounded-full border border-[var(--line)] bg-white/70 px-3.5 py-1.5 text-xs font-medium text-[var(--ink)] transition-colors duration-150 hover:border-[var(--accent)] hover:bg-[#fff6e8] hover:text-[var(--accent)] active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                            >
                              <SlidersHorizontal className="size-3.5" />
                              复用配置
                            </button>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onZoom(image.url, { dimensionLabel, ratioLabel })}
                            className="rounded-lg p-1.5 text-[var(--ink-soft)] transition hover:bg-[var(--surface-strong)] hover:text-[var(--ink)]"
                            title="放大查看"
                          >
                            <ZoomIn className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDownload(image.url)}
                            className="rounded-lg p-1.5 text-[var(--ink-soft)] transition hover:bg-[var(--surface-strong)] hover:text-[var(--ink)]"
                            title="下载保存"
                          >
                            <Download className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="rounded-2xl rounded-tl-none border border-rose-500/20 bg-rose-500/10 px-5 py-3.5 text-sm text-rose-400">
                {generation.errorMessage ? `生成失败：${generation.errorMessage}` : "生成失败或图片未能成功返回。"}
              </div>
              {onRetry && (
                <button
                  type="button"
                  onClick={() => onRetry(generation)}
                  className="inline-flex w-fit items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--ink)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  title="用相同提示词与参数重新发起生成"
                >
                  <RotateCcw className="size-3.5" />
                  重试
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
