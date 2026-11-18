"use client";

import { Ban, Eye, Shield, ShieldOff, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { CreditAdjuster } from "@/components/admin/admin-actions";
import { cn } from "@/lib/utils";
import { useAdminToast } from "./hooks/use-admin-toast";
import { AdminConfirmDialog } from "./ui/admin-modal";

export type AdminUserCardData = {
  banned: boolean;
  bannedAt: string | null;
  createdAt: string;
  credits: number;
  email: string;
  generationCount: number;
  id: string;
  nickname: string | null;
  oauthProvider?: string | null;
  role: "admin" | "user";
};

type UserAdminCardProps = {
  isCurrentAdmin: boolean;
  onInspect?: (user: AdminUserCardData) => void;
  user: AdminUserCardData;
};

export function UserAdminCard({
  isCurrentAdmin,
  onInspect,
  user,
}: UserAdminCardProps) {
  const router = useRouter();
  const toast = useAdminToast();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [bannedAction, setBannedAction] = useState<boolean | null>(null);
  const [banning, setBanning] = useState(false);
  const [confirmRoleChange, setConfirmRoleChange] = useState(false);
  const [updatingRole, setUpdatingRole] = useState(false);

  async function handleDelete() {
    setError(null);
    setDeleting(true);
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: "DELETE",
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        const msg = result.error || "删除失败";
        setError(msg);
        toast.error("删除用户失败", msg);
        return;
      }
      setConfirmDelete(false);
      toast.success("用户已永久删除", user.email);
      startTransition(() => {
        router.refresh();
      });
    } finally {
      setDeleting(false);
    }
  }

  async function handleRoleConfirm() {
    setError(null);
    setUpdatingRole(true);
    const nextPrismaRole = user.role === "admin" ? "USER" : "ADMIN";
    try {
      const response = await fetch(`/api/admin/users/${user.id}/role`, {
        body: JSON.stringify({ role: nextPrismaRole }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        const msg = result.error || "修改权限失败";
        setError(msg);
        toast.error("修改角色失败", msg);
        return;
      }

      setConfirmRoleChange(false);
      toast.success(
        nextPrismaRole === "ADMIN" ? "已授予管理员权限" : "已撤销管理员权限",
        user.email,
      );
      startTransition(() => {
        router.refresh();
      });
    } finally {
      setUpdatingRole(false);
    }
  }

  async function handleBan(banned: boolean) {
    setError(null);
    setBanning(true);
    try {
      const response = await fetch(`/api/admin/users/${user.id}/ban`, {
        body: JSON.stringify({ banned }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        const msg = result.error || "操作失败";
        setError(msg);
        toast.error(banned ? "封禁失败" : "解封失败", msg);
        return;
      }

      setBannedAction(null);
      toast.success(banned ? "用户已封禁" : "用户已解封", user.email);
      startTransition(() => {
        router.refresh();
      });
    } finally {
      setBanning(false);
    }
  }

  const nextIsAdmin = user.role !== "admin";

  return (
    <>
      <article className="studio-card grid gap-4 p-5 xl:grid-cols-[1.25fr_0.5fr_0.45fr_0.95fr_auto] xl:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                user.role === "admin"
                  ? "bg-amber-100 text-amber-800"
                  : "border border-[var(--line)] bg-[#f8f4ec] text-[var(--ink-soft)]",
              )}
            >
              {user.role === "admin" ? "管理员" : "普通用户"}
            </span>
            {user.oauthProvider ? (
              <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                {user.oauthProvider === "linuxdo" ? "LinuxDo" : user.oauthProvider}
              </span>
            ) : null}
            {user.banned ? (
              <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-[11px] font-semibold text-rose-700">
                已封禁
              </span>
            ) : null}
            {isCurrentAdmin ? (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                当前登录
              </span>
            ) : null}
          </div>

          <div className="mt-2 flex items-center gap-2">
            <h2 className="truncate text-base font-semibold text-[var(--ink)]">
              {user.nickname?.trim() || user.email}
            </h2>
          </div>
          {user.nickname?.trim() ? (
            <p className="mt-0.5 truncate font-mono text-xs text-[var(--ink-soft)]">
              {user.email}
            </p>
          ) : null}
          <p className="mt-1 text-xs text-[var(--ink-soft)]">
            注册于 {new Date(user.createdAt).toLocaleString("zh-CN")}
            {user.bannedAt
              ? ` · 封禁于 ${new Date(user.bannedAt).toLocaleString("zh-CN")}`
              : null}
          </p>
        </div>

        <div>
          <div className="text-xs text-[var(--ink-soft)]">当前积分</div>
          <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-[var(--admin-ink-credit)]">
            {user.credits.toLocaleString("zh-CN")}
          </div>
        </div>

        <div>
          <div className="text-xs text-[var(--ink-soft)]">生成任务</div>
          <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-[var(--ink)]">
            {user.generationCount.toLocaleString("zh-CN")}
          </div>
        </div>

        <CreditAdjuster userId={user.id} />

        <div className="flex flex-wrap items-center gap-1.5 xl:justify-end">
          {onInspect ? (
            <button
              type="button"
              onClick={() => onInspect(user)}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--ink)] transition hover:border-[#c85a32] hover:text-[#c85a32]"
            >
              <Eye className="size-3.5" aria-hidden />
              详情
            </button>
          ) : null}

          {!isCurrentAdmin ? (
            <>
              <button
                type="button"
                disabled={isPending || updatingRole}
                onClick={() => {
                  setError(null);
                  setConfirmRoleChange(true);
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition disabled:opacity-60",
                  user.role === "admin"
                    ? "border border-amber-200 bg-amber-50/50 text-amber-800 hover:bg-amber-100/70"
                    : "border border-[var(--line)] bg-white text-[var(--ink-soft)] hover:border-[#c85a32] hover:text-[#c85a32]",
                )}
              >
                {user.role === "admin" ? (
                  <>
                    <ShieldOff className="size-3.5" aria-hidden />
                    取消管理员
                  </>
                ) : (
                  <>
                    <Shield className="size-3.5" aria-hidden />
                    设为管理员
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setBannedAction(!user.banned);
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition",
                  user.banned
                    ? "border border-emerald-200 bg-emerald-50/50 text-emerald-700 hover:bg-emerald-100/70"
                    : "border border-rose-200 bg-white text-rose-600 hover:bg-rose-50",
                )}
              >
                <Ban className="size-3.5" aria-hidden />
                {user.banned ? "解封" : "封禁"}
              </button>

              <button
                type="button"
                disabled={deleting}
                onClick={() => {
                  setError(null);
                  setConfirmDelete(true);
                }}
                aria-label={`删除用户 ${user.email}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-60"
              >
                <Trash2 className="size-3.5" aria-hidden />
                删除
              </button>
            </>
          ) : null}
        </div>
      </article>

      <AdminConfirmDialog
        open={confirmRoleChange}
        onClose={() => {
          if (!updatingRole) setConfirmRoleChange(false);
        }}
        onConfirm={() => void handleRoleConfirm()}
        busy={updatingRole}
        tone="warning"
        title={nextIsAdmin ? "授予管理员权限" : "撤销管理员权限"}
        description={
          nextIsAdmin
            ? "授予管理员角色后，该用户将可访问整个管理后台并修改全站配置、渠道密钥与用户资产。"
            : "撤销管理员角色后，该用户将恢复为普通注册用户，无法再访问 /admin 管理台。"
        }
        confirmLabel={updatingRole ? "保存中…" : nextIsAdmin ? "确认设为管理员" : "确认取消管理员"}
        error={error}
      >
        <div className="grid gap-1.5 rounded-xl border border-[var(--line)] bg-[#f8f4ec] p-3 text-xs text-[var(--ink-soft)]">
          <div>目标邮箱：{user.email}</div>
          <div>当前昵称：{user.nickname?.trim() || "—"}</div>
          <div>变更角色：{user.role === "admin" ? "管理员 → 普通用户" : "普通用户 → 管理员"}</div>
        </div>
      </AdminConfirmDialog>

      <AdminConfirmDialog
        open={confirmDelete}
        onClose={() => {
          if (!deleting) setConfirmDelete(false);
        }}
        onConfirm={() => void handleDelete()}
        busy={deleting}
        tone="danger"
        title="永久删除用户"
        description="将永久删除该用户及其全部生成记录、对话、API Key、签到、兑换记录与点赞。该用户创建过的邀请码/兑换码将保留但清空创建者引用。"
        confirmLabel={deleting ? "删除中…" : "确认永久删除"}
        error={error}
      >
        <div className="grid gap-1.5 rounded-xl border border-[var(--line)] bg-[#f8f4ec] p-3 text-xs text-[var(--ink-soft)]">
          <div>邮箱：{user.email}</div>
          <div>昵称：{user.nickname?.trim() || "—"}</div>
          <div>角色：{user.role === "admin" ? "管理员" : "普通用户"}</div>
          <div>累计生成：{user.generationCount} 次</div>
        </div>
      </AdminConfirmDialog>

      <AdminConfirmDialog
        open={bannedAction !== null}
        onClose={() => {
          if (!banning) setBannedAction(null);
        }}
        onConfirm={() => {
          if (bannedAction !== null) void handleBan(bannedAction);
        }}
        busy={banning}
        tone={bannedAction ? "danger" : "primary"}
        title={bannedAction ? "封禁用户账号" : "解封用户账号"}
        description={
          bannedAction
            ? "封禁后该用户将无法登录，已登录会话会被立即拦截登出；历史积分与作品数据保留，后续可随时解封恢复。"
            : "解封后该用户可重新登录并恢复全部创作与 API 调用权限。"
        }
        confirmLabel={
          banning ? "处理中…" : bannedAction ? "确认封禁" : "确认解封"
        }
        error={error}
      >
        <div className="grid gap-1.5 rounded-xl border border-[var(--line)] bg-[#f8f4ec] p-3 text-xs text-[var(--ink-soft)]">
          <div>邮箱：{user.email}</div>
          <div>昵称：{user.nickname?.trim() || "—"}</div>
          <div>当前状态：{user.banned ? "已封禁" : "正常"}</div>
        </div>
      </AdminConfirmDialog>
    </>
  );
}
