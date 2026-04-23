"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type CheckInButtonProps = {
  checkedInToday: boolean;
  onCheckedIn?: (credits: number) => void;
  rewardCredits: number;
  variant?: "compact" | "default";
};

export function CheckInButton({
  checkedInToday,
  onCheckedIn,
  rewardCredits,
  variant = "default",
}: CheckInButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [hasCheckedInToday, setHasCheckedInToday] = useState(checkedInToday);
  const [message, setMessage] = useState("");
  const isCheckedIn = checkedInToday || hasCheckedInToday;

  async function handleCheckIn() {
    setMessage("");

    const response = await fetch("/api/me/check-in", {
      method: "POST",
    });
    const result = (await response.json()) as {
      data?: {
        checkedIn: boolean;
        credits: number;
        rewardCredits: number;
      };
      error?: string;
    };

    if (!response.ok) {
      setMessage(result.error || "签到失败");
      return;
    }

    const payload = result.data;
    if (!payload) {
      setMessage("签到失败");
      return;
    }

    setHasCheckedInToday(true);
    setMessage(payload.checkedIn ? `签到成功，已到账 ${payload.rewardCredits} 积分` : "今日已签");
    onCheckedIn?.(payload.credits);
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={isPending || isCheckedIn}
        onClick={() => startTransition(handleCheckIn)}
        className={
          variant === "compact"
            ? "rounded-full border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--ink-soft)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
            : "rounded-full border border-[var(--line)] px-4 py-2 text-sm text-[var(--ink-soft)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
        }
      >
        {isPending ? "签到中..." : isCheckedIn ? "今日已签" : "签到"}
      </button>
      <span className="sr-only" aria-live="polite">
        {message || `签到可领取 ${rewardCredits} 积分`}
      </span>
    </div>
  );
}
