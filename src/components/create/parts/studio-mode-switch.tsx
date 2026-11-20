"use client";

import { SlidersHorizontal, Workflow } from "lucide-react";

import { cn } from "@/lib/utils";

import type { StudioMode } from "../hooks/use-studio-mode";

type StudioModeSwitchProps = { mode: StudioMode; onChange: (mode: StudioMode) => void };

export function StudioModeSwitch({ mode, onChange }: StudioModeSwitchProps) {
  return (
    <div className="relative z-10 flex shrink-0 items-center justify-between gap-3 border-b border-[var(--line)]/70 bg-[#fffaf2]/85 px-3 py-2 md:px-5">
      <div role="group" aria-label="创作模式" className="inline-flex rounded-xl border border-[var(--line)] bg-[#f7efe4] p-1">
        <button
          type="button"
          aria-pressed={mode === "conversation"}
          onClick={() => onChange("conversation")}
          className={cn(
            "inline-flex cursor-pointer items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors",
            mode === "conversation"
              ? "bg-white text-[var(--ink)] shadow-sm"
              : "text-[var(--ink-soft)] hover:bg-white/60",
          )}
        >
          <SlidersHorizontal aria-hidden className="size-4" />
          工作台
        </button>
        <button
          type="button"
          aria-pressed={mode === "canvas"}
          onClick={() => onChange("canvas")}
          className={cn(
            "inline-flex cursor-pointer items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors",
            mode === "canvas"
              ? "bg-white text-[var(--accent)] shadow-sm"
              : "text-[var(--ink-soft)] hover:bg-white/60",
          )}
        >
          <Workflow aria-hidden className="size-4" />
          画布
        </button>
      </div>
      <p className="hidden text-xs text-[var(--ink-soft)] sm:block">工作台快速出图，画布自由编排</p>
    </div>
  );
}
