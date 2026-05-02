import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthForm } from "@/components/marketing/auth-form";
import { AuthShell } from "@/components/marketing/auth-shell";
import { getPublicTurnstileConfig } from "@/lib/auth/turnstile";
import { fromPrismaRole } from "@/lib/prisma-mappers";
import { getCurrentUserRecord } from "@/lib/server/current-user";
import { listFeaturedWorksPage } from "@/lib/server/works";

export const dynamic = "force-dynamic";

type RegisterPageProps = {
  searchParams?: Promise<{
    inviteCode?: string;
  }>;
};

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const user = await getCurrentUserRecord();
  if (user) {
    redirect(fromPrismaRole(user.role) === "admin" ? "/admin" : "/create");
  }

  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const initialInviteCode =
    typeof resolvedSearchParams?.inviteCode === "string"
      ? resolvedSearchParams.inviteCode
      : "";

  const [featuredPage, turnstile] = await Promise.all([
    listFeaturedWorksPage({ limit: 1 }).catch(() => ({
      hasMore: false,
      items: [] as Array<{ authorName: string; image: string; title: string }>,
      nextCursor: null,
    })),
    getPublicTurnstileConfig(),
  ]);
  const featured = featuredPage.items[0] ?? null;
  const cover = featured
    ? {
        authorName: featured.authorName,
        image: featured.image,
        title: featured.title,
      }
    : null;

  return (
    <AuthShell
      eyebrow="Join Narra"
      title="First in line."
      description="第一批用户值得被认真对待。注册成功默认 500 积分；邀请码由后台生成，可前往邀请码领取页申领。"
      cover={cover}
      coverCaption="Welcome Aboard"
      footnote={
        <span className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
          <span>已经有账号？</span>
          <Link href="/login" className="font-medium text-[var(--accent)]">
            直接登录
          </Link>
          <span className="text-[var(--ink-soft)]/50">/</span>
          <Link href="/invite-claim" className="font-medium text-[var(--accent)]">
            申领邀请码
          </Link>
        </span>
      }
    >
      <AuthForm
        mode="register"
        initialInviteCode={initialInviteCode}
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
