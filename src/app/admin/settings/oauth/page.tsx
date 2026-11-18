import { KeyRound } from "lucide-react";
import { redirect } from "next/navigation";

import { OAuthProviderManager } from "@/components/admin/oauth-provider-manager";
import { SettingsSubNav } from "@/components/admin/settings-sub-nav";
import { AdminPageHeader } from "@/components/admin/ui/admin-page-header";
import { getAllOAuthProviders } from "@/lib/auth/oauth-config";
import { requireAdminRecord } from "@/lib/server/current-user";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "登录源管理 — Narra Image",
};

export default async function AdminOAuthPage() {
  try {
    await requireAdminRecord();
  } catch {
    redirect("/login");
  }

  const providers = await getAllOAuthProviders();

  const serialized = providers.map((p) => ({
    ...p,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }));

  return (
    <main className="pb-16">
      <section className="mx-auto grid max-w-7xl gap-6 px-5 pt-7 md:px-8">
        <AdminPageHeader
          eyebrow="Settings / OAuth"
          icon={KeyRound}
          title="第三方登录源"
          description="配置 OAuth2 登录源，启用后用户可在登录页直接使用社区或第三方账号快捷登录。"
        />

        <SettingsSubNav currentPath="/admin/settings/oauth" />

        <OAuthProviderManager initialProviders={serialized} />
      </section>
    </main>
  );
}
