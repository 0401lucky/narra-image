"use client";

import { AlertTriangle, Ban, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { cn } from "@/lib/utils";
import { useAdminToast } from "./hooks/use-admin-toast";
import { AdminConfirmDialog } from "./ui/admin-modal";
import { AdminTabs, type AdminTabOption } from "./ui/admin-tabs";

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
  initialSearch?: string;
  kind: string;
  offenders: Offender[];
  reviews: ModerationReview[];
};

const KIND_TABS: AdminTabOption[] = [
  { label: "全部触发", value: "" },
  { label: "敏感词命中", value: "sensitive_word" },
  { label: "AI 审核拦截", value: "ai_moderation" },
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
  initialSearch = "",
  kind,
  offenders,
  reviews,
}: ModerationReviewsBoardProps) {
  const router = useRouter();
  const toast = useAdminToast();
  const [isPending, startTransition] = useTransition();
  const [searchValue, setSearchValue] = useState(initialSearch);
  const [banTarget, setBanTarget] = useState<Offender | null>(null);
  const [banError, setBanError] = useState<string | null>(null);
  const [banning, setBanning] = useState(false);

  function pushQuery(nextKind: string, nextSearch: string) {
    const params = new URLSearchParams();
    if (nextKind) params.set("kind", nextKind);
    const trimmed = nextSearch.trim();
    if (trimmed) params.set("q", trimmed);
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `/admin/moderation?${qs}` : "/admin/moderation");
    });
  }

  function selectKind(value: string) {
    if (value === kind) return;
    pushQuery(value, searchValue);
  }

  function handleSearchSubmit(event: React.FormEvent) {
    event.preventDefault();
    pushQuery(kind, searchValue);
  }

  function handleSearchClear() {
    setSearchValue("");
    pushQuery(kind, "");
  }

  async function handleBan(banned: boolean) {
    if (!banTarget) return;
    setBanError(null);
    setBanning(true);
    try {
      const response = await fetch(`/api/admin/users/${banTarget.userId}/ban`, {
        body: JSON.stringify({ banned }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        const msg = result.error || "操作失败";
        setBanError(msg);
        toast.error(banned ? "封禁失败" : "解封失败", msg);
        return;
      }
      setBanTarget(null);
      toast.success(
        banned ? "高风险用户已封禁" : "用户已解封",
        banTarget.email,
      );
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
    <div className="grid gap-7">
      {/* 高风险用户 */}
      <section className="grid gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-[#c85a32]" aria-hidden />
            <h2 className="text-base font-semibold tracking-tight text-[var(--ink)]">
              高频触发用户
            </h2>
            <span className="rounded-full bg-[#efe8dc] px-2.5 py-0.5 text-xs font-medium text-[var(--ink-soft)]">
              {offenders.length} 人
            </span>
          </div>
        </div>

        {offenders.length === 0 ? (
          <div className="studio-card border border-dashed p-6 text-center text-sm text-[var(--ink-soft)]">
            暂无风控触发用户记录，运行平稳。
          </div>
        ) : (
          <div className="studio-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-[var(--line)] text-xs text-[var(--ink-soft)]">
                  <tr>
                    <th className="px-4 py-3 font-medium">触发账号</th>
                    <th className="px-4 py-3 font-medium">累计拦截</th>
                    <th className="px-4 py-3 font-medium">最近触发时间</th>
                    <th className="px-4 py-3 font-medium">账号状态</th>
                    <th className="px-4 py-3 text-right font-medium">管控操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]/70">
                  {offenders.map((offender) => (
                    <tr key={offender.userId} className="transition-colors hover:bg-[#faf6ee]/80">
                      <td className="px-4 py-3">
                        <div className="font-medium text-[var(--ink)]">
                          {offender.nickname?.trim() || offender.email}
                        </div>
                        {offender.nickname?.trim() ? (
                          <div className="font-mono text-xs text-[var(--ink-soft)]">
                            {offender.email}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-sm font-semibold tabular-nums text-[#b54722]">
                          {offender.count} 次
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-[var(--ink-soft)]">
                        {offender.lastTriggerAt ? formatTime(offender.lastTriggerAt) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {offender.banned ? (
                          <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-700">
                            已封禁
                          </span>
                        ) : (
                          <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                            正常
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          disabled={offender.userId === adminId}
                          onClick={() => {
                            setBanError(null);
                            setBanTarget(offender);
                          }}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-45",
                            offender.banned
                              ? "border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50"
                              : "border-rose-200 bg-white text-rose-600 hover:bg-rose-50",
                          )}
                        >
                          <Ban className="size-3.5" aria-hidden />
                          {offender.banned ? "解封" : "封禁"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* 审核记录 */}
      <section className="grid gap-3.5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-base font-semibold tracking-tight text-[var(--ink)]">
              拦截流水明细
            </h2>
            <AdminTabs
              ariaLabel="拦截类型筛选"
              layoutId="moderation-kind-tabs"
              options={KIND_TABS}
              value={kind}
              disabled={isPending}
              onChange={selectKind}
            />
          </div>

          <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1 sm:w-72">
              <Search
                className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-[var(--ink-soft)]"
                aria-hidden
              />
              <input
                type="text"
                value={searchValue}
                onChange={(event) => setSearchValue(event.target.value)}
                placeholder="搜索提示词、命中词或用户邮箱…"
                className="w-full rounded-xl border border-[var(--admin-line)] bg-white py-2 pr-8 pl-9 text-xs text-[var(--ink)] outline-none sm:text-sm"
              />
              {searchValue ? (
                <button
                  type="button"
                  onClick={handleSearchClear}
                  aria-label="清空搜索"
                  className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-md p-0.5 text-[var(--ink-soft)] hover:text-[var(--ink)]"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              ) : null}
            </div>
            <button
              type="submit"
              disabled={isPending}
              className="shrink-0 rounded-xl bg-[#c25934] px-4 py-2 text-xs font-semibold text-white shadow-2xs transition hover:bg-[#ad4c2a] sm:text-sm"
            >
              筛选
            </button>
          </form>
        </div>

        {reviews.length === 0 ? (
          <div className="studio-card border border-dashed p-8 text-center text-sm text-[var(--ink-soft)]">
            当前筛选条件下暂无拦截记录。
          </div>
        ) : (
          <div className="grid gap-3">
            {reviews.map((review) => (
              <article
                key={review.id}
                className="studio-card grid gap-2.5 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                        review.kind === "sensitive_word"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-sky-100 text-sky-800",
                      )}
                    >
                      {KIND_LABELS[review.kind] ?? review.kind}
                    </span>
                    {review.kind === "sensitive_word" && review.hitWords.length > 0 ? (
                      <span className="rounded-md bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700">
                        命中词：{review.hitWords.join("、")}
                      </span>
                    ) : null}
                    {review.kind === "ai_moderation" && review.aiScore != null ? (
                      <span className="font-mono text-xs text-[var(--ink-soft)]">
                        违规分 {review.aiScore.toFixed(2)}
                        {review.category ? ` · ${review.category}` : ""}
                      </span>
                    ) : null}
                    {review.user.banned ? (
                      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                        账号已封禁
                      </span>
                    ) : null}
                  </div>
                  <span className="font-mono text-xs text-[var(--ink-soft)]">
                    {formatTime(review.createdAt)}
                  </span>
                </div>

                <p className="rounded-xl border border-[var(--line)] bg-[#faf7f1] px-3.5 py-2.5 text-sm leading-relaxed text-[var(--ink)]">
                  {review.prompt}
                </p>
                {review.negativePrompt ? (
                  <p className="text-xs text-[var(--ink-soft)]">
                    负向提示词：{review.negativePrompt}
                  </p>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--ink-soft)]">
                  <span className="truncate">
                    触发用户：{review.user.nickname?.trim() ? `${review.user.nickname} (${review.user.email})` : review.user.email}
                  </span>
                  {review.aiModel ? (
                    <span className="font-mono text-[11px]">审核模型：{review.aiModel}</span>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <AdminConfirmDialog
        open={banTarget !== null}
        onClose={() => {
          if (!banning) setBanTarget(null);
        }}
        onConfirm={() => {
          if (banTarget) void handleBan(!banTarget.banned);
        }}
        busy={banning}
        tone={banTarget?.banned ? "primary" : "danger"}
        title={banTarget?.banned ? "解封触发用户" : "封禁高风险用户"}
        description={
          banTarget?.banned
            ? "解封后该用户可重新登录并恢复全部使用。"
            : "封禁后该用户无法登录，已登录会话会被立即拦截登出；历史数据保留可随时解封。"
        }
        confirmLabel={
          banning ? "处理中…" : banTarget?.banned ? "确认解封" : "确认封禁"
        }
        error={banError}
      >
        {banTarget ? (
          <div className="grid gap-1.5 rounded-xl border border-[var(--line)] bg-[#f8f4ec] p-3 text-xs text-[var(--ink-soft)]">
            <div>用户邮箱：{banTarget.email}</div>
            <div>累计触发：{banTarget.count} 次</div>
          </div>
        ) : null}
      </AdminConfirmDialog>
    </div>
  );
}
