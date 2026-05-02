"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  TurnstileWidget,
  type TurnstileWidgetHandle,
} from "@/components/auth/turnstile-widget";

type InviteClaimBatch = {
  id: string;
  remainingCount: number;
  title: string | null;
  totalCount: number;
};

export type InviteClaimTurnstile = {
  isEnabled: boolean;
  siteKey: string | null;
  protectInviteRedeem: boolean;
};

type InviteClaimBoardProps = {
  batches: InviteClaimBatch[];
  turnstile?: InviteClaimTurnstile | null;
};

export function InviteClaimBoard({ batches, turnstile = null }: InviteClaimBoardProps) {
  const router = useRouter();
  const requireTurnstile = Boolean(
    turnstile?.isEnabled && turnstile?.siteKey && turnstile?.protectInviteRedeem,
  );
  const [token, setToken] = useState<string | null>(null);
  const widgetRef = useRef<TurnstileWidgetHandle>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const claim = useCallback(
    async (batchId: string) => {
      if (requireTurnstile && !token) {
        return { ok: false as const, error: "请先完成人机验证" };
      }

      const response = await fetch(`/api/invites/batches/${batchId}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(token ? { turnstileToken: token } : {}),
      });
      const result = (await response.json()) as {
        data?: { registerUrl: string };
        error?: string;
      };

      if (requireTurnstile) {
        setToken(null);
        widgetRef.current?.reset();
      }

      if (!response.ok || !result.data?.registerUrl) {
        return { ok: false as const, error: result.error || "领取失败，请稍后再试" };
      }

      return { ok: true as const, registerUrl: result.data.registerUrl };
    },
    [requireTurnstile, token],
  );

  return (
    <div className="grid gap-5">
      {requireTurnstile && turnstile?.siteKey ? (
        <div className="flex flex-col items-center gap-2">
          <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-soft)]">
            完成验证后即可领取
          </p>
          <TurnstileWidget
            ref={widgetRef}
            siteKey={turnstile.siteKey}
            onVerify={(t) => setToken(t)}
            onExpire={() => setToken(null)}
            onError={() => setToken(null)}
          />
        </div>
      ) : null}

      {globalError ? (
        <p className="text-center text-sm text-rose-600">{globalError}</p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {batches.map((batch) => (
          <InviteClaimCard
            key={batch.id}
            batch={batch}
            claim={claim}
            navigate={(url) => router.push(url)}
            disabled={requireTurnstile && !token}
            onError={setGlobalError}
          />
        ))}
      </div>
    </div>
  );
}

function InviteClaimCard({
  batch,
  claim,
  navigate,
  disabled,
  onError,
}: {
  batch: InviteClaimBatch;
  claim: (batchId: string) => Promise<
    { ok: true; registerUrl: string } | { ok: false; error: string }
  >;
  navigate: (url: string) => void;
  disabled: boolean;
  onError: (msg: string | null) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleClaim() {
    setError(null);
    onError(null);
    const result = await claim(batch.id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    startTransition(() => navigate(result.registerUrl));
  }

  return (
    <article className="studio-card rounded-[1.6rem] p-4 md:p-5">
      <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-soft)]">
        Public Claim
      </p>
      <h2 className="mt-2.5 text-xl font-semibold text-[var(--ink)] md:text-2xl">
        {batch.title || "未命名邀请码批次"}
      </h2>
      <p className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">
        公开页不会直接展示邀请码明文，点击领取后系统会分配一个可注册的邀请码。
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-[var(--ink-soft)]">
        <span className="rounded-full bg-[var(--surface-strong)] px-3 py-1">
          总量 {batch.totalCount}
        </span>
        <span className="rounded-full bg-[var(--surface-strong)] px-3 py-1">
          剩余 {batch.remainingCount}
        </span>
      </div>

      <button
        type="button"
        disabled={isPending || disabled || batch.remainingCount <= 0}
        onClick={() => startTransition(handleClaim)}
        className="mt-5 w-full rounded-full bg-[var(--ink)] px-5 py-3 text-sm font-medium text-white transition hover:bg-[var(--accent)] disabled:opacity-60 sm:w-auto"
      >
        {isPending ? "领取中..." : batch.remainingCount > 0 ? "领取邀请码" : "已领完"}
      </button>

      {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}
    </article>
  );
}
