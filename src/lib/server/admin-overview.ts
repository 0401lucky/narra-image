import "server-only";

import { GenerationStatus, ShowcaseStatus } from "@prisma/client";

import type { AdminShellSummary } from "@/components/admin/admin-frame";
import { db } from "@/lib/db";
import { getStorageManagementOverview } from "@/lib/storage/image-management";

export type AdminDashboardTrendPoint = {
  creditsSpent: number;
  dateKey: string;
  failed: number;
  label: string;
  succeeded: number;
  total: number;
};

export type AdminDashboardData = {
  activeChannelCount: number;
  activeRedeemCodeCount: number;
  coordinationCount: number;
  failedPromptSourcesCount: number;
  featuredImagesCount: number;
  featuredVideosCount: number;
  inviteRemainingCount: number;
  pendingWorksCount: number;
  storage: {
    limitBytes: string;
    managedEnabled: boolean;
    usedBytes: string;
    usedRatio: number;
  } | null;
  takedownPendingCount: number;
  todayFailedGenerations: number;
  todayGenerations: number;
  todayNewUsers: number;
  totalChannelCount: number;
  totalGenerations: number;
  totalPromptCount: number;
  trend: AdminDashboardTrendPoint[];
  userCount: number;
};

async function safeCount(fn: () => Promise<number>): Promise<number> {
  try {
    return await fn();
  } catch {
    return 0;
  }
}

export async function getAdminShellSummary(): Promise<AdminShellSummary> {
  const [
    activeChannelCount,
    pendingImages,
    pendingVideos,
    takedownImages,
    takedownVideos,
    coordinationCount,
    failedPromptSourcesCount,
  ] = await Promise.all([
    safeCount(() => db.providerChannel.count({ where: { isActive: true } })),
    safeCount(() =>
      db.generationImage.count({ where: { showcaseStatus: ShowcaseStatus.PENDING } }),
    ),
    safeCount(() =>
      db.generatedVideo.count({ where: { showcaseStatus: ShowcaseStatus.PENDING } }),
    ),
    safeCount(() =>
      db.generationImage.count({
        where: { showcaseStatus: ShowcaseStatus.TAKEDOWN_PENDING },
      }),
    ),
    safeCount(() =>
      db.generatedVideo.count({
        where: { showcaseStatus: ShowcaseStatus.TAKEDOWN_PENDING },
      }),
    ),
    safeCount(() =>
      db.generationJob.count({
        where: {
          contractVersion: { gte: 1 },
          handoffState: "UNKNOWN",
          status: GenerationStatus.FAILED,
        },
      }),
    ),
    safeCount(() =>
      db.promptSource.count({
        where: { isEnabled: true, status: "FAILED" },
      }),
    ),
  ]);

  const pendingWorks = pendingImages + pendingVideos + takedownImages + takedownVideos;
  const badges = {
    coordination: coordinationCount,
    failedPrompts: failedPromptSourcesCount,
    pendingWorks,
  };

  if (activeChannelCount === 0) {
    return {
      badges,
      statusHref: "/admin/settings/channels",
      statusLabel: "未启用生图渠道",
      statusTone: "attention",
    };
  }

  if (coordinationCount > 0) {
    return {
      badges,
      statusHref: "/admin/generations?status=COORDINATION",
      statusLabel: `${coordinationCount} 项任务待协调`,
      statusTone: "attention",
    };
  }

  if (failedPromptSourcesCount > 0) {
    return {
      badges,
      statusHref: "/admin/prompts",
      statusLabel: `${failedPromptSourcesCount} 个提示词源异常`,
      statusTone: "attention",
    };
  }

  return {
    badges,
    statusHref: "/admin/settings/channels",
    statusLabel: `${activeChannelCount} 渠道运行中`,
    statusTone: "healthy",
  };
}

function formatDayKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatShortDayLabel(date: Date) {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${m}/${d}`;
}

export async function getAdminDashboardData(): Promise<AdminDashboardData> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sevenDaysStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 6,
  );

  const [
    userCount,
    todayNewUsers,
    totalGenerations,
    todayGenerations,
    todayFailedGenerations,
    featuredImagesCount,
    featuredVideosCount,
    pendingImages,
    pendingVideos,
    takedownImages,
    takedownVideos,
    coordinationCount,
    failedPromptSourcesCount,
    totalPromptCount,
    activeChannelCount,
    totalChannelCount,
    inviteRemainingCount,
    activeRedeemCodeCount,
    recentJobs,
    storageOverview,
  ] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { createdAt: { gte: todayStart } } }),
    db.generationJob.count(),
    db.generationJob.count({ where: { createdAt: { gte: todayStart } } }),
    db.generationJob.count({
      where: { createdAt: { gte: todayStart }, status: GenerationStatus.FAILED },
    }),
    db.generationImage.count({ where: { showcaseStatus: ShowcaseStatus.FEATURED } }),
    safeCount(() =>
      db.generatedVideo.count({ where: { showcaseStatus: ShowcaseStatus.FEATURED } }),
    ),
    db.generationImage.count({ where: { showcaseStatus: ShowcaseStatus.PENDING } }),
    safeCount(() =>
      db.generatedVideo.count({ where: { showcaseStatus: ShowcaseStatus.PENDING } }),
    ),
    db.generationImage.count({
      where: { showcaseStatus: ShowcaseStatus.TAKEDOWN_PENDING },
    }),
    safeCount(() =>
      db.generatedVideo.count({
        where: { showcaseStatus: ShowcaseStatus.TAKEDOWN_PENDING },
      }),
    ),
    db.generationJob.count({
      where: {
        contractVersion: { gte: 1 },
        handoffState: "UNKNOWN",
        status: GenerationStatus.FAILED,
      },
    }),
    db.promptSource.count({ where: { isEnabled: true, status: "FAILED" } }),
    db.promptLibraryItem.count(),
    db.providerChannel.count({ where: { isActive: true } }),
    db.providerChannel.count(),
    db.inviteCode.count({ where: { claimedAt: null, usedAt: null } }),
    db.redeemCode.count({
      where: {
        isActive: true,
        OR: [{ batchId: null }, { batch: { isActive: true } }],
      },
    }),
    db.generationJob.findMany({
      select: {
        createdAt: true,
        creditsSpent: true,
        status: true,
      },
      where: { createdAt: { gte: sevenDaysStart } },
    }),
    getStorageManagementOverview().catch(() => null),
  ]);

  const buckets = new Map<string, AdminDashboardTrendPoint>();
  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - offset,
    );
    const key = formatDayKey(day);
    buckets.set(key, {
      creditsSpent: 0,
      dateKey: key,
      failed: 0,
      label: formatShortDayLabel(day),
      succeeded: 0,
      total: 0,
    });
  }

  for (const job of recentJobs) {
    const key = formatDayKey(job.createdAt);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.total += 1;
    if (job.status === GenerationStatus.SUCCEEDED) {
      bucket.succeeded += 1;
      bucket.creditsSpent += Math.max(0, job.creditsSpent);
    } else if (job.status === GenerationStatus.FAILED) {
      bucket.failed += 1;
    }
  }

  let storage: AdminDashboardData["storage"] = null;
  if (storageOverview) {
    const used = Number(storageOverview.usedBytes) || 0;
    const limit = Number(storageOverview.policy.limitBytes) || 1;
    storage = {
      limitBytes: storageOverview.policy.limitBytes,
      managedEnabled: storageOverview.managedEnabled,
      usedBytes: storageOverview.usedBytes,
      usedRatio: Math.min(1, Math.max(0, used / limit)),
    };
  }

  return {
    activeChannelCount,
    activeRedeemCodeCount,
    coordinationCount,
    failedPromptSourcesCount,
    featuredImagesCount,
    featuredVideosCount,
    inviteRemainingCount,
    pendingWorksCount: pendingImages + pendingVideos,
    storage,
    takedownPendingCount: takedownImages + takedownVideos,
    todayFailedGenerations,
    todayGenerations,
    todayNewUsers,
    totalChannelCount,
    totalGenerations,
    totalPromptCount,
    trend: Array.from(buckets.values()),
    userCount,
  };
}
