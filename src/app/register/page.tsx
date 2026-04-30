import Link from "next/link";

import { AuthForm } from "@/components/marketing/auth-form";
import { SiteHeader } from "@/components/marketing/site-header";

export const dynamic = "force-dynamic";

type RegisterPageProps = {
  searchParams?: Promise<{
    inviteCode?: string;
  }>;
};

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const initialInviteCode = typeof resolvedSearchParams?.inviteCode === "string"
    ? resolvedSearchParams.inviteCode
    : "";

  return (
    <main className="pb-20">
      <SiteHeader currentUser={null} />

      <section className="mx-auto grid max-w-6xl gap-8 px-5 pt-10 md:px-8 xl:grid-cols-[0.94fr_1.06fr]">
        <div className="space-y-5">
          <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-soft)]">
            Invitation Only
          </p>
          <h1 className="editorial-title text-6xl leading-none font-semibold">
            第一批用户，
            <br />
            值得被认真对待。
          </h1>
          <p className="max-w-xl text-base leading-8 text-[var(--ink-soft)]">
            注册成功会默认拿到 500 积分。邀请码由后台生成，
            这让你能控制产品节奏，也便于后续做精细化用户运营。
            如果你使用的是管理员引导邮箱，首次注册时邀请码也可以留空。
          </p>
          <div className="studio-card rounded-[2rem] p-5 text-sm leading-7 text-[var(--ink-soft)]">
            已经有账号？
            <Link href="/login" className="ml-2 font-medium text-[var(--accent)]">
              直接登录
            </Link>
          </div>
        </div>

        <AuthForm initialInviteCode={initialInviteCode} mode="register" />
      </section>
    </main>
  );
}
