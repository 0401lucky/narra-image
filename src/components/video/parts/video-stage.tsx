"use client";

import { AlertTriangle, Download, RotateCcw, Video } from "lucide-react";

import type { GenerationItem } from "@/components/create/types";
import { VideoGeneratingProgress } from "@/components/video/parts/video-generating-progress";

type VideoStageProps = {
  generation: GenerationItem | null;
  onDownload: (url: string) => void;
  onRetry: () => void;
};

export function VideoStage({ generation, onDownload, onRetry }: VideoStageProps) {
  if (!generation) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="flex flex-col items-center gap-3 text-center text-[var(--ink-soft)]/70">
          <Video className="size-12" />
          <p className="text-sm">在左侧输入提示词，开始生成你的第一段视频</p>
        </div>
      </div>
    );
  }

  const video = generation.videos?.[0];

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 overflow-y-auto p-6 md:p-10">
      <div className="flex w-full max-w-3xl flex-col items-center">
        {generation.status === "pending" && (
          <VideoGeneratingProgress startedAt={generation.startedAt ?? generation.createdAt} />
        )}

        {generation.status === "failed" && (
          <div className="flex aspect-video w-full flex-col items-center justify-center gap-4 rounded-2xl border border-rose-200 bg-rose-50/70 px-6 text-center">
            <AlertTriangle className="size-10 text-rose-500" />
            <p className="text-sm font-medium text-rose-700">{generation.errorMessage || "生成失败"}</p>
            <button
              type="button"
              onClick={onRetry}
              className="flex items-center gap-1.5 rounded-full border border-rose-300 bg-white px-4 py-2 text-xs font-semibold text-rose-600 transition hover:bg-rose-100"
            >
              <RotateCcw className="size-3.5" /> 用当前参数重试
            </button>
          </div>
        )}

        {generation.status === "succeeded" && video && (
          <>
            <video
              key={video.id}
              src={video.url}
              poster={video.posterUrl ?? undefined}
              controls
              playsInline
              className="w-full rounded-2xl border-[6px] border-white bg-black shadow-[0_18px_40px_rgba(84,52,29,0.18)]"
            />
            <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => onDownload(video.url)}
                className="flex items-center gap-1.5 rounded-full bg-[#5a4a3b] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[var(--accent)]"
              >
                <Download className="size-3.5" /> 下载
              </button>
            </div>
          </>
        )}

        {/* 提示词 */}
        <p className="mt-5 max-w-2xl text-center text-sm leading-relaxed text-[var(--ink-soft)]">
          {generation.prompt}
        </p>
      </div>
    </div>
  );
}
