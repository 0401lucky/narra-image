import { Server } from "lucide-react";
import { redirect } from "next/navigation";

import { ChannelManager } from "@/components/admin/channel-manager";
import { SettingsSubNav } from "@/components/admin/settings-sub-nav";
import { AdminPageHeader } from "@/components/admin/ui/admin-page-header";
import { getChannelsForAdmin } from "@/lib/providers/built-in-provider";
import { requireAdminRecord } from "@/lib/server/current-user";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "生图渠道 — Narra Image",
};

export default async function AdminChannelsPage() {
  try {
    await requireAdminRecord();
  } catch {
    redirect("/login");
  }

  const channels = await getChannelsForAdmin();

  return (
    <main className="pb-16">
      <section className="mx-auto grid max-w-7xl gap-6 px-5 pt-7 md:px-8">
        <AdminPageHeader
          eyebrow="Infra / Channels"
          icon={Server}
          title="生图渠道管理"
          description="管理 OpenAI / Grok / 国内中转等生图与视频 API 渠道，支持连通性测速、模型检索与优先级排序。"
        />

        <SettingsSubNav currentPath="/admin/settings/channels" />

        <div className="studio-card p-5 md:p-6">
          <ChannelManager initialChannels={channels} />
        </div>
      </section>
    </main>
  );
}
