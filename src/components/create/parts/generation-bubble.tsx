"use client";

/* eslint-disable @next/next/no-img-element */

// 单条生成消息气泡（用户提示 + Narra 结果）。
import { AlertTriangle, Download, ImagePlus, RotateCcw, Sparkles, X, ZoomIn } from "lucide-react";
import { motion } from "motion/react";

import { getAspectRatio as getGenerationAspectRatio } from "@/lib/generation/sizes";
import { getThumbUrl } from "@/lib/image-url";

import {
  describeSizeDowngrade,
  getGenerationOptionSummary,
  getGenerationSourceImageUrls,
} from "../utils";
import type { GenerationItem } from "../types";

type GenerationBubbleProps = {
  generation: GenerationItem;
  onZoom: (url: string) => void;
  onDownload: (url: string) => void;
  onUseForEdit: (url: string) => void;
  onRetry?: (generation: GenerationItem) => void;
  onCancel?: (generation: GenerationItem) => void;
};

export function GenerationBubble({
  generation,
  onZoom,
  onDownload,
  onUseForEdit,
  onRetry,
  onCancel,
}: GenerationBubbleProps) {
  const sourceUrls = getGenerationSourceImageUrls(generation);
  return (
    <motion.div
      key={generation.id}
      id={`gen-${generation.id}`}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="space-y-6"
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
              <div className="h-44 w-full max-w-64 animate-pulse rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)]/30 sm:h-48" />
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
              <p className="text-xs text-[var(--ink-soft)]">结果 {generation.images.length}</p>
              <div
                className={`grid w-full gap-3 ${generation.images.length > 1 ? "grid-cols-1 min-[520px]:grid-cols-2" : "grid-cols-1"}`}
                style={{ maxWidth: generation.images.length === 1 ? "min(100%, 360px)" : "min(100%, 740px)" }}
              >
                {generation.images.map((image) => {
                  const downgrade = describeSizeDowngrade(generation, image);
                  return (
                    <div
                      key={image.id}
                      className="group relative overflow-hidden rounded-[1.15rem] border border-[var(--line)] bg-[#fffaf2]/90 shadow-[0_16px_34px_rgba(84,52,29,0.12)]"
                    >
                      <div
                        className="overflow-hidden bg-[var(--surface-strong)]/40"
                        style={getGenerationAspectRatio(generation.size) ? { aspectRatio: getGenerationAspectRatio(generation.size) } : undefined}
                      >
                        <img
                          src={getThumbUrl(image.url, 640)}
                          alt="生成结果"
                          loading="lazy"
                          decoding="async"
                          className="size-full object-cover cursor-pointer transition-transform duration-300 hover:scale-[1.02]"
                          onClick={() => onZoom(image.url)}
                        />
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
                        <button
                          type="button"
                          onClick={() => onUseForEdit(image.url)}
                          className="flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[#f3eadc] px-3 py-1.5 text-xs font-medium text-[var(--ink)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                        >
                          <ImagePlus className="size-3.5" />
                          加入编辑
                        </button>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onZoom(image.url)}
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
    </motion.div>
  );
}
