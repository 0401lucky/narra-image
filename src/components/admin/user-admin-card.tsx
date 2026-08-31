"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Ban, Shield, ShieldOff, Trash2 } from "lucide-react";

import { CreditAdjuster } from "@/components/admin/admin-actions";

type UserData = {
  banned: boolean;
  bannedAt: string | null;
  createdAt: string;
  credits: number;
  email: string;
  generationCount: number;
  id: string;
  nickname: string | null;
  role: "admin" | "user";
};

export function UserAdminCard({
  isCurrentAdmin,
  user,
}: {
  isCurrentAdmin: boolean;
  user: UserData;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // null=不弹窗；true=确认封禁；false=确认解封
  const [bannedAction, setBannedAction] = useState<boolean | null>(null);
  const [banning, setBanning] = useState(false);

  async function handleDelete() {
    setError(null);
    setDeleting(true);
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: "DELETE",
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(result.error || "删除失败");
        return;
      }
      setConfirmDelete(false);
      startTransition(() => {
        router.refresh();
      });
    } finally {
      setDeleting(false);
    }
  }

  async function handleRoleToggle() {
    setError(null);
    const newRole = user.role === "admin" ? "USER" : "ADMIN";

    const response = await fetch(`/api/admin/users/${user.id}/role`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: newRole }),
    });
    const result = (await response.json()) as { error?: string };

    if (!response.ok) {
      setError(result.error || "操作失败");
      return;
    }

    startTransition(() => {
      router.refresh();
    });
  }

  async function handleBan(banned: boolean) {
    setError(null);
    setBanning(true);
    try {
      const response = await fetch(`/api/admin/users/${user.id}/ban`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ banned }),
      });
      const result = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(result.error || "操作失败");
        return;
      }

      setBannedAction(null);
      startTransition(() => {
        router.refresh();
      });
    } finally {
      setBanning(false);
    }
  }

  return (
    <>
      <article className="studio-card grid gap-4 rounded-[1.8rem] p-5 xl:grid-cols-[1.2fr_0.6fr_0.5fr_0.8fr_auto]">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                user.role === "admin"
                  ? "bg-amber-100 text-amber-700"
                  : "border border-[var(--line)] text-[var(--ink-soft)]"
              }`}
            >
              {user.role === "admin" ? "管理员" : "用户"}
            </span>
            {user.banned && (
              <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-700">
                已封禁
              </span>
            )}
            {isCurrentAdmin && (
              <span className="text-[10px] text-[var(--ink-soft)]">（当前登录）</span>
            )}
          </div>
          <h2 className="mt-2 text-lg font-medium truncate">
            {user.nickname?.trim() || user.email}
          </h2>
          {user.nickname?.trim() && (
            <p className="mt-0.5 text-xs text-[var(--ink-soft)] truncate">{user.email}</p>
          )}
          <p className="mt-1 text-xs text-[var(--ink-soft)]">
            注册于 {new Date(user.createdAt).toLocaleString("zh-CN")}
            {user.bannedAt
              ? ` · 封禁于 ${new Date(user.bannedAt).toLocaleString("zh-CN")}`
              : null}
          </p>
        </div>

        <div>
          <div className="text-xs text-[var(--ink-soft)]">当前积分</div>
          <div className="mt-2 text-2xl font-semibold text-[var(--accent)]">
            {user.credits}
          </div>
        </div>

        <div>
          <div className="text-xs text-[var(--ink-soft)]">生成次数</div>
          <div className="mt-2 text-2xl font-semibold text-[var(--ink)]">
            {user.generationCount}
          </div>
        </div>

        <CreditAdjuster userId={user.id} />

        <div className="flex items-end gap-2">
          {!isCurrentAdmin && (
            <>
              <button
                type="button"
                disabled={isPending}
                onClick={() => startTransition(handleRoleToggle)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium transition disabled:opacity-60 ${
                  user.role === "admin"
                    ? "border border-amber-200 text-amber-700 hover:bg-amber-50"
                    : "border border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                }`}
              >
                {user.role === "admin" ? (
                  <>
                    <ShieldOff className="size-3.5" />
                    {isPending ? "处理中…" : "取消管理员"}
                  </>
                ) : (
                  <>
                    <Shield className="size-3.5" />
                    {isPending ? "处理中…" : "设为管理员"}
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => setBannedAction(!user.banned)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium transition ${
                  user.banned
                    ? "border border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                    : "border border-rose-200 text-rose-600 hover:bg-rose-50"
                }`}
              >
                <Ban className="size-3.5" />
                {user.banned ? "解封" : "封禁"}
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => setConfirmDelete(true)}
                className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 px-3 py-2 text-xs font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-60"
              >
                <Trash2 className="size-3.5" />
                删除用户
              </button>
            </>
          )}
          {error && <span className="text-xs text-rose-600">{error}</span>}
        </div>
      </article>

      {confirmDelete ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={() => { if (!deleting) setConfirmDelete(false); }}
        >
          <div
            className="studio-card w-full max-w-md rounded-[1.8rem] p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-[var(--ink)]">删除用户</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--ink-soft)]">
              将永久删除该用户及其全部生成记录、对话、API Key、签到、兑换记录、点赞。该用户创建过的邀请码/兑换码将保留，作者字段会被清空。操作不可恢复。
            </p>
            <div className="mt-4 grid gap-2 rounded-[1.2rem] border border-[var(--line)] bg-[var(--surface-strong)]/40 p-3 text-xs text-[var(--ink-soft)]">
              <div>邮箱：{user.email}</div>
              <div>昵称：{user.nickname?.trim() || "—"}</div>
              <div>角色：{user.role === "admin" ? "管理员" : "用户"}</div>
              <div>生成次数：{user.generationCount}</div>
            </div>
            {error ? (
              <p className="mt-3 text-sm text-rose-600">{error}</p>
            ) : null}
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setConfirmDelete(false)}
                className="rounded-full border border-[var(--line)] px-4 py-2 text-sm text-[var(--ink-soft)] disabled:opacity-60"
              >
                取消
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleDelete}
                className="rounded-full bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-700 disabled:opacity-60"
              >
                {deleting ? "删除中..." : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {bannedAction !== null ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={() => setBannedAction(null)}
        >
          <div
            className="studio-card w-full max-w-md rounded-[1.8rem] p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-[var(--ink)]">
              {bannedAction ? "封禁用户" : "解封用户"}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--ink-soft)]">
              {bannedAction
                ? "封禁后该用户将无法登录，已登录会话会被立即拦截登出。积分与作品数据保留，解封后恢复。"
                : "解封后该用户可重新登录并恢复全部使用。"}
            </p>
            <div className="mt-4 grid gap-2 rounded-[1.2rem] border border-[var(--line)] bg-[var(--surface-strong)]/40 p-3 text-xs text-[var(--ink-soft)]">
              <div>邮箱：{user.email}</div>
              <div>昵称：{user.nickname?.trim() || "—"}</div>
              <div>状态：{user.banned ? "已封禁" : "正常"}</div>
            </div>
            {error ? (
              <p className="mt-3 text-sm text-rose-600">{error}</p>
            ) : null}
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setBannedAction(null)}
                className="rounded-full border border-[var(--line)] px-4 py-2 text-sm text-[var(--ink-soft)]"
              >
                取消
              </button>
              <button
                type="button"
                disabled={banning}
                onClick={() => void handleBan(bannedAction)}
                className={`rounded-full px-4 py-2 text-sm font-medium text-white transition disabled:opacity-60 ${
                  bannedAction
                    ? "bg-rose-600 hover:bg-rose-700"
                    : "bg-emerald-600 hover:bg-emerald-700"
                }`}
              >
                {banning
                  ? "处理中..."
                  : bannedAction
                    ? "确认封禁"
                    : "确认解封"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}