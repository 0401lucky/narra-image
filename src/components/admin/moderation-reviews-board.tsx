"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Ban } from "lucide-react";

import { cn } from "@/lib/utils";

type ReviewUser = {
  banned: boolean;
  email: string;
  id: string;
  nickname: string | null;
};

type ModerationReview = {
  aiModel: string | null;
  aiScore: number | null;
  category: string | null;
  createdAt: string;
  hitWords: string[];
  id: string;
  kind: string;
  negativePrompt: string | null;
  prompt: string;
  user: ReviewUser;
};

type Offender = {
  banned: boolean;
  count: number;
  email: string;
  lastTriggerAt: string | null;
  nickname: string | null;
  userId: string;
};

type ModerationReviewsBoardProps = {
  adminId: string;
  kind: string;
  offenders: Offender[];
  reviews: ModerationReview[];
};

const KIND_TABS: Array<{ label: string; value: string }> = [
  { label: "全部", value: "" },
  { label: "敏感词", value: "sensitive_word" },
  { label: "AI 审核", value: "ai_moderation" },
];

const KIND_LABELS: Record<string, string> = {
  ai_moderation: "AI 审核",
  sensitive_word: "敏感词",
};

function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    hour12: false,
  });
}

export function ModerationReviewsBoard({
  adminId,
  kind,
  offenders,
  reviews,
}: ModerationReviewsBoardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [banTarget, setBanTarget] = useState<Offender | null>(null);
  const [banError, setBanError] = useState<string | null>(null);
  const [banning, setBanning] = useState(false);

  function selectKind(value: string) {
    if (value === kind) return;
    const params = new URLSearchParams();
    if (value) params.set("kind", value);
    startTransition(() => {
      router.push(`/admin/moderation?${params.toString()}`);
    });
  }

  async function handleBan(banned: boolean) {
    if (!banTarget) return;
    setBanError(null);
    setBanning(true);
    try {
      const response = await fetch(`/api/admin/users/${banTarget.userId}/ban`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ banned }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setBanError(result.error || "操作失败");
        return;
      }
      setBanTarget(null);
      startTransition(() => {
        router.refresh();
      });
    } catch {
      setBanError("操作失败，请稍后重试");
    } finally {
      setBanning(false);
    }
  }

  return (
    <div className="grid gap-8">
      {/* 高风险用户 */}
      <section className="grid gap-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-[var(--accent)]" />
          <h2 className="text-lg font-semibold tracking-tight text-[var(--ink)]">
            触发用户
          </h2>
          <span className="text-xs text-[var(--ink-soft)]">
            {offenders.length} 人命中过审核
          </span>
        </div>

        {offenders.length === 0 ? (
          <div className="studio-card rounded-[1.8rem] border border-dashed border-[var(--line)] p-6 text-center text-sm text-[var(--ink-soft)]">
            暂无触发记录，一切正常。
          </div>
        ) : (
          <div className="grid gap-3">
            {offenders.map((offender) => (
              <article
                key={offender.userId}
                className="studio-card grid gap-3 rounded-[1.8rem] p-4 md:grid-cols-[1fr_auto_auto_auto] md:items-center md:gap-5"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-[var(--ink)]">
                      {offender.nickname?.trim() || offender.email}
                    </p>
                    {offender.banned && (
                      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-medium text-rose-700">
                        已封禁
                      </span>
                    )}
                  </div>
                  {offender.nickname?.trim() && (
                    <p className="mt-0.5 truncate text-xs text-[var(--ink-soft)]">
                      {offender.email}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-[var(--ink-soft)]">
                    最近触发：{offender.lastTriggerAt ? formatTime(offender.lastTriggerAt) : "—"}
                  </p>
                </div>

                <div className="text-xs text-[var(--ink-soft)]">
                  触发次数
                  <div className="mt-1 text-xl font-semibold text-[var(--accent)]">
                    {offender.count}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setBanTarget(offender)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-medium transition",
                    offender.banned
                      ? "border border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                      : "border border-rose-200 text-rose-600 hover:bg-rose-50",
                  )}
                >
                  <Ban className="size-3.5" />
                  {offender.banned ? "解封" : "封禁"}
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* 审核记录 */}
      <section className="grid gap-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h2 className="text-lg font-semibold tracking-tight text-[var(--ink)]">
            审核记录
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {KIND_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                disabled={isPending}
                onClick={() => selectKind(tab.value)}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-xs transition disabled:opacity-60",
                  kind === tab.value
                    ? "bg-[var(--accent)]/10 text-[var(--accent)]"
                    : "border border-[var(--line)] text-[var(--ink-soft)] hover:text-[var(--ink)]",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {reviews.length === 0 ? (
          <div className="studio-card rounded-[1.8rem] border border-dashed border-[var(--line)] p-6 text-center text-sm text-[var(--ink-soft)]">
            当前筛选条件下暂无记录。
          </div>
        ) : (
          <div className="grid gap-3">
            {reviews.map((review) => (
              <article
                key={review.id}
                className="studio-card grid gap-3 rounded-[1.8rem] p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-xs font-medium",
                      review.kind === "sensitive_word"
                        ? "bg-amber-100 text-amber-700"
                        : "bg-sky-100 text-sky-700",
                    )}
                  >
                    {KIND_LABELS[review.kind] ?? review.kind}
                  </span>
                  {review.kind === "sensitive_word" && review.hitWords.length > 0 && (
                    <span className="truncate text-xs text-[var(--ink-soft)]">
                      命中：{review.hitWords.join("、")}
                    </span>
                  )}
                  {review.kind === "ai_moderation" && review.aiScore != null && (
                    <span className="text-xs text-[var(--ink-soft)]">
                      违规分 {review.aiScore.toFixed(2)}
                      {review.category ? `（${review.category}）` : ""}
                    </span>
                  )}
                  {review.user.banned && (
                    <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-medium text-rose-700">
                      用户已封禁
                    </span>
                  )}
                </div>

                <p className="text-sm leading-relaxed text-[var(--ink)]">
                  {review.prompt}
                </p>
                {review.negativePrompt ? (
                  <p className="text-xs text-[var(--ink-soft)]">
                    负向提示：{review.negativePrompt}
                  </p>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] pt-3 text-xs text-[var(--ink-soft)]">
                  <span className="truncate">
                    {review.user.nickname?.trim() || review.user.email}
                  </span>
                  <span>{formatTime(review.createdAt)}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* 封禁/解封确认弹窗 */}
      {banTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={() => { if (!banning) setBanTarget(null); }}
        >
          <div
            className="studio-card w-full max-w-md rounded-[1.8rem] p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-[var(--ink)]">
              {banTarget.banned ? "解封用户" : "封禁用户"}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--ink-soft)]">
              {banTarget.banned
                ? "解封后该用户可重新登录并恢复全部使用。"
                : "该用户已触发多次内容审核。封禁后无法登录，已登录会话会被立即拦截；数据保留可解封。"}
            </p>
            <div className="mt-4 grid gap-2 rounded-[1.2rem] border border-[var(--line)] bg-[var(--surface-strong)]/40 p-3 text-xs text-[var(--ink-soft)]">
              <div>用户：{banTarget.email}</div>
              <div>触发次数：{banTarget.count}</div>
            </div>
            {banError ? (
              <p className="mt-3 text-sm text-rose-600">{banError}</p>
            ) : null}
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={banning}
                onClick={() => setBanTarget(null)}
                className="rounded-full border border-[var(--line)] px-4 py-2 text-sm text-[var(--ink-soft)] disabled:opacity-60"
              >
                取消
              </button>
              <button
                type="button"
                disabled={banning || banTarget.userId === adminId}
                onClick={() => void handleBan(!banTarget.banned)}
                className={cn(
                  "rounded-full px-4 py-2 text-sm font-medium text-white transition disabled:opacity-60",
                  banTarget.banned
                    ? "bg-emerald-600 hover:bg-emerald-700"
                    : "bg-rose-600 hover:bg-rose-700",
                )}
              >
                {banning ? "处理中..." : banTarget.banned ? "确认解封" : "确认封禁"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}