import { ShieldAlert } from "lucide-react";
import { redirect } from "next/navigation";

import { ModerationConfigForm } from "@/components/admin/moderation-config-form";
import { ModerationNavTabs } from "@/components/admin/moderation/moderation-nav-tabs";
import { SettingsSubNav } from "@/components/admin/settings-sub-nav";
import { AdminPageHeader } from "@/components/admin/ui/admin-page-header";
import { db } from "@/lib/db";
import { getModerationConfigMeta } from "@/lib/moderation/config";
import { getSensitiveWordsSnapshot } from "@/lib/moderation/sensitive-words";
import { requireAdminRecord } from "@/lib/server/current-user";

export const dynamic = "force-dynamic";

export default async function AdminModerationSettingsPage() {
  try {
    await requireAdminRecord();
  } catch {
    redirect("/login");
  }

  const [config, words, totalReviewsCount] = await Promise.all([
    getModerationConfigMeta(),
    getSensitiveWordsSnapshot(),
    db.contentReview.count().catch(() => 0),
  ]);

  return (
    <main className="pb-16">
      <section className="mx-auto grid max-w-7xl gap-6 px-5 pt-7 md:px-8">
        <AdminPageHeader
          eyebrow="Moderation / Rules"
          icon={ShieldAlert}
          title="内容审核规则与敏感词库"
          description="配置全站敏感词匹配与 AI 审核端点阈值；AI 审核超时或异常时会自动降级放行，不阻塞正常生成。"
        />

        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <ModerationNavTabs
            activePath="/admin/settings/moderation"
            totalReviewsCount={totalReviewsCount}
          />
          <SettingsSubNav currentPath="/admin/settings/moderation" />
        </div>

        <ModerationConfigForm config={config} words={words} />
      </section>
    </main>
  );
}
