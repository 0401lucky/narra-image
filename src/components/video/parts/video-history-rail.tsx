"use client";

/* eslint-disable @next/next/no-img-element */
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

import type { GenerationItem } from "@/components/create/types";

type VideoHistoryRailProps = {
  generations: GenerationItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export function VideoHistoryRail({ generations, selectedId, onSelect }: VideoHistoryRailProps) {
  if (generations.length === 0) {
    return (
      <div className="flex h-28 shrink-0 items-center justify-center border-t border-[var(--line)]/60 bg-[#f6efe6]/82 text-xs text-[var(--ink-soft)]/70">
        历史视频会显示在这里
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t border-[var(--line)]/60 bg-[#f6efe6]/82 px-4 py-3 backdrop-blur-md">
      <div className="premium-scrollbar flex gap-3 overflow-x-auto pb-1">
        {generations.map((generation) => {
          const video = generation.videos?.[0];
          const isSelected = generation.id === selectedId;
          return (
            <button
              key={generation.id}
              type="button"
              onClick={() => onSelect(generation.id)}
              title={generation.prompt}
              className={`relative h-16 w-24 shrink-0 overflow-hidden rounded-lg border-2 bg-[#cfc6b8] transition ${
                isSelected ? "border-[var(--accent)]" : "border-transparent hover:border-[var(--line)]"
              }`}
            >
              {video?.posterUrl ? (
                <img src={video.posterUrl} alt="视频封面" className="size-full object-cover" loading="lazy" />
              ) : video ? (
                <video src={video.url} muted playsInline className="size-full object-cover" />
              ) : null}
              <span className="absolute bottom-0.5 right-0.5">
                {generation.status === "succeeded" && <CheckCircle2 className="size-4 text-emerald-500" />}
                {generation.status === "pending" && <Loader2 className="size-4 animate-spin text-amber-500" />}
                {generation.status === "failed" && <XCircle className="size-4 text-rose-500" />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
