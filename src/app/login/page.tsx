import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthForm } from "@/components/marketing/auth-form";
import { AuthShell } from "@/components/marketing/auth-shell";
import { getEnabledOAuthProviders } from "@/lib/auth/oauth-config";
import { getPublicTurnstileConfig } from "@/lib/auth/turnstile";
import { fromPrismaRole } from "@/lib/prisma-mappers";
import { getCurrentUserRecord } from "@/lib/server/current-user";
import { getLoginCoverConfig } from "@/lib/server/login-cover";
import { listFeaturedWorksPage } from "@/lib/server/works";

export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams?: Promise<{
    error?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const user = await getCurrentUserRecord();
  if (user) {
    redirect(fromPrismaRole(user.role) === "admin" ? "/admin" : "/create");
  }

  const resolvedParams = searchParams ? await searchParams : undefined;
  const oauthError =
    typeof resolvedParams?.error === "string" ? resolvedParams.error : null;

  const [oauthProviders, featuredPage, turnstile, loginCoverConfig] = await Promise.all([
    getEnabledOAuthProviders(),
    listFeaturedWorksPage({ limit: 1 }).catch(() => ({
      hasMore: false,
      items: [] as Array<{ authorName: string; image: string; title: string }>,
      nextCursor: null,
    })),
    getPublicTurnstileConfig(),
    getLoginCoverConfig(),
  ]);
  const featured = featuredPage.items[0] ?? null;
  const cover = loginCoverConfig.mode === "custom"
    ? null
    : featured
      ? {
          authorName: featured.authorName,
          image: featured.image,
          title: featured.title,
        }
      : null;
  const coverImageUrl = loginCoverConfig.mode === "custom" ? loginCoverConfig.customUrl : null;

  return (
    <AuthShell
      eyebrow="Secure Access"
      title="WelcomeBack"
      description="使用你的账户继续进入 Narra Image 创作台。我们会自动同步积分与作品。"
      cover={cover}
      coverImageUrl={coverImageUrl}
      coverCaption="Featured Vision"
      footnote={
        <span className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
          <span>还没有账号？</span>
          <Link href="/register" className="font-medium text-[var(--accent)]">
            使用邀请码注册
          </Link>
          <span className="text-[var(--ink-soft)]/50">/</span>
          <Link href="/invite-claim" className="font-medium text-[var(--accent)]">
            前往邀请码领取
          </Link>
        </span>
      }
    >
      <AuthForm
        mode="login"
        oauthProviders={oauthProviders}
        oauthError={oauthError}
        turnstile={{
          isEnabled: turnstile.isEnabled,
          siteKey: turnstile.siteKey,
          protectLogin: turnstile.protectLogin,
          protectRegister: turnstile.protectRegister,
        }}
      />
    </AuthShell>
  );
}
