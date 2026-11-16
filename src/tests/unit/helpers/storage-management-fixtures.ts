import type { ImageCleanupPreview, ImageMaintenanceJob, ImagePolicy } from "@/lib/storage/image-maintenance-types";
import type { ImageManagementOverview } from "@/lib/storage/image-management-types";

export const storageFixtureIds = {
  job: "a1111111-1111-4111-8111-111111111111",
  request: "a2222222-2222-4222-8222-222222222222",
  asset: "a3333333-3333-4333-8333-333333333333",
  item: "a4444444-4444-4444-8444-444444444444",
} as const;
const createdAt = "2026-11-01T00:00:00.000Z";

export function storagePolicy(overrides: Partial<ImagePolicy> = {}): ImagePolicy {
  return {
    scope: "images", version: 1, limitBytes: "5000000000", enabled: true, quotaCleanupEnabled: true,
    scheduleEnabled: false, retentionDays: 30, intervalSeconds: 86400, nextRunAt: null, createdAt, updatedAt: createdAt,
    ...overrides,
  };
}

export function storageOverview(overrides: Partial<ImageManagementOverview> = {}): ImageManagementOverview {
  return {
    policy: storagePolicy(), usedBytes: "2306867200", reservedBytes: "104857600", assetCount: "4", objectCount: "5",
    cleanableBytes: "200000000", cleanableAssetCount: "2", cleanableObjectCount: "2", protectedBytes: "2106867200",
    unmanagedImageCount: "7", locations: [{ id: "local-v1:fixture", provider: "LOCAL", objectCount: "5", usedBytes: "2306867200" }],
    recentJobs: [], managedEnabled: true, writeBackend: "local", ...overrides,
  };
}

export function cleanupPreview(overrides: Partial<ImageCleanupPreview> = {}): ImageCleanupPreview {
  return {
    previewId: storageFixtureIds.job, policyVersion: 1, expiresAt: "2099-01-01T00:00:00.000Z",
    assetCount: 2, objectCount: 2, estimatedBytes: "200000000", truncated: false, ...overrides,
  };
}

export function cleanupJob(overrides: Partial<ImageMaintenanceJob> = {}): ImageMaintenanceJob {
  return {
    id: storageFixtureIds.job, mode: "MANUAL_ALL", state: "QUEUED", policyVersion: 1, createdAt,
    confirmedAt: createdAt, expiresAt: null, completedAt: null, nextAttemptAt: null, estimatedBytes: "200000000",
    releasedBytes: "0", totalItems: 2, completedItems: 0, skippedItems: 0, failedItems: 0, pendingItems: 2,
    truncated: false, items: [], nextCursor: null, ...overrides,
  };
}
