"use client";

// 尺寸 / 16 倍数对齐 / 分辨率 (1K/2K/4K/自动) / 可视化宽高比网格联动面板。
import { ArrowLeftRight, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

import {
  ASPECT_RATIO_OPTIONS,
  RESOLUTION_OPTIONS,
  getSizeControlWarning,
  type AspectRatioPreset,
  type ResolutionOptionValue,
  type SizeControlState,
} from "../size-controls";

type WorkbenchSizePanelProps = {
  value: SizeControlState;
  onChangeResolution: (tier: ResolutionOptionValue) => void;
  onChangeAspectRatio: (ratio: AspectRatioPreset) => void;
  onChangeDimensions: (width: string, height: string) => void;
  onBlurDimensions: () => void;
  onSwapDimensions: () => void;
  onToggleAlignMultiple16: (enabled: boolean) => void;
};

export function WorkbenchSizePanel({
  value,
  onChangeResolution,
  onChangeAspectRatio,
  onChangeDimensions,
  onBlurDimensions,
  onSwapDimensions,
  onToggleAlignMultiple16,
}: WorkbenchSizePanelProps) {
  const warning = getSizeControlWarning(value);

  return (
    <div className="space-y-4">
      {/* 尺寸 W ⇄ H + 16 倍数对齐 */}
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-[var(--ink)]">尺寸</span>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-[var(--ink-soft)]">16 倍数对齐</span>
            <button
              type="button"
              role="switch"
              aria-label="16 倍数对齐"
              aria-checked={value.alignMultiple16}
              onClick={() => onToggleAlignMultiple16(!value.alignMultiple16)}
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors",
                value.alignMultiple16
                  ? "border-[var(--accent)] bg-[var(--accent)]"
                  : "border-[var(--line)] bg-[#e7dccb]",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "inline-block size-3.5 rounded-full bg-white shadow-xs transition-transform",
                  value.alignMultiple16 ? "translate-x-4" : "translate-x-0.5",
                )}
              />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
          <label className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white/85 px-2.5 py-2 shadow-2xs focus-within:border-[var(--accent)] focus-within:ring-2 focus-within:ring-[var(--accent)]/12">
            <span className="text-[11px] font-semibold text-[var(--ink-soft)]">W</span>
            <input
              aria-label="宽度"
              inputMode="numeric"
              placeholder="自动"
              value={value.widthInput}
              onChange={(event) => onChangeDimensions(event.target.value, value.heightInput)}
              onBlur={onBlurDimensions}
              className="min-w-0 w-full bg-transparent text-sm font-medium tabular-nums text-[var(--ink)] outline-none placeholder:text-[var(--ink-soft)]/55"
            />
          </label>

          <button
            type="button"
            aria-label="互换宽高"
            title="互换宽高"
            disabled={!value.widthInput.trim() && !value.heightInput.trim()}
            onClick={onSwapDimensions}
            className="flex size-8 cursor-pointer items-center justify-center rounded-xl border border-[var(--line)] bg-[#f7efe4] text-[var(--ink-soft)] transition hover:border-[var(--accent)] hover:bg-white hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <ArrowLeftRight aria-hidden className="size-3.5" />
          </button>

          <label className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white/85 px-2.5 py-2 shadow-2xs focus-within:border-[var(--accent)] focus-within:ring-2 focus-within:ring-[var(--accent)]/12">
            <span className="text-[11px] font-semibold text-[var(--ink-soft)]">H</span>
            <input
              aria-label="高度"
              inputMode="numeric"
              placeholder="自动"
              value={value.heightInput}
              onChange={(event) => onChangeDimensions(value.widthInput, event.target.value)}
              onBlur={onBlurDimensions}
              className="min-w-0 w-full bg-transparent text-sm font-medium tabular-nums text-[var(--ink)] outline-none placeholder:text-[var(--ink-soft)]/55"
            />
          </label>
        </div>

        <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-[var(--ink-soft)]">
          <span>
            {value.size === "auto"
              ? "当前：由模型自动决定尺寸"
              : `实际提交尺寸：${value.size}`}
          </span>
        </div>
        {warning && (
          <p role="alert" className="mt-1 text-[11px] leading-snug text-amber-700">
            {warning}
          </p>
        )}
      </div>

      {/* 分辨率 */}
      <div>
        <span className="mb-1.5 block text-xs font-semibold text-[var(--ink)]">分辨率</span>
        <div role="group" aria-label="分辨率" className="grid grid-cols-4 gap-1.5">
          {RESOLUTION_OPTIONS.map((option) => {
            const active = option.value === "auto"
              ? value.size === "auto"
              : value.resolutionTier === option.value && value.size !== "auto";
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => onChangeResolution(option.value)}
                className={cn(
                  "cursor-pointer rounded-xl border px-2 py-1.5 text-xs font-semibold transition",
                  active
                    ? "border-[var(--accent)] bg-[#fff4e8] text-[var(--accent)] shadow-2xs ring-1 ring-[var(--accent)]/15"
                    : "border-[var(--line)] bg-white/75 text-[var(--ink-soft)] hover:border-[#cfa27a] hover:bg-white hover:text-[var(--ink)]",
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 宽高比 */}
      <div>
        <span className="mb-1.5 block text-xs font-semibold text-[var(--ink)]">宽高比</span>
        <div role="group" aria-label="宽高比" className="grid grid-cols-5 gap-1.5">
          {ASPECT_RATIO_OPTIONS.map((option) => {
            const active = option.value === "auto"
              ? value.size === "auto"
              : value.aspectRatio === option.value && value.size !== "auto";
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => onChangeAspectRatio(option.value)}
                className={cn(
                  "flex h-14 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border px-1 py-1.5 text-[11px] font-medium transition",
                  active
                    ? "border-[var(--accent)] bg-[#fff4e8] text-[var(--accent)] shadow-2xs ring-1 ring-[var(--accent)]/15"
                    : "border-[var(--line)] bg-white/75 text-[var(--ink-soft)] hover:border-[#cfa27a] hover:bg-white hover:text-[var(--ink)]",
                )}
              >
                {option.value === "auto" ? (
                  <Sparkles aria-hidden className="size-4" />
                ) : (
                  <span
                    aria-hidden
                    className={cn(
                      "rounded-[3px] border-[1.5px]",
                      active ? "border-[var(--accent)] bg-[var(--accent)]/10" : "border-current opacity-75",
                    )}
                    style={{ width: `${option.boxWidth}px`, height: `${option.boxHeight}px` }}
                  />
                )}
                <span className="leading-none">{option.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
