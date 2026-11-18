import { ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";

import { SettingsSubNav } from "@/components/admin/settings-sub-nav";
import { TurnstileConfigForm } from "@/components/admin/turnstile-config-form";
import { AdminPageHeader } from "@/components/admin/ui/admin-page-header";
import { getTurnstileConfig } from "@/lib/auth/turnstile";
import { requireAdminRecord } from "@/lib/server/current-user";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "人机验证 — Narra Image",
};

export default async function AdminTurnstilePage() {
  try {
    await requireAdminRecord();
  } catch {
    redirect("/login");
  }

  const cfg = await getTurnstileConfig();

  return (
    <main className="pb-16">
      <section className="mx-auto grid max-w-7xl gap-6 px-5 pt-7 md:px-8">
        <AdminPageHeader
          eyebrow="Settings / Security"
          icon={ShieldCheck}
          title="人机验证防护"
          description="配置 Cloudflare Turnstile，防止登录、注册与公开邀请码领取被自动化脚本批量调用。"
        />

        <SettingsSubNav currentPath="/admin/settings/turnstile" />

        <TurnstileConfigForm
          initialConfig={{
            isEnabled: cfg.isEnabled,
            protectGenerate: cfg.protectGenerate,
            protectInviteRedeem: cfg.protectInviteRedeem,
            protectLogin: cfg.protectLogin,
            protectRegister: cfg.protectRegister,
            secretConfigured: Boolean(cfg.secretEncrypted),
            siteKey: cfg.siteKey ?? "",
          }}
        />
      </section>
    </main>
  );
}
