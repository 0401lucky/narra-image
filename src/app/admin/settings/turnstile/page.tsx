import { redirect } from "next/navigation";

import { AdminNav } from "@/components/admin/admin-nav";
import { SettingsSubNav } from "@/components/admin/settings-sub-nav";
import { TurnstileConfigForm } from "@/components/admin/turnstile-config-form";
import { SiteHeader } from "@/components/marketing/site-header";
import { getTurnstileConfig } from "@/lib/auth/turnstile";
import { serializeUser } from "@/lib/prisma-mappers";
import { requireAdminRecord } from "@/lib/server/current-user";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "人机验证 — Narra Image",
};

export default async function AdminTurnstilePage() {
  let admin;
  try {
    admin = await requireAdminRecord();
  } catch {
    redirect("/login");
  }

  const cfg = await getTurnstileConfig();

  return (
    <main className="pb-16">
      <SiteHeader currentUser={serializeUser(admin)} />
      <section className="mx-auto grid max-w-3xl gap-6 px-5 pt-8 md:px-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between mb-2">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--ink)] md:text-4xl">
              人机验证
            </h1>
            <p className="mt-2 text-sm text-[var(--ink-soft)]">
              配置 Cloudflare Turnstile，防止表单被自动化脚本批量调用。
            </p>
          </div>
          <AdminNav currentPath="/admin/settings" />
        </div>

        <SettingsSubNav currentPath="/admin/settings/turnstile" />

        <TurnstileConfigForm
          initialConfig={{
            isEnabled: cfg.isEnabled,
            siteKey: cfg.siteKey ?? "",
            secretConfigured: Boolean(cfg.secretEncrypted),
            protectLogin: cfg.protectLogin,
            protectRegister: cfg.protectRegister,
            protectInviteRedeem: cfg.protectInviteRedeem,
            protectGenerate: cfg.protectGenerate,
          }}
        />
      </section>
    </main>
  );
}