"use client";

/* eslint-disable @next/next/no-img-element */

import {
  ArrowUpRight,
  Calendar,
  Gift,
  ImageIcon,
  KeyRound,
  Loader2,
  ShieldAlert,
  Ticket,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { getThumbUrl } from "@/lib/image-url";
import { cn } from "@/lib/utils";
import { AdminDrawer } from "../ui/admin-drawer";

type UserDetailPayload = {
  apiKeys: Array<{
    createdAt: string;
    generationCount: number;
    id: string;
    keyPrefix: string;
    lastUsedAt: string | null;
    name: string;
    status: "active" | "revoked";
  }>;
  avatarUrl: string | null;
  banned: boolean;
  bannedAt: string | null;
  checkIns: Array<{
    createdAt: string;
    dateKey: string;
    id: string;
    rewardCredits: number;
  }>;
  counts: {
    apiKeys: number;
    canvases: number;
    checkInRecords: number;
    contentReviews: number;
    generations: number;
    likedWorks: number;
    redeemRedemptions: number;
  };
  createdAt: string;
  credits: number;
  email: string;
  id: string;
  inviteUsed: {
    batchTitle: string | null;
    code: string;
    note: string | null;
  } | null;
  nickname: string | null;
  oauthProvider: string | null;
  recentGenerations: Array<{
    createdAt: string;
    creditsSpent: number;
    errorMessage: string | null;
    generationType: string;
    id: string;
    model: string;
    prompt: string;
    status: string;
    thumbUrl: string | null;
  }>;
  redemptions: Array<{
    code: string;
    createdAt: string;
    id: string;
    rewardCredits: number;
  }>;
  role: "admin" | "user";
};

type UserDetailDrawerProps = {
  onClose: () => void;
  userEmail?: string;
  userId: string | null;
};

export function UserDetailDrawer({
  onClose,
  userEmail,
  userId,
}: UserDetailDrawerProps) {
  const [fetched, setFetched] = useState<{
    detail: UserDetailPayload | null;
    error: string | null;
    forUserId: string;
  } | null>(null);

  useEffect(() => {
    if (!userId) return;
    let active = true;

    async function load(targetId: string) {
      try {
        const res = await fetch(`/api/admin/users/${targetId}`);
        const json = (await res.json().catch(() => ({}))) as {
          data?: { user: UserDetailPayload };
          error?: string;
        };
        if (!active) return;
        if (!res.ok || !json.data) {
          setFetched({
            detail: null,
            error: json.error || "读取用户详情失败",
            forUserId: targetId,
          });
          return;
        }
        setFetched({
          detail: json.data.user,
          error: null,
          forUserId: targetId,
        });
      } catch {
        if (active) {
          setFetched({
            detail: null,
            error: "网络请求异常，请稍后重试",
            forUserId: targetId,
          });
        }
      }
    }

    void load(userId);
    return () => {
      active = false;
    };
  }, [userId]);

  const loading = userId !== null && fetched?.forUserId !== userId;
  const error = userId !== null && fetched?.forUserId === userId ? fetched.error : null;
  const detail = userId !== null && fetched?.forUserId === userId ? fetched.detail : null;

  return (
    <AdminDrawer
      open={Boolean(userId)}
      onClose={onClose}
      width="lg"
      eyebrow="USER 360° PROFILE"
      title={detail?.nickname?.trim() || detail?.email || userEmail || "用户详情档案"}
      description={detail ? `账号 ID：${detail.id} · ${detail.email}` : undefined}
      footer={
        detail ? (
          <>
            <span className="font-mono text-xs text-[var(--ink-soft)]">
              注册于 {new Date(detail.createdAt).toLocaleString("zh-CN")}
            </span>
            <Link
              href={`/admin/generations?q=${encodeURIComponent(detail.email)}`}
              onClick={onClose}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#231810] px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-[#c85a32]"
            >
              查看该用户全部生成流水
              <ArrowUpRight className="size-3.5" aria-hidden />
            </Link>
          </>
        ) : null
      }
    >
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--ink-soft)]">
          <Loader2 className="size-5 animate-spin text-[#c85a32]" aria-hidden />
          <span>正在加载用户全景档案…</span>
        </div>
      ) : error ? (
        <Alert variant="error">{error}</Alert>
      ) : detail ? (
        <div className="grid gap-5">
          {/* Top Summary Strip */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-[var(--line)] bg-white p-3.5">
              <div className="text-xs text-[var(--ink-soft)]">当前积分</div>
              <div className="mt-1 font-mono text-xl font-semibold text-[#b54722]">
                {detail.credits.toLocaleString("zh-CN")}
              </div>
            </div>
            <div className="rounded-xl border border-[var(--line)] bg-white p-3.5">
              <div className="text-xs text-[var(--ink-soft)]">生成任务</div>
              <div className="mt-1 font-mono text-xl font-semibold text-[var(--ink)]">
                {detail.counts.generations.toLocaleString("zh-CN")}
              </div>
            </div>
            <div className="rounded-xl border border-[var(--line)] bg-white p-3.5">
              <div className="text-xs text-[var(--ink-soft)]">画布工程</div>
              <div className="mt-1 font-mono text-xl font-semibold text-[var(--ink)]">
                {detail.counts.canvases}
              </div>
            </div>
            <div className="rounded-xl border border-[var(--line)] bg-white p-3.5">
              <div className="text-xs text-[var(--ink-soft)]">风控拦截</div>
              <div
                className={cn(
                  "mt-1 font-mono text-xl font-semibold",
                  detail.counts.contentReviews > 0 ? "text-rose-600" : "text-[var(--ink)]",
                )}
              >
                {detail.counts.contentReviews}
              </div>
            </div>
          </div>

          {/* Identity & Registration Source */}
          <section className="rounded-xl border border-[var(--line)] bg-[#faf7f1] p-4 text-xs">
            <h3 className="font-semibold text-[var(--ink)]">身份与准入来源</h3>
            <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
              <div className="flex items-center justify-between rounded-lg bg-white px-3 py-2">
                <span className="text-[var(--ink-soft)]">账号角色 / 状态</span>
                <span className="font-medium text-[var(--ink)]">
                  {detail.role === "admin" ? "管理员" : "普通用户"} ·{" "}
                  {detail.banned ? "已封禁" : "正常"}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-white px-3 py-2">
                <span className="text-[var(--ink-soft)]">登录认证方式</span>
                <span className="font-medium text-[var(--ink)]">
                  {detail.oauthProvider
                    ? `OAuth (${detail.oauthProvider})`
                    : "邮箱密码"}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-white px-3 py-2 sm:col-span-2">
                <span className="flex items-center gap-1.5 text-[var(--ink-soft)]">
                  <Ticket className="size-3.5 text-[#9e5322]" aria-hidden />
                  注册使用邀请码
                </span>
                <span className="font-mono font-medium text-[var(--ink)]">
                  {detail.inviteUsed
                    ? `${detail.inviteUsed.code}${detail.inviteUsed.batchTitle ? ` (${detail.inviteUsed.batchTitle})` : ""}`
                    : "无（OAuth 免邀或初始种子）"}
                </span>
              </div>
            </div>
          </section>

          {/* Recent Generations */}
          <section className="grid gap-2.5">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--ink)]">
                <ImageIcon className="size-4 text-[#b54722]" aria-hidden />
                最近生成任务（{detail.recentGenerations.length}）
              </h3>
            </div>
            {detail.recentGenerations.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[var(--line)] p-6 text-center text-xs text-[var(--ink-soft)]">
                该用户尚未发起过生成任务
              </p>
            ) : (
              <div className="grid gap-2">
                {detail.recentGenerations.map((job) => (
                  <div
                    key={job.id}
                    className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-white p-2.5"
                  >
                    {job.thumbUrl ? (
                      <img
                        src={getThumbUrl(job.thumbUrl, 96)}
                        alt="任务缩略图"
                        className="size-12 shrink-0 rounded-lg border border-[var(--line)] object-cover"
                      />
                    ) : (
                      <div className="grid size-12 shrink-0 place-items-center rounded-lg bg-[#f4ede1] text-[10px] text-[var(--ink-soft)]">
                        {job.status === "FAILED" ? "失败" : "无图"}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-[var(--ink)]">
                        {job.prompt}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11px] text-[var(--ink-soft)]">
                        <span>{job.model}</span>
                        <span>·</span>
                        <span>{job.status}</span>
                        <span>·</span>
                        <span className="text-[#b54722]">-{job.creditsSpent}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Credits Activity: Check-ins & Redemptions */}
          <div className="grid gap-4 sm:grid-cols-2">
            <section className="rounded-xl border border-[var(--line)] bg-white p-4">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ink)]">
                <Calendar className="size-3.5 text-[#b54722]" aria-hidden />
                最近签到（共 {detail.counts.checkInRecords} 次）
              </h3>
              {detail.checkIns.length === 0 ? (
                <p className="mt-3 text-xs text-[var(--ink-soft)]">暂无签到记录</p>
              ) : (
                <div className="mt-2.5 space-y-1.5">
                  {detail.checkIns.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between font-mono text-xs"
                    >
                      <span className="text-[var(--ink-soft)]">{c.dateKey}</span>
                      <span className="font-semibold text-emerald-700">
                        +{c.rewardCredits}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-xl border border-[var(--line)] bg-white p-4">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ink)]">
                <Gift className="size-3.5 text-[#b54722]" aria-hidden />
                兑换码记录（共 {detail.counts.redeemRedemptions} 次）
              </h3>
              {detail.redemptions.length === 0 ? (
                <p className="mt-3 text-xs text-[var(--ink-soft)]">暂无兑换记录</p>
              ) : (
                <div className="mt-2.5 space-y-1.5">
                  {detail.redemptions.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between font-mono text-xs"
                    >
                      <span className="truncate text-[var(--ink)]">{r.code}</span>
                      <span className="font-semibold text-[#b54722]">
                        +{r.rewardCredits}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* API Keys */}
          <section className="rounded-xl border border-[var(--line)] bg-white p-4">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ink)]">
              <KeyRound className="size-3.5 text-[#b54722]" aria-hidden />
              名下 API Key（{detail.counts.apiKeys}）
            </h3>
            {detail.apiKeys.length === 0 ? (
              <p className="mt-2.5 text-xs text-[var(--ink-soft)]">未创建过外部 API 密钥</p>
            ) : (
              <div className="mt-2.5 space-y-1.5">
                {detail.apiKeys.map((k) => (
                  <div
                    key={k.id}
                    className="flex items-center justify-between rounded-lg bg-[#faf7f1] px-3 py-2 text-xs"
                  >
                    <div className="min-w-0">
                      <span className="font-medium text-[var(--ink)]">{k.name}</span>
                      <span className="ml-2 font-mono text-[var(--ink-soft)]">
                        {k.keyPrefix}...
                      </span>
                    </div>
                    <span className="font-mono text-[11px] text-[var(--ink-soft)]">
                      调用 {k.generationCount} 次 ·{" "}
                      {k.status === "active" ? "启用" : "已停用"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {detail.counts.contentReviews > 0 ? (
            <Link
              href={`/admin/moderation?q=${encodeURIComponent(detail.email)}`}
              onClick={onClose}
              className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50/70 px-4 py-3 text-xs font-medium text-rose-700 transition hover:bg-rose-100/70"
            >
              <span className="flex items-center gap-2">
                <ShieldAlert className="size-4" aria-hidden />
                该用户共有 {detail.counts.contentReviews} 条风控拦截记录，点击前往审查
              </span>
              <ArrowUpRight className="size-4" aria-hidden />
            </Link>
          ) : null}
        </div>
      ) : null}
    </AdminDrawer>
  );
}
