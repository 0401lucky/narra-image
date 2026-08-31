import { redirect } from "next/navigation";

import { SiteHeader } from "@/components/marketing/site-header";
import { ProfileForm } from "@/components/settings/profile-form";
import { db } from "@/lib/db";
import { getOAuthProvider } from "@/lib/auth/oauth-config";
import { serializeUser } from "@/lib/prisma-mappers";
import { getCurrentUserRecord } from "@/lib/server/current-user";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "个人设置 — Narra Image",
  description: "管理你的个人资料、昵称、头像和积分信息。",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUserRecord();
  if (!user) {
    redirect("/login");
  }

  const params = await searchParams;
  const linuxdoEnabled = (await getOAuthProvider("linuxdo"))?.isEnabled ?? false;
  const queryNotice: { hint: "linked" | "error"; message: string } | null =
    params.linked === "linuxdo"
      ? { hint: "linked", message: "已成功绑定 LinuxDo 账号" }
      : typeof params.error === "string" && params.error.length > 0
        ? { hint: "error", message: params.error }
        : null;

  const currentUser = serializeUser(user);
  const hasPassword =
    (await db.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true },
    }))?.passwordHash != null;

  return (
    <main className="pb-20">
      <SiteHeader currentUser={currentUser} />

      <section className="mx-auto grid max-w-7xl gap-5 px-5 pb-12 pt-8 md:px-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--ink)] md:text-4xl">
            个人设置
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--ink-soft)]">
            管理你的昵称、头像等个人资料。设置昵称后，公开作品和画廊中将优先显示昵称。
          </p>
        </div>

        <ProfileForm
          user={currentUser}
          oauthProvider={user.oauthProvider}
          hasPassword={hasPassword}
          linuxdoEnabled={linuxdoEnabled}
          queryNotice={queryNotice}
        />
      </section>
    </main>
  );
}
