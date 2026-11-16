import maintenance from "../../../contracts/media/v1/maintenance.json";
import type { ImagePolicy } from "./image-contract";

export type { ImagePolicy } from "./image-contract";
export const IMAGE_STORAGE_REVISION = maintenance.storageRevision;
export const IMAGE_READER_REVISION = maintenance.readerRevision;
export const IMAGE_MAINTENANCE_REVISION = maintenance.executorRevision;
export const IMAGE_MAINTENANCE_LEASE_SECONDS = maintenance.limits.leaseSeconds;
export const IMAGE_READ_LEASE_SECONDS = maintenance.limits.readLeaseSeconds;
export const IMAGE_READ_TIMEOUT_MS = maintenance.limits.readTimeoutMilliseconds;
export const IMAGE_MAINTENANCE_DELETE_SECONDS = maintenance.limits.deleteSeconds;
export const IMAGE_MAINTENANCE_PASS_SECONDS = maintenance.limits.passSeconds;
export const IMAGE_MAINTENANCE_POLL_MS = maintenance.limits.pollMilliseconds;
export const IMAGE_QUOTA_WAIT_MS = maintenance.limits.quotaWaitMilliseconds;
export const IMAGE_CLEANUP_PREVIEW_LIMIT = maintenance.limits.previewAssets;
export const IMAGE_MAINTENANCE_ITEM_LIMIT = maintenance.limits.jobItems;

export type ImageMaintenanceMode = "MANUAL_AGE" | "MANUAL_ALL" | "SCHEDULE" | "QUOTA" | "SOURCE_RETIREMENT";
export type ImageMaintenanceState = "PREVIEW" | "QUEUED" | "RUNNING" | "WAITING" | "SUCCEEDED" | "PARTIAL" | "CANCELLED" | "EXPIRED";
export type ImageMaintenanceItem = {
  id: string; assetId: string; state: "CANDIDATE" | "CLAIMED" | "RETRY" | "DONE" | "SKIPPED";
  byteLength: string; releasedBytes: string; reason: string | null;
};
export type ImageMaintenanceJob = {
  id: string; mode: ImageMaintenanceMode; state: ImageMaintenanceState; policyVersion: number;
  createdAt: string; confirmedAt: string | null; expiresAt: string | null; completedAt: string | null; nextAttemptAt: string | null;
  estimatedBytes: string; releasedBytes: string; totalItems: number; completedItems: number; skippedItems: number;
  failedItems: number; pendingItems: number; truncated: boolean; items: ImageMaintenanceItem[]; nextCursor: string | null;
};
export type ImageCleanupPreview = {
  previewId: string; policyVersion: number; expiresAt: string; assetCount: number; objectCount: number; estimatedBytes: string; truncated: boolean;
};
export type ImageStorageOverview = {
  policy: ImagePolicy; usedBytes: string; reservedBytes: string; assetCount: string; objectCount: string;
  cleanableBytes: string; cleanableAssetCount: string; cleanableObjectCount: string; protectedBytes: string; unmanagedImageCount: string;
  locations: Array<{ id: string; provider: "S3" | "LOCAL"; objectCount: string; usedBytes: string }>;
  recentJobs: ImageMaintenanceJob[];
};
export type ImageUpdatePolicyInput = {
  expectedVersion: number; limitBytes: string; enabled: boolean; quotaCleanupEnabled: boolean;
  scheduleEnabled: boolean; retentionDays: number; intervalSeconds: number;
};
export type ImagePreviewCleanupInput = { actorId: string; previewRequestId: string; expectedPolicyVersion: number; mode: "MANUAL_AGE" | "MANUAL_ALL"; retentionDays?: number };
export type ImageConfirmCleanupInput = { actorId: string; previewId: string; requestId: string; expectedPolicyVersion: number };
export type ImageMaintenanceJobInput = { jobId: string; cursor?: string; limit?: number };
export type ImageCancelMaintenanceInput = { actorId: string; jobId: string; requestId: string };
export type ImageQuotaCleanupInput = { requestId: string; ownerId: string; intentKey: string; neededBytes: string };
