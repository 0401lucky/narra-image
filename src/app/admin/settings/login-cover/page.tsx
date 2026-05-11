import { redirect } from "next/navigation";

import { requireAdminRecord } from "@/lib/server/current-user";
import { getLoginCoverConfig } from "@/lib/server/login-cover";
import { LoginCoverForm } from "@/components/admin/login-cover-form";
import { SettingsSubNav } from "@/components/admin/settings-sub-nav";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "登录封面 — 系统设置 — Narra Image",
};

export default async function LoginCoverSettingsPage() {
  try {
    await requireAdminRecord();
  } catch {
    redirect("/login");
  }

  const config = await getLoginCoverConfig();

  return (
    <main className="pb-16">
      <section className="mx-auto grid max-w-7xl gap-6 px-5 pt-8 md:px-8">
        <div>
          <p className="admin-eyebrow">Settings / Login Cover</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[var(--ink)] md:text-4xl">
            登录封面图
          </h1>
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            配置登录和注册页面左侧展示的封面图片。
          </p>
        </div>

        <SettingsSubNav currentPath="/admin/settings/login-cover" />

        <LoginCoverForm initialConfig={config} />
      </section>
    </main>
  );
}
