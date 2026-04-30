"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Sparkles } from "lucide-react";

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
  const [oauthInviteCode, setOauthInviteCode] = useState("");

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

  function buildOAuthHref(providerType: string) {
    const trimmed = oauthInviteCode.trim();
    if (!trimmed) return `/api/auth/oauth/${providerType}`;
    return `/api/auth/oauth/${providerType}?inviteCode=${encodeURIComponent(trimmed)}`;
  }

  const hasOAuth = mode === "login" && oauthProviders.length > 0;

  return (
    <div className="grid gap-5">
      <form action={handleSubmit} className="grid gap-4">
        <div className="grid gap-2">
          <label htmlFor="auth-email" className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--ink-soft)]">
            邮箱
          </label>
          <input
            id="auth-email"
            name="email"
            type="email"
            autoComplete={mode === "register" ? "email" : "username"}
            required
            placeholder="you@example.com"
            className="auth-input"
          />
        </div>

        {mode === "register" ? (
          <div className="grid gap-2">
            <label htmlFor="auth-invite" className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--ink-soft)]">
              邀请码
            </label>
            <input
              id="auth-invite"
              name="inviteCode"
              defaultValue={initialInviteCode}
              placeholder="FOUNDING-ACCESS"
              className="auth-input uppercase"
            />
          </div>
        ) : null}

        <div className="grid gap-2">
          <label htmlFor="auth-password" className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--ink-soft)]">
            密码
          </label>
          <input
            id="auth-password"
            name="password"
            type="password"
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            required
            placeholder="至少 8 位"
            className="auth-input"
          />
        </div>

        {error ? (
          <div
            role="alert"
            className="rounded-2xl border border-rose-200/80 bg-rose-50/80 px-4 py-3 text-sm text-rose-600 backdrop-blur"
          >
            {error}
          </div>
        ) : null}

        <button type="submit" disabled={isPending} className="auth-submit-btn mt-2">
          <span className="flex items-center justify-center gap-2">
            {isPending
              ? "处理中..."
              : mode === "register"
                ? "注册并进入创作台"
                : "登录进入创作台"}
            {!isPending ? <ArrowRight className="size-4" /> : null}
          </span>
        </button>
      </form>

      {hasOAuth ? (
        <>
          <div className="flex items-center gap-3 px-1 py-2 text-[11px] uppercase tracking-[0.28em] text-[var(--ink-soft)]/80">
            <span className="h-px flex-1 bg-[var(--line)]" />
            或使用第三方登录
            <span className="h-px flex-1 bg-[var(--line)]" />
          </div>

          <div className="grid gap-3">
            {oauthProviders.map((provider) => (
              <a
                key={provider.type}
                href={buildOAuthHref(provider.type)}
                className="auth-oauth-btn"
              >
                <Sparkles className="size-4 text-[var(--accent)]" />
                <span>使用 {provider.displayName} 登录</span>
              </a>
            ))}

            <details className="auth-collapse">
              <summary>
                <span>需要邀请码？首次第三方登录请填写</span>
              </summary>
              <input
                value={oauthInviteCode}
                onChange={(event) => setOauthInviteCode(event.target.value)}
                placeholder="FOUNDING-ACCESS"
                className="auth-input mt-3 w-full uppercase"
              />
              <p className="mt-2 text-[11px] leading-5 text-[var(--ink-soft)]/80">
                老用户登录可留空；首次绑定第三方账号时邀请码用于消耗名额。
              </p>
            </details>
          </div>
        </>
      ) : null}
    </div>
  );
}
