import { redirect } from "next/navigation";

import { AdminNav } from "@/components/admin/admin-nav";
import { ChannelManager } from "@/components/admin/channel-manager";
import { SettingsSubNav } from "@/components/admin/settings-sub-nav";
import { SiteHeader } from "@/components/marketing/site-header";
import { serializeUser } from "@/lib/prisma-mappers";
import { getChannelsForAdmin } from "@/lib/providers/built-in-provider";
import { requireAdminRecord } from "@/lib/server/current-user";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "生图渠道 — Narra Image",
};

export default async function AdminChannelsPage() {
  let admin;
  try {
    admin = await requireAdminRecord();
  } catch {
    redirect("/login");
  }

  const channels = await getChannelsForAdmin();

  return (
    <main className="pb-16">
      <SiteHeader currentUser={serializeUser(admin)} />
      <section className="mx-auto grid max-w-7xl gap-6 px-5 pt-8 md:px-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between mb-2">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--ink)] md:text-4xl">
              生图渠道
            </h1>
            <p className="mt-2 text-sm text-[var(--ink-soft)]">
              配置多个生图 API 渠道，支持 OpenAI / Grok / 国内中转等并存与切换。
            </p>
          </div>
          <AdminNav currentPath="/admin/settings" />
        </div>

        <SettingsSubNav currentPath="/admin/settings/channels" />

        <div className="studio-card rounded-[1.8rem] p-5 md:p-6">
          <ChannelManager initialChannels={channels} />
        </div>
      </section>
    </main>
  );
}