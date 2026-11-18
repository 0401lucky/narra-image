import { ImageIcon } from "lucide-react";
import { redirect } from "next/navigation";

import { LoginCoverForm } from "@/components/admin/login-cover-form";
import { SettingsSubNav } from "@/components/admin/settings-sub-nav";
import { AdminPageHeader } from "@/components/admin/ui/admin-page-header";
import { requireAdminRecord } from "@/lib/server/current-user";
import {
  getLoginCoverConfig,
  getLoginCoverDisplayConfig,
} from "@/lib/server/login-cover";

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
  const display = await getLoginCoverDisplayConfig(config);

  return (
    <main className="pb-16">
      <section className="mx-auto grid max-w-7xl gap-6 px-5 pt-7 md:px-8">
        <AdminPageHeader
          eyebrow="Settings / Login Cover"
          icon={ImageIcon}
          title="登录封面配置"
          description="配置登录和注册页面左侧展示的视觉封面，支持从公开精选随机轮播或指定固定图像。"
        />

        <SettingsSubNav currentPath="/admin/settings/login-cover" />

        <LoginCoverForm
          initialConfig={config}
          resolvedCustomUrl={display.customUrl}
        />
      </section>
    </main>
  );
}
