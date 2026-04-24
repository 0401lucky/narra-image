import { redirect } from "next/navigation";

import { requireAdminRecord } from "@/lib/server/current-user";
import { getAllOAuthProviders } from "@/lib/auth/oauth-config";
import { SiteHeader } from "@/components/marketing/site-header";
import { AdminNav } from "@/components/admin/admin-nav";
import { OAuthProviderManager } from "@/components/admin/oauth-provider-manager";
import { serializeUser } from "@/lib/prisma-mappers";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "登录源管理 — Narra Image",
};

export default async function AdminOAuthPage() {
  let admin;
  try {
    admin = await requireAdminRecord();
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
      <SiteHeader currentUser={serializeUser(admin)} />
      <section className="mx-auto grid max-w-7xl gap-6 px-5 pt-8 md:px-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between mb-2">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--ink)] md:text-4xl">
              登录源管理
            </h1>
            <p className="mt-2 text-sm text-[var(--ink-soft)]">
              配置第三方 OAuth 登录源，启用后用户可在登录页使用第三方账号快捷登录。
            </p>
          </div>
          <AdminNav currentPath="/admin/oauth" />
        </div>

        <OAuthProviderManager initialProviders={serialized} />
      </section>
    </main>
  );
}
