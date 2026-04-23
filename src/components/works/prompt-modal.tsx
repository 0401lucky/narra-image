"use client";

import { X } from "lucide-react";

type PromptModalProps = {
  negativePrompt?: string | null;
  onClose: () => void;
  prompt: string;
};

export function PromptModal({
  negativePrompt,
  onClose,
  prompt,
}: PromptModalProps) {
  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="studio-card relative max-h-[80vh] w-full max-w-3xl overflow-y-auto rounded-[2rem] p-6 md:p-8"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="absolute right-6 top-6 text-[var(--ink-soft)] transition hover:text-[var(--ink)]"
          onClick={onClose}
          title="关闭"
        >
          <X className="size-6" />
        </button>
        <h3 className="text-xl font-semibold text-[var(--ink)]">完整提示词</h3>
        <p className="mt-5 whitespace-pre-wrap text-sm leading-relaxed text-[var(--ink)] md:text-base">
          {prompt}
        </p>

        {negativePrompt ? (
          <div className="mt-6 border-t border-[var(--line)] pt-5">
            <h4 className="text-sm font-medium text-[var(--ink-soft)]">负向提示词</h4>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[var(--ink)]/85 md:text-base">
              {negativePrompt}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
