import { redirect } from "next/navigation";

import { SiteHeader } from "@/components/marketing/site-header";
import { ProfileForm } from "@/components/settings/profile-form";
import { serializeUser } from "@/lib/prisma-mappers";
import { getCurrentUserRecord } from "@/lib/server/current-user";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "个人设置 — Narra Image",
  description: "管理你的个人资料、昵称、头像和积分信息。",
};

export default async function SettingsPage() {
  const user = await getCurrentUserRecord();
  if (!user) {
    redirect("/login");
  }

  const currentUser = serializeUser(user);

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

        <ProfileForm user={currentUser} />
      </section>
    </main>
  );
}
