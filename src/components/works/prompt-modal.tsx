"use client";

import { Copy, X } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { buildPromptClipboardText } from "@/lib/prompt-preview";

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
  const [copyFeedback, setCopyFeedback] = useState("");

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(
        buildPromptClipboardText(prompt, negativePrompt),
      );
      setCopyFeedback("提示词已复制");
    } catch {
      setCopyFeedback("复制失败，请手动复制");
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[3px]"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        role="dialog"
        aria-modal="true"
        aria-label="完整提示词"
        className="admin-floating-surface relative max-h-[82vh] w-full max-w-3xl overflow-y-auto rounded-[1.6rem] p-6 md:p-8"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="absolute top-5 right-5 grid size-8 place-items-center rounded-xl text-[var(--ink-soft)] transition hover:bg-black/5 hover:text-[var(--ink)]"
          onClick={onClose}
          aria-label="关闭"
          title="关闭"
        >
          <X className="size-5" aria-hidden />
        </button>
        <div className="flex items-start justify-between gap-4 pr-10">
          <div>
            <h3 className="text-xl font-semibold text-[var(--ink)]">完整提示词</h3>
            {copyFeedback ? (
              <p className="mt-2 text-sm text-[var(--accent)]">{copyFeedback}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="inline-flex shrink-0 items-center gap-2 rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm font-medium text-[var(--ink)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            <Copy className="size-4" aria-hidden />
            复制提示词
          </button>
        </div>
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
      </motion.div>
    </motion.div>,
    document.body,
  );
}
