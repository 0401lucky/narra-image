"use client";

// 对话流：空状态提示 + 历史 generation 气泡列表。
import { WandSparkles } from "lucide-react";
import { forwardRef } from "react";

import { GenerationBubble } from "./generation-bubble";
import type { GenerationItem } from "../types";

type ChatStreamProps = {
  generations: GenerationItem[];
  onZoom: (url: string) => void;
  onDownload: (url: string) => void;
  onUseForEdit: (url: string) => void;
  onRetry?: (generation: GenerationItem) => void;
  onCancel?: (generation: GenerationItem) => void;
};

export const ChatStream = forwardRef<HTMLDivElement, ChatStreamProps>(function ChatStream(
  { generations, onZoom, onDownload, onUseForEdit, onRetry, onCancel },
  ref,
) {
  return (
    <div
      ref={ref}
      className="flex-1 overflow-y-auto px-3 pb-56 scroll-smooth sm:px-4 sm:pb-48 md:px-8 md:pb-40"
      style={{ scrollbarWidth: "thin" }}
    >
      <div className="mx-auto max-w-3xl space-y-6 sm:space-y-8">
        {generations.length === 0 ? (
          <div className="flex h-[36vh] min-h-64 flex-col items-center justify-center text-center sm:h-[40vh]">
            <div className="mb-4 rounded-full bg-gradient-to-br from-[var(--accent)]/20 to-purple-500/20 p-4 ring-1 ring-[var(--line)] sm:mb-6 sm:p-5">
              <WandSparkles className="size-7 text-[var(--accent)] sm:size-8" />
            </div>
            <h2 className="text-xl font-semibold tracking-tight text-[var(--ink)] sm:text-2xl">你好，你想创作什么？</h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-[var(--ink-soft)] sm:text-base">
              在下方输入描述开始生成图片，或者直接粘贴一张图片进入图生图模式。
            </p>
          </div>
        ) : (
          generations.map((generation) => (
            <GenerationBubble
              key={generation.id}
              generation={generation}
              onZoom={onZoom}
              onDownload={onDownload}
              onUseForEdit={onUseForEdit}
              onRetry={onRetry}
              onCancel={onCancel}
            />
          ))
        )}
      </div>
    </div>
  );
});
