"use client";

import {
  Ban,
  Eye,
  Grid2X2,
  List,
  Search,
  Shield,
  ShieldOff,
  Trash2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { CreditAdjuster } from "@/components/admin/admin-actions";
import {
  UserAdminCard,
  type AdminUserCardData,
} from "@/components/admin/user-admin-card";
import { cn } from "@/lib/utils";
import { useAdminToast } from "../hooks/use-admin-toast";
import { AdminConfirmDialog } from "../ui/admin-modal";
import { AdminTabs } from "../ui/admin-tabs";
import { UserDetailDrawer } from "./user-detail-drawer";

export type UsersFilterState = {
  auth: "" | "oauth" | "password";
  q: string;
  role: "" | "ADMIN" | "USER";
  sort: "newest" | "credits" | "generations";
  status: "" | "active" | "banned";
  view: "table" | "card";
};

type UsersManagementBoardProps = {
  currentAdminId: string;
  filters: UsersFilterState;
  totalCount: number;
  users: AdminUserCardData[];
};

export function UsersManagementBoard({
  currentAdminId,
  filters,
  users,
}: UsersManagementBoardProps) {
  const router = useRouter();
  const toast = useAdminToast();
  const [isPending, startTransition] = useTransition();
  const [searchInput, setSearchInput] = useState(filters.q);
  const [inspectUser, setInspectUser] = useState<AdminUserCardData | null>(null);

  const [roleTarget, setRoleTarget] = useState<AdminUserCardData | null>(null);
  const [banTarget, setBanTarget] = useState<{
    nextBanned: boolean;
    user: AdminUserCardData;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUserCardData | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  function pushFilters(patch: Partial<UsersFilterState>) {
    const merged = { ...filters, ...patch };
    const params = new URLSearchParams();
    if (merged.q.trim()) params.set("q", merged.q.trim());
    if (merged.role) params.set("role", merged.role);
    if (merged.status) params.set("status", merged.status);
    if (merged.auth) params.set("auth", merged.auth);
    if (merged.sort !== "newest") params.set("sort", merged.sort);
    if (merged.view !== "table") params.set("view", merged.view);
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `/admin/users?${qs}` : "/admin/users");
    });
  }

  async function confirmRoleToggle() {
    if (!roleTarget) return;
    setActionError(null);
    setActionBusy(true);
    const nextRole = roleTarget.role === "admin" ? "USER" : "ADMIN";
    try {
      const res = await fetch(`/api/admin/users/${roleTarget.id}/role`, {
        body: JSON.stringify({ role: nextRole }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        const msg = json.error || "修改权限失败";
        setActionError(msg);
        toast.error("角色变更失败", msg);
        return;
      }
      toast.success(
        nextRole === "ADMIN" ? "已授予管理员权限" : "已撤销管理员权限",
        roleTarget.email,
      );
      setRoleTarget(null);
      startTransition(() => router.refresh());
    } finally {
      setActionBusy(false);
    }
  }

  async function confirmBanToggle() {
    if (!banTarget) return;
    setActionError(null);
    setActionBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${banTarget.user.id}/ban`, {
        body: JSON.stringify({ banned: banTarget.nextBanned }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        const msg = json.error || "操作失败";
        setActionError(msg);
        toast.error("状态更新失败", msg);
        return;
      }
      toast.success(
        banTarget.nextBanned ? "用户已封禁" : "用户已解封",
        banTarget.user.email,
      );
      setBanTarget(null);
      startTransition(() => router.refresh());
    } finally {
      setActionBusy(false);
    }
  }

  async function confirmDeleteUser() {
    if (!deleteTarget) return;
    setActionError(null);
    setActionBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${deleteTarget.id}`, {
        method: "DELETE",
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        const msg = json.error || "删除失败";
        setActionError(msg);
        toast.error("删除用户失败", msg);
        return;
      }
      toast.success("用户已永久删除", deleteTarget.email);
      setDeleteTarget(null);
      startTransition(() => router.refresh());
    } finally {
      setActionBusy(false);
    }
  }

  const hasActiveFilter =
    Boolean(filters.q) ||
    Boolean(filters.role) ||
    Boolean(filters.status) ||
    Boolean(filters.auth) ||
    filters.sort !== "newest";

  return (
    <>
      {/* Filter & View Bar */}
      <div className="studio-card grid gap-3.5 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              pushFilters({ q: searchInput });
            }}
            className="flex flex-1 gap-2"
          >
            <div className="relative min-w-0 flex-1">
              <Search
                className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-[var(--ink-soft)]"
                aria-hidden
              />
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="搜索用户邮箱、昵称或用户 ID…"
                className="w-full rounded-xl border border-[var(--admin-line)] bg-white py-2.5 pr-9 pl-10 text-sm outline-none"
              />
              {searchInput ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearchInput("");
                    pushFilters({ q: "" });
                  }}
                  aria-label="清空搜索"
                  className="absolute top-1/2 right-3 -translate-y-1/2 text-[var(--ink-soft)] hover:text-[var(--ink)]"
                >
                  <X className="size-4" aria-hidden />
                </button>
              ) : null}
            </div>
            <button
              type="submit"
              disabled={isPending}
              className="shrink-0 rounded-xl bg-[#231810] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#c85a32]"
            >
              搜索
            </button>
          </form>

          <AdminTabs
            ariaLabel="用户列表视图切换"
            layoutId="users-view-mode"
            value={filters.view}
            onChange={(nextView) => pushFilters({ view: nextView })}
            options={[
              { icon: List, label: "表格", value: "table" },
              { icon: Grid2X2, label: "卡片", value: "card" },
            ]}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2.5 border-t border-[var(--line)]/60 pt-3 text-xs">
          <label className="flex items-center gap-1.5 text-[var(--ink-soft)]">
            <span>角色</span>
            <select
              value={filters.role}
              onChange={(e) =>
                pushFilters({ role: e.target.value as UsersFilterState["role"] })
              }
              className="rounded-lg border border-[var(--line)] bg-white px-2.5 py-1.5 text-xs text-[var(--ink)] outline-none"
            >
              <option value="">全部角色</option>
              <option value="ADMIN">管理员</option>
              <option value="USER">普通用户</option>
            </select>
          </label>

          <label className="flex items-center gap-1.5 text-[var(--ink-soft)]">
            <span>状态</span>
            <select
              value={filters.status}
              onChange={(e) =>
                pushFilters({
                  status: e.target.value as UsersFilterState["status"],
                })
              }
              className="rounded-lg border border-[var(--line)] bg-white px-2.5 py-1.5 text-xs text-[var(--ink)] outline-none"
            >
              <option value="">全部状态</option>
              <option value="active">正常可用</option>
              <option value="banned">已封禁</option>
            </select>
          </label>

          <label className="flex items-center gap-1.5 text-[var(--ink-soft)]">
            <span>认证源</span>
            <select
              value={filters.auth}
              onChange={(e) =>
                pushFilters({ auth: e.target.value as UsersFilterState["auth"] })
              }
              className="rounded-lg border border-[var(--line)] bg-white px-2.5 py-1.5 text-xs text-[var(--ink)] outline-none"
            >
              <option value="">全部来源</option>
              <option value="oauth">第三方 OAuth</option>
              <option value="password">邮箱密码</option>
            </select>
          </label>

          <label className="flex items-center gap-1.5 text-[var(--ink-soft)]">
            <span>排序</span>
            <select
              value={filters.sort}
              onChange={(e) =>
                pushFilters({ sort: e.target.value as UsersFilterState["sort"] })
              }
              className="rounded-lg border border-[var(--line)] bg-white px-2.5 py-1.5 text-xs text-[var(--ink)] outline-none"
            >
              <option value="newest">最新注册</option>
              <option value="credits">当前积分最高</option>
              <option value="generations">生成任务最多</option>
            </select>
          </label>

          {hasActiveFilter ? (
            <button
              type="button"
              onClick={() => {
                setSearchInput("");
                pushFilters({
                  auth: "",
                  q: "",
                  role: "",
                  sort: "newest",
                  status: "",
                });
              }}
              className="ml-auto font-medium text-[#b54722] hover:underline"
            >
              重置全部筛选
            </button>
          ) : null}
        </div>
      </div>

      {users.length === 0 ? (
        <div className="studio-card border border-dashed p-10 text-center text-sm text-[var(--ink-soft)]">
          当前筛选条件下未找到匹配的用户记录。
        </div>
      ) : filters.view === "card" ? (
        <div className="grid gap-4">
          {users.map((user) => (
            <UserAdminCard
              key={user.id}
              user={user}
              isCurrentAdmin={user.id === currentAdminId}
              onInspect={setInspectUser}
            />
          ))}
        </div>
      ) : (
        <div className="studio-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="border-b border-[var(--line)] text-xs text-[var(--ink-soft)]">
                <tr>
                  <th className="px-4 py-3.5 font-medium">用户账号</th>
                  <th className="px-3 py-3.5 font-medium">身份与状态</th>
                  <th className="px-3 py-3.5 font-medium">积分余额</th>
                  <th className="px-3 py-3.5 font-medium">累计生成</th>
                  <th className="px-3 py-3.5 font-medium">快捷调账</th>
                  <th className="px-3 py-3.5 font-medium">注册时间</th>
                  <th className="px-4 py-3.5 text-right font-medium">管理操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]/70">
                {users.map((user) => {
                  const isSelf = user.id === currentAdminId;
                  return (
                    <tr
                      key={user.id}
                      className="transition-colors hover:bg-[#faf6ee]/80"
                    >
                      <td className="max-w-[240px] px-4 py-3.5 align-middle">
                        <button
                          type="button"
                          onClick={() => setInspectUser(user)}
                          className="group text-left"
                        >
                          <div className="truncate font-semibold text-[var(--ink)] group-hover:text-[#c85a32]">
                            {user.nickname?.trim() || user.email}
                          </div>
                          {user.nickname?.trim() ? (
                            <div className="truncate font-mono text-xs text-[var(--ink-soft)]">
                              {user.email}
                            </div>
                          ) : null}
                        </button>
                      </td>

                      <td className="px-3 py-3.5 align-middle">
                        <div className="flex flex-wrap gap-1.5 text-[11px]">
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 font-semibold",
                              user.role === "admin"
                                ? "bg-amber-100 text-amber-800"
                                : "border border-[var(--line)] bg-[#faf7f1] text-[var(--ink-soft)]",
                            )}
                          >
                            {user.role === "admin" ? "管理员" : "用户"}
                          </span>
                          {user.oauthProvider ? (
                            <span className="rounded-full bg-sky-50 px-2 py-0.5 font-medium text-sky-700">
                              {user.oauthProvider === "linuxdo"
                                ? "LinuxDo"
                                : user.oauthProvider}
                            </span>
                          ) : null}
                          {user.banned ? (
                            <span className="rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-rose-700">
                              已封禁
                            </span>
                          ) : null}
                          {isSelf ? (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
                              当前
                            </span>
                          ) : null}
                        </div>
                      </td>

                      <td className="px-3 py-3.5 align-middle font-mono text-base font-semibold tabular-nums text-[var(--admin-ink-credit)]">
                        {user.credits.toLocaleString("zh-CN")}
                      </td>

                      <td className="px-3 py-3.5 align-middle font-mono font-semibold tabular-nums text-[var(--ink)]">
                        {user.generationCount.toLocaleString("zh-CN")}
                      </td>

                      <td className="px-3 py-3.5 align-middle">
                        <CreditAdjuster
                          userId={user.id}
                          currentCredits={user.credits}
                        />
                      </td>

                      <td className="px-3 py-3.5 align-middle font-mono text-xs text-[var(--ink-soft)]">
                        {new Date(user.createdAt).toLocaleDateString("zh-CN")}
                      </td>

                      <td className="px-4 py-3.5 text-right align-middle">
                        <div className="inline-flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setInspectUser(user)}
                            className="inline-flex items-center gap-1 rounded-lg border border-[var(--line)] bg-white px-2.5 py-1.5 text-xs font-medium text-[var(--ink)] transition hover:border-[#c85a32] hover:text-[#c85a32]"
                            title="查看 360° 用户详情"
                          >
                            <Eye className="size-3.5" aria-hidden />
                            档案
                          </button>

                          {!isSelf ? (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setActionError(null);
                                  setRoleTarget(user);
                                }}
                                aria-label={
                                  user.role === "admin"
                                    ? `取消管理员 ${user.email}`
                                    : `设为管理员 ${user.email}`
                                }
                                title={
                                  user.role === "admin" ? "取消管理员" : "设为管理员"
                                }
                                className="inline-flex size-8 items-center justify-center rounded-lg border border-[var(--line)] bg-white text-[var(--ink-soft)] transition hover:border-amber-300 hover:text-amber-700"
                              >
                                {user.role === "admin" ? (
                                  <ShieldOff className="size-3.5" aria-hidden />
                                ) : (
                                  <Shield className="size-3.5" aria-hidden />
                                )}
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  setActionError(null);
                                  setBanTarget({
                                    nextBanned: !user.banned,
                                    user,
                                  });
                                }}
                                aria-label={
                                  user.banned
                                    ? `解封用户 ${user.email}`
                                    : `封禁用户 ${user.email}`
                                }
                                title={user.banned ? "解封账号" : "封禁账号"}
                                className={cn(
                                  "inline-flex size-8 items-center justify-center rounded-lg border bg-white transition",
                                  user.banned
                                    ? "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                                    : "border-rose-200 text-rose-600 hover:bg-rose-50",
                                )}
                              >
                                <Ban className="size-3.5" aria-hidden />
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  setActionError(null);
                                  setDeleteTarget(user);
                                }}
                                aria-label={`删除用户 ${user.email}`}
                                title="删除用户"
                                className="inline-flex size-8 items-center justify-center rounded-lg border border-rose-200 bg-rose-50/60 text-rose-600 transition hover:bg-rose-100"
                              >
                                <Trash2 className="size-3.5" aria-hidden />
                              </button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <UserDetailDrawer
        userId={inspectUser?.id ?? null}
        userEmail={inspectUser?.email}
        onClose={() => setInspectUser(null)}
      />

      <AdminConfirmDialog
        open={roleTarget !== null}
        onClose={() => {
          if (!actionBusy) setRoleTarget(null);
        }}
        onConfirm={() => void confirmRoleToggle()}
        busy={actionBusy}
        tone="warning"
        title={
          roleTarget?.role === "admin" ? "撤销管理员权限" : "授予管理员权限"
        }
        description={
          roleTarget?.role === "admin"
            ? "撤销后该账号将恢复为普通用户，无法再访问 /admin 后台。"
            : "授予后该账号将拥有管理后台完整访问与配置修改权限。"
        }
        confirmLabel={actionBusy ? "提交中…" : "确认变更角色"}
        error={actionError}
      >
        {roleTarget ? (
          <div className="rounded-xl border border-[var(--line)] bg-[#f8f4ec] p-3 text-xs text-[var(--ink-soft)]">
            账号：{roleTarget.email}
          </div>
        ) : null}
      </AdminConfirmDialog>

      <AdminConfirmDialog
        open={banTarget !== null}
        onClose={() => {
          if (!actionBusy) setBanTarget(null);
        }}
        onConfirm={() => void confirmBanToggle()}
        busy={actionBusy}
        tone={banTarget?.nextBanned ? "danger" : "primary"}
        title={banTarget?.nextBanned ? "封禁用户账号" : "解封用户账号"}
        description={
          banTarget?.nextBanned
            ? "封禁后该用户将立即丧失登录与创作权限，历史资产保留可随时恢复。"
            : "解封后该用户可恢复正常登录与功能使用。"
        }
        confirmLabel={
          actionBusy
            ? "提交中…"
            : banTarget?.nextBanned
              ? "确认封禁"
              : "确认解封"
        }
        error={actionError}
      >
        {banTarget ? (
          <div className="rounded-xl border border-[var(--line)] bg-[#f8f4ec] p-3 text-xs text-[var(--ink-soft)]">
            账号：{banTarget.user.email}
          </div>
        ) : null}
      </AdminConfirmDialog>

      <AdminConfirmDialog
        open={deleteTarget !== null}
        onClose={() => {
          if (!actionBusy) setDeleteTarget(null);
        }}
        onConfirm={() => void confirmDeleteUser()}
        busy={actionBusy}
        tone="danger"
        title="永久删除用户"
        description="将永久删除该用户及其名下全部生成记录、对话、API Key、签到与兑换流水，操作不可撤销。"
        confirmLabel={actionBusy ? "删除中…" : "确认永久删除"}
        error={actionError}
      >
        {deleteTarget ? (
          <div className="grid gap-1 rounded-xl border border-[var(--line)] bg-[#f8f4ec] p-3 text-xs text-[var(--ink-soft)]">
            <div>邮箱：{deleteTarget.email}</div>
            <div>累计生成：{deleteTarget.generationCount} 次</div>
          </div>
        ) : null}
      </AdminConfirmDialog>
    </>
  );
}
