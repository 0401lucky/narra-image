"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

// agnes 文生视频实测约 130s 出片（排队+生成），用作进度预估基准。
const ESTIMATED_SECONDS = 130;
// 渐近缓动时间常数：进度按 95*(1-e^(-t/τ)) 逼近 95%，τ 越大越慢。
// 选 55s 使 ~130s 时约到 91%，且永不卡死或满格——agnes 偏慢时只是越来越慢地逼近 95%。
const TAU_SECONDS = 55;

type VideoGeneratingProgressProps = {
  // 任务开始时间（ISO 字符串）。调用方传 startedAt ?? createdAt。
  startedAt: string;
};

export function VideoGeneratingProgress({ startedAt }: VideoGeneratingProgressProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsedSeconds = Math.max(0, (now - new Date(startedAt).getTime()) / 1000);
  const progress = Math.min(95, Math.round(95 * (1 - Math.exp(-elapsedSeconds / TAU_SECONDS))));
  const remainingSeconds = Math.max(0, Math.ceil(ESTIMATED_SECONDS - elapsedSeconds));

  return (
    <div className="flex aspect-video w-full flex-col items-center justify-center gap-4 rounded-2xl border border-[var(--line)] bg-[#1c1714] px-6 text-white/90">
      <Loader2 className="size-10 animate-spin text-[var(--accent)]" />
      <p className="text-sm">视频生成中，请稍候…</p>

      <div className="w-full max-w-xs">
        <div
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-2 w-full overflow-hidden rounded-full bg-white/15"
        >
          <div
            className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-1000 ease-linear"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-white/60">
          <span>{progress}%</span>
          <span>{remainingSeconds > 0 ? `预计还需约 ${remainingSeconds} 秒` : "即将完成…"}</span>
        </div>
      </div>

      <p className="text-xs text-white/50">视频生成耗时较长，可切到其他标签页，完成后会自动更新</p>
    </div>
  );
}
