"use client";

import { useState } from "react";
import { Gift, Loader2 } from "lucide-react";

export function RedeemCodeForm({
  onRedeemed,
}: {
  onRedeemed?: (credits: number) => void;
}) {
  const [code, setCode] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    type: "error" | "success";
  } | null>(null);

  async function handleRedeem() {
    const trimmed = code.trim();
    if (!trimmed) {
      setMessage({ text: "请输入兑换码", type: "error" });
      return;
    }

    setIsPending(true);
    setMessage(null);

    try {
      const response = await fetch("/api/me/redeem-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
      });
      const result = (await response.json()) as {
        data?: {
          credits: number;
          rewardCredits: number;
        };
        error?: string;
      };

      if (!response.ok || !result.data) {
        setMessage({ text: result.error || "兑换失败", type: "error" });
        return;
      }

      setCode("");
      onRedeemed?.(result.data.credits);
      setMessage({
        text: `兑换成功，已到账 ${result.data.rewardCredits} 积分`,
        type: "success",
      });
    } catch {
      setMessage({ text: "兑换时发生错误", type: "error" });
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="studio-card rounded-[1.8rem] p-6">
      <h3 className="font-semibold text-[var(--ink)]">兑换积分</h3>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <input
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="输入兑换码"
          className="min-w-0 flex-1 rounded-xl border border-[var(--line)] bg-[var(--surface)]/60 px-4 py-3 text-sm uppercase text-[var(--ink)] outline-none transition placeholder:text-[var(--ink-soft)]/60 focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
        />
        <button
          type="button"
          disabled={isPending}
          onClick={() => void handleRedeem()}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--ink)] px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-[var(--accent)] disabled:opacity-60"
        >
          {isPending ? <Loader2 className="size-4 animate-spin" /> : <Gift className="size-4" />}
          立即兑换
        </button>
      </div>
      {message ? (
        <p className={`mt-3 text-sm ${message.type === "success" ? "text-emerald-700" : "text-rose-600"}`}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
