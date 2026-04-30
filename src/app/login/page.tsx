import Link from "next/link";

import { AuthForm } from "@/components/marketing/auth-form";
import { SiteHeader } from "@/components/marketing/site-header";
import { getEnabledOAuthProviders } from "@/lib/auth/oauth-config";

export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams?: Promise<{
    error?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const resolvedParams = searchParams ? await searchParams : undefined;
  const oauthError = typeof resolvedParams?.error === "string" ? resolvedParams.error : null;
  const oauthProviders = await getEnabledOAuthProviders();

  return (
    <main className="pb-20">
      <SiteHeader currentUser={null} />

      <section className="mx-auto flex w-full max-w-md flex-col gap-6 px-5 pt-10 md:px-8">
        <AuthForm mode="login" oauthProviders={oauthProviders} oauthError={oauthError} />

        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-sm text-[var(--ink-soft)]">
          <span>还没有账号？</span>
          <Link href="/register" className="font-medium text-[var(--accent)]">
            使用邀请码注册
          </Link>
          <span className="text-[var(--ink-soft)]/50">/</span>
          <Link href="/invite-claim" className="font-medium text-[var(--accent)]">
            前往邀请码领取平台
          </Link>
        </div>
      </section>
    </main>
  );
}
