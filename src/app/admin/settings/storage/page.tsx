import { HardDrive } from "lucide-react";
import { redirect } from "next/navigation";

import { SettingsSubNav } from "@/components/admin/settings-sub-nav";
import { StorageManager } from "@/components/admin/storage/storage-manager";
import { AdminPageHeader } from "@/components/admin/ui/admin-page-header";
import { Alert } from "@/components/ui/alert";
import { requireAdminRecord } from "@/lib/server/current-user";
import type { ImageMaintenanceJob } from "@/lib/storage/image-maintenance-types";
import { getStorageManagementOverview } from "@/lib/storage/image-management";
import type { ImageManagementOverview } from "@/lib/storage/image-management-types";
import { ImageRepository } from "@/lib/storage/image-repository";
import { imageCleanupJobQuerySchema } from "@/lib/validators";

export const dynamic = "force-dynamic";
export const metadata = { title: "图片存储 — 系统设置 — Narra Image" };

type StorageManagementPageData = {
  initialJob: ImageMaintenanceJob | null;
  overview: ImageManagementOverview;
};

export default async function ImageStorageSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string }>;
}) {
  try {
    await requireAdminRecord();
  } catch {
    redirect("/login");
  }
  const query = await searchParams;
  let data: StorageManagementPageData | null;
  try {
    const overview = await getStorageManagementOverview();
    const requested = query.job
      ? imageCleanupJobQuerySchema.safeParse({ jobId: query.job })
      : null;
    const job = requested?.success
      ? await new ImageRepository().getMaintenanceJob(requested.data)
      : null;
    const initialJob =
      job ??
      overview.recentJobs.find(
        (item) => item.state !== "PREVIEW" && item.state !== "EXPIRED",
      ) ??
      null;
    data = { initialJob, overview };
  } catch {
    data = null;
  }
  const content = data ? (
    <StorageManager
      initialOverview={data.overview}
      initialJob={data.initialJob}
    />
  ) : (
    <Alert title="图片存储暂不可用">
      请确认图片存储升级已完成，稍后刷新重试。
    </Alert>
  );
  return (
    <main className="pb-16">
      <section className="mx-auto grid max-w-7xl gap-6 px-5 pt-7 md:px-8">
        <AdminPageHeader
          eyebrow="Settings / Storage"
          icon={HardDrive}
          title="图片存储与清理"
          description="查看受纳管图片用量，管理容量上限与保留天数，并安全预览和执行历史图片回收。"
        />
        <SettingsSubNav currentPath="/admin/settings/storage" />
        {content}
      </section>
    </main>
  );
}
