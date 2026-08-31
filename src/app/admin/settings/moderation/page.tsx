import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";

import { ModerationConfigForm } from "@/components/admin/moderation-config-form";
import { SettingsSubNav } from "@/components/admin/settings-sub-nav";
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

  const [config, words] = await Promise.all([
    getModerationConfigMeta(),
    getSensitiveWordsSnapshot(),
  ]);

  return (
    <main className="pb-16">
      <section className="mx-auto grid max-w-7xl gap-6 px-5 pt-8 md:px-8">
        <div>
          <p className="admin-eyebrow">Settings</p>
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--ink)] md:text-4xl">
            <ShieldAlert className="mr-2 inline-block size-7 text-[var(--ink-soft)]" />
            内容审核
          </h1>
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            敏感词 + AI 审核配置。命中即拒绝生成并记录触发事件；AI 审核服务异常或未配置时会自动放行，不影响正常生成。
          </p>
        </div>

        <SettingsSubNav currentPath="/admin/settings/moderation" />

        <ModerationConfigForm config={config} words={words} />
      </section>
    </main>
  );
}