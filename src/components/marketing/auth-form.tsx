"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";

type OAuthProvider = {
  type: string;
  displayName: string;
};

type AuthFormProps = {
  initialInviteCode?: string;
  mode: "login" | "register";
  oauthError?: string | null;
  oauthProviders?: OAuthProvider[];
};

export function AuthForm({
  mode,
  initialInviteCode = "",
  oauthProviders = [],
  oauthError = null,
}: AuthFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(oauthError);

  async function handleSubmit(formData: FormData) {
    setError(null);

    const payload =
      mode === "register"
        ? {
            email: String(formData.get("email") || ""),
            inviteCode: String(formData.get("inviteCode") || ""),
            password: String(formData.get("password") || ""),
          }
        : {
            email: String(formData.get("email") || ""),
            password: String(formData.get("password") || ""),
          };

    const response = await fetch(
      mode === "register" ? "/api/auth/register" : "/api/auth/login",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );

    const result = (await response.json()) as {
      data?: {
        user?: {
          role: "user" | "admin";
        };
      };
      error?: string;
    };

    if (!response.ok) {
      setError(result.error || "请求失败，请稍后再试");
      return;
    }

    startTransition(() => {
      router.push(result.data?.user?.role === "admin" ? "/admin" : "/create");
      router.refresh();
    });
  }

  return (
    <div className="grid gap-4">
      {/* OAuth 登录按钮 */}
      {oauthProviders.length > 0 && mode === "login" && (
        <div className="grid gap-3">
          {oauthProviders.map((provider) => (
            <a
              key={provider.type}
              href={`/api/auth/oauth/${provider.type}`}
              className="studio-card group flex items-center justify-center gap-3 rounded-[2rem] px-5 py-3.5 text-sm font-medium text-[var(--ink)] transition hover:-translate-y-0.5 hover:shadow-lg"
            >
              <ExternalLink className="size-4 text-[var(--accent)]" />
              使用 {provider.displayName} 账号登录
            </a>
          ))}

          <div className="flex items-center gap-4 px-2 py-2">
            <div className="h-px flex-1 bg-[var(--line)]" />
            <span className="text-xs text-[var(--ink-soft)]">或使用邮箱密码</span>
            <div className="h-px flex-1 bg-[var(--line)]" />
          </div>
        </div>
      )}

      {/* 邮箱密码表单 */}
      <form
        action={handleSubmit}
        className="studio-card noise-overlay relative grid gap-4 rounded-[2rem] p-6 md:p-8"
      >
        <div className="grid gap-2">
          <label className="text-sm text-[var(--ink-soft)]">邮箱</label>
          <input
            name="email"
            type="email"
            placeholder="you@example.com"
            className="rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 outline-none transition focus:border-[var(--accent)]"
          />
        </div>

        {mode === "register" ? (
          <div className="grid gap-2">
            <label className="text-sm text-[var(--ink-soft)]">邀请码</label>
            <input
              name="inviteCode"
              defaultValue={initialInviteCode}
              placeholder="FOUNDING-ACCESS"
              className="rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 uppercase outline-none transition focus:border-[var(--accent)]"
            />
          </div>
        ) : null}

        <div className="grid gap-2">
          <label className="text-sm text-[var(--ink-soft)]">密码</label>
          <input
            name="password"
            type="password"
            placeholder="至少 8 位"
            className="rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 outline-none transition focus:border-[var(--accent)]"
          />
        </div>

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={isPending}
          className="rounded-full bg-[var(--ink)] px-5 py-3 text-sm font-medium text-white transition hover:-translate-y-0.5 disabled:opacity-60"
        >
          {isPending ? "处理中..." : mode === "register" ? "注册并进入创作台" : "登录进入创作台"}
        </button>
      </form>
    </div>
  );
}
