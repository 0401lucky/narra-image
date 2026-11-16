import { redirect } from "next/navigation";

import { SettingsSubNav } from "@/components/admin/settings-sub-nav";
import { StorageManager } from "@/components/admin/storage/storage-manager";
import { Alert } from "@/components/ui/alert";
import { requireAdminRecord } from "@/lib/server/current-user";
import { getStorageManagementOverview } from "@/lib/storage/image-management";
import type { ImageManagementOverview } from "@/lib/storage/image-management-types";
import type { ImageMaintenanceJob } from "@/lib/storage/image-maintenance-types";
import { ImageRepository } from "@/lib/storage/image-repository";
import { imageCleanupJobQuerySchema } from "@/lib/validators";

export const dynamic = "force-dynamic";
export const metadata = { title: "图片存储 — 系统设置 — Narra Image" };

type StorageManagementPageData = { overview: ImageManagementOverview; initialJob: ImageMaintenanceJob | null };

export default async function ImageStorageSettingsPage({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  try { await requireAdminRecord(); }
  catch { redirect("/login"); }
  const query = await searchParams;
  let data: StorageManagementPageData | null;
  try {
    const overview = await getStorageManagementOverview();
    const requested = query.job ? imageCleanupJobQuerySchema.safeParse({ jobId: query.job }) : null;
    const job = requested?.success ? await new ImageRepository().getMaintenanceJob(requested.data) : null;
    const initialJob = job ?? overview.recentJobs.find((item) => item.state !== "PREVIEW" && item.state !== "EXPIRED") ?? null;
    data = { overview, initialJob };
  } catch {
    data = null;
  }
  const content = data
    ? <StorageManager initialOverview={data.overview} initialJob={data.initialJob} />
    : <Alert title="图片存储暂不可用">请确认图片存储升级已完成，稍后刷新重试。</Alert>;
  return <main className="pb-16"><section className="mx-auto grid max-w-7xl gap-6 px-5 pt-8 md:px-8"><div><p className="admin-eyebrow">Settings / Storage</p><h1 className="mt-3 text-3xl font-semibold tracking-tight text-[var(--ink)] md:text-4xl">图片存储</h1><p className="mt-2 text-sm text-[var(--ink-soft)]">查看图片用量，管理容量和保留期限，并安全清理历史图片。</p></div><SettingsSubNav currentPath="/admin/settings/storage" />{content}</section></main>;
}
