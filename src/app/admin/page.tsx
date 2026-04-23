import { redirect } from "next/navigation";

import { ShowcaseStatus } from "@prisma/client";

import { db } from "@/lib/db";
import { getBuiltInProviderConfigForAdmin } from "@/lib/providers/built-in-provider";
import { requireAdminRecord } from "@/lib/server/current-user";
import { BuiltInProviderForm } from "@/components/admin/admin-actions";
import { SiteHeader } from "@/components/marketing/site-header";
import { AdminNav } from "@/components/admin/admin-nav";
import { serializeUser } from "@/lib/prisma-mappers";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  let admin;
  try {
    admin = await requireAdminRecord();
  } catch {
    redirect("/login");
  }

  const [userCount, inviteCount, generationCount, featuredCount, providerConfig] =
    await Promise.all([
      db.user.count(),
      db.inviteCode.count(),
      db.generationJob.count(),
      db.generationImage.count({
        where: {
          showcaseStatus: ShowcaseStatus.FEATURED,
        },
      }),
      getBuiltInProviderConfigForAdmin(),
    ]);

  return (
    <main className="pb-16">
      <SiteHeader currentUser={serializeUser(admin)} />
      <section className="mx-auto grid max-w-7xl gap-6 px-5 pt-8 md:px-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between mb-2">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--ink)] md:text-4xl">
              管理后台
            </h1>
            <p className="mt-2 text-sm text-[var(--ink-soft)]">
              全局数据概览与内置渠道配置。
            </p>
          </div>
          <AdminNav currentPath="/admin" />
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            ["注册用户", userCount],
            ["邀请码总数", inviteCount],
            ["生成记录", generationCount],
            ["公开作品", featuredCount],
          ].map(([label, value]) => (
            <div key={label} className="studio-card rounded-[1.8rem] p-5">
              <div className="text-sm text-[var(--ink-soft)]">{label}</div>
              <div className="mt-3 text-4xl font-semibold text-[var(--ink)]">{value}</div>
            </div>
          ))}
        </div>

        <BuiltInProviderForm initialConfig={providerConfig} />
      </section>
    </main>
  );
}
