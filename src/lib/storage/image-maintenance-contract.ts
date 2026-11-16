import "server-only";

import { z } from "zod";
import { imageIdSchema, imageLocationSchema, imageObjectSchema, imagePolicySchema, managedImageSchema } from "./image-contract";

const bytePattern = /^(0|[1-9][0-9]*)(?![\s\S])/;
const bytes = z.string().regex(bytePattern).max(19)
  .refine((value) => value.length <= 19 && bytePattern.test(value) && BigInt(value) <= BigInt("9223372036854775807"));
const time = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative();
export const imageMaintenanceItemSchema = z.object({
  id: imageIdSchema, assetId: imageIdSchema, state: z.enum(["CANDIDATE", "CLAIMED", "RETRY", "DONE", "SKIPPED"]),
  byteLength: bytes, releasedBytes: bytes, reason: z.string().nullable(),
}).strict();
export const imageMaintenanceJobSchema = z.object({
  id: imageIdSchema, mode: z.enum(["MANUAL_AGE", "MANUAL_ALL", "SCHEDULE", "QUOTA", "SOURCE_RETIREMENT"]),
  state: z.enum(["PREVIEW", "QUEUED", "RUNNING", "WAITING", "SUCCEEDED", "PARTIAL", "CANCELLED", "EXPIRED"]),
  policyVersion: z.number().int().positive(), createdAt: time, confirmedAt: time.nullable(), expiresAt: time.nullable(),
  completedAt: time.nullable(), nextAttemptAt: time.nullable(), estimatedBytes: bytes, releasedBytes: bytes,
  totalItems: count, completedItems: count, skippedItems: count, failedItems: count, pendingItems: count,
  truncated: z.boolean(), items: z.array(imageMaintenanceItemSchema).max(100), nextCursor: imageIdSchema.nullable(),
}).strict();
export const imageCleanupPreviewSchema = z.object({
  previewId: imageIdSchema, policyVersion: z.number().int().positive(), expiresAt: time,
  assetCount: count, objectCount: count, estimatedBytes: bytes, truncated: z.boolean(),
}).strict();
export const imageStorageOverviewSchema = z.object({
  policy: imagePolicySchema, usedBytes: bytes, reservedBytes: bytes, assetCount: bytes, objectCount: bytes,
  cleanableBytes: bytes, cleanableAssetCount: bytes, cleanableObjectCount: bytes, protectedBytes: bytes,
  unmanagedImageCount: bytes, locations: z.array(z.object({ id: z.string(), provider: z.enum(["S3", "LOCAL"]), objectCount: bytes, usedBytes: bytes }).strict()),
  recentJobs: z.array(imageMaintenanceJobSchema).max(10),
}).strict();
export const imageDeleteClaimSchema = z.object({
  jobId: imageIdSchema, itemId: imageIdSchema, mode: z.enum(["MANUAL_AGE", "MANUAL_ALL", "SCHEDULE", "QUOTA", "SOURCE_RETIREMENT"]),
  object: imageObjectSchema, location: imageLocationSchema, deleteToken: imageIdSchema, deleteExpiresAt: time,
}).strict();
export const imageDeleteReceiptSchema = z.object({ accepted: z.boolean(), replayed: z.boolean(), releasedBytes: bytes, job: imageMaintenanceJobSchema }).strict();
export const imageReservationCleanupSchema = z.object({ closed: count, releasedBytes: bytes }).strict();
export const imageReadLeaseSchema = z.object({ image: managedImageSchema, readExpiresAt: time }).strict();
export type ImageDeleteClaim = z.infer<typeof imageDeleteClaimSchema>;
export type ImageDeleteReceipt = z.infer<typeof imageDeleteReceiptSchema>;
export type ImageReadLease = z.infer<typeof imageReadLeaseSchema>;
export type ImageMaintenanceLeaseInput = { workerId: string; token: string };
export type ImageClaimMaintenanceInput = { executorToken: string; verifiedLocationIds: string[] };
export type ImageFinishMaintenanceInput = { jobId: string; itemId: string; objectId: string; deleteToken: string; outcome: "DELETED" | "MISSING" | "FAILED" | "UNKNOWN"; errorCode?: string };
export type ImageReadInput = { assetId?: string; publicToken?: string; url?: string; ownerId?: string };
export type ImagePrepareCopyInput = { assetId: string; ownerId: string; intentKey: string; byteLength: string; leaseSeconds?: number };
export type ImageReplicaVerificationInput = { assetId: string; sourceObjectId: string; targetObjectId: string; byteLength: string; sha256: string; aliasUrls: string[]; readerProtocolRevision: number };
export type ImageSourceRetirementInput = { requestId: string; assetId: string; sourceObjectId: string; targetObjectId: string; verificationId: string };
