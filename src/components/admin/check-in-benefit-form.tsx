"use client";

import { Gift, Loader2, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Alert } from "@/components/ui/alert";
import { useAdminToast } from "./hooks/use-admin-toast";

type CheckInBenefitFormProps = {
  initialCheckInReward: number;
};

export function CheckInBenefitForm({
  initialCheckInReward,
}: CheckInBenefitFormProps) {
  const router = useRouter();
  const toast = useAdminToast();
  const [checkInReward, setCheckInReward] = useState(initialCheckInReward);
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleSave() {
    setError(null);
    setSavedNotice(null);

    const response = await fetch("/api/admin/benefits/check-in", {
      body: JSON.stringify({ checkInReward }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    const result = (await response.json().catch(() => ({}))) as { error?: string };

    if (!response.ok) {
      const msg = result.error || "保存失败";
      setError(msg);
      toast.error("签到奖励保存失败", msg);
      return;
    }

    const successMsg = `每日签到奖励已更新为 +${checkInReward} 积分`;
    setSavedNotice(successMsg);
    toast.success("签到配置已保存", successMsg);
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <section className="studio-card p-5 md:p-6">
      <div className="flex items-start gap-3">
        <span className="admin-metric-icon shrink-0">
          <Gift className="size-4.5" aria-hidden />
        </span>
        <div>
          <h2 className="text-lg font-semibold text-[var(--ink)]">每日签到奖励配置</h2>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            注册用户每日首次点击签到按钮时，自动发放至账户余额的积分数额。
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-[var(--ink-soft)]">
            单次签到奖励积分（1 - 10,000）
          </span>
          <input
            type="number"
            min={1}
            max={10000}
            value={checkInReward}
            onChange={(event) => setCheckInReward(Number(event.target.value))}
            className="w-44 rounded-xl border border-[var(--line)] bg-white px-4 py-2.5 font-mono text-sm font-semibold tabular-nums outline-none"
          />
        </label>

        <div className="flex flex-wrap gap-1.5 pb-0.5">
          {[20, 50, 100, 200].map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setCheckInReward(preset)}
              className="rounded-lg border border-[var(--line)] bg-[#f9f5ed] px-2.5 py-2 font-mono text-xs font-medium text-[var(--ink-soft)] transition hover:border-[#c85a32] hover:text-[#c85a32]"
            >
              +{preset}
            </button>
          ))}
        </div>

        <button
          type="button"
          disabled={isPending}
          onClick={() => startTransition(() => void handleSave())}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--ink)] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#c85a32] disabled:opacity-60 sm:ml-auto"
        >
          {isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Save className="size-4" aria-hidden />
          )}
          {isPending ? "保存中…" : "保存签到奖励"}
        </button>
      </div>

      {savedNotice ? (
        <div className="mt-4">
          <Alert variant="success">{savedNotice}</Alert>
        </div>
      ) : null}
      {error ? (
        <div className="mt-4">
          <Alert variant="error">{error}</Alert>
        </div>
      ) : null}
    </section>
  );
}
