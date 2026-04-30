"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Shield, ShieldOff } from "lucide-react";

import { CreditAdjuster } from "@/components/admin/admin-actions";

type UserData = {
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

  return (
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

      <div className="flex items-end">
        {!isCurrentAdmin && (
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
        )}
        {error && <span className="text-xs text-rose-600">{error}</span>}
      </div>
    </article>
  );
}
