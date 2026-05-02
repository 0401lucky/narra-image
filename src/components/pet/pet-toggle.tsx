"use client";

import { usePetEnabled, writePetEnabled } from "@/components/pet/pet-state";

// 桌面宠物开关：与签到按钮并排放置；状态由 localStorage 持久化
export function PetToggle() {
  const enabled = usePetEnabled();

  function handleToggle() {
    writePetEnabled(!enabled);
  }

  const label = enabled ? "宠物：开" : "宠物：关";
  const title = enabled ? "关闭桌面宠物" : "开启桌面宠物";

  return (
    <button
      type="button"
      onClick={handleToggle}
      title={title}
      aria-pressed={enabled}
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition " +
        (enabled
          ? "border-[var(--accent)] text-[var(--accent)]"
          : "border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--accent)] hover:text-[var(--accent)]")
      }
    >
      {/* 图标：简单的"小人"线条，开启时随主色高亮 */}
      <svg
        viewBox="0 0 16 16"
        aria-hidden="true"
        className="size-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="8" cy="4" r="2.2" />
        <path d="M3.5 14c0-2.5 2-4.2 4.5-4.2s4.5 1.7 4.5 4.2" />
      </svg>
      <span>{label}</span>
    </button>
  );
}
