"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function CheckInBenefitForm({
  initialCheckInReward,
}: {
  initialCheckInReward: number;
}) {
  const router = useRouter();
  const [checkInReward, setCheckInReward] = useState(initialCheckInReward);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleSave() {
    setError(null);

    const response = await fetch("/api/admin/benefits/check-in", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        checkInReward,
      }),
    });
    const result = (await response.json()) as { error?: string };

    if (!response.ok) {
      setError(result.error || "保存失败");
      return;
    }

    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <section className="studio-card rounded-[1.8rem] p-5">
      <h2 className="text-lg font-medium">签到奖励配置</h2>
      <p className="mt-1 text-sm text-[var(--ink-soft)]">
        当前用户每日首次签到，可自动领取对应积分。
      </p>

      <div className="mt-5 flex flex-col gap-3 md:flex-row md:items-end">
        <label className="grid gap-2">
          <span className="text-sm text-[var(--ink-soft)]">签到奖励积分</span>
          <input
            type="number"
            min={1}
            max={10000}
            value={checkInReward}
            onChange={(event) => setCheckInReward(Number(event.target.value))}
            className="w-40 rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 outline-none"
          />
        </label>

        <button
          type="button"
          disabled={isPending}
          onClick={() => startTransition(handleSave)}
          className="rounded-full bg-[var(--ink)] px-5 py-3 text-sm font-medium text-white disabled:opacity-60"
        >
          {isPending ? "保存中..." : "保存签到奖励"}
        </button>
      </div>

      {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}
    </section>
  );
}
