import "server-only";

import { z } from "zod";

import history from "../../../contracts/media/v1/history.json";
import {
  imageAssetSchema, imageByteStringSchema, imageIdSchema, imageLocationSchema,
  imageObjectSchema, imageReservationSchema, imageWriteTicketSchema,
} from "./image-contract";
import { imageMaintenanceJobSchema } from "./image-maintenance-contract";

if (history.contract !== "narra.image.history" || history.version !== 1 || history.storageRevision !== 3) {
  throw new Error("Unsupported image history contract");
}
export const IMAGE_HISTORY_PAGE_LIMIT = history.limits.pageItems;
export const IMAGE_HISTORY_LEASE_SECONDS = history.limits.leaseSeconds;
const time = z.iso.datetime({ offset: true });
const digest = z.string().regex(/^[0-9a-f]{64}(?![\s\S])/);
const kind = z.enum(["GENERATED", "CANVAS_IMPORT", "REFERENCE_URL", "VIDEO"]);
const nullableId = imageIdSchema.nullable();
const nullableText = z.string().nullable();

export const imageHistorySourceBindingSchema = z.object({
  subjectKind: kind.exclude(["VIDEO"]), subjectId: z.string().min(1).max(128), expectedSnapshotHash: digest,
  locationId: z.string().min(1).max(128), key: z.string().min(1).max(512), ownerId: z.string().min(1).max(128),
}).strict();
export const imageHistoryCandidateSchema = z.object({
  subjectKind: kind, subjectId: z.string(), ownerId: nullableText, exactUrl: nullableText,
  snapshot: z.record(z.string(), z.json()), snapshotHash: digest, createdAt: time,
  classification: z.enum(["SOURCE_BINDING_REQUIRED", "ALREADY_MANAGED", "DATA_URL", "THIRD_PARTY_OR_UNKNOWN", "CANVAS_UNCERTAIN", "VIDEO_EXCLUDED"]),
}).strict();
export const imageHistoryScanPageSchema = z.object({
  candidates: z.array(imageHistoryCandidateSchema).max(IMAGE_HISTORY_PAGE_LIMIT), nextCursor: nullableText, upperBound: time,
}).strict();
export const imageHistoryObjectDescriptorSchema = z.object({
  asset: imageAssetSchema, object: imageObjectSchema, location: imageLocationSchema,
}).strict().refine(({ asset, object, location }) => asset.id === object.assetId && object.locationId === location.id
  && object.byteLength === asset.byteLength && object.sha256 === asset.sha256);
export const imageHistoryItemSchema = z.object({
  id: imageIdSchema, jobId: imageIdSchema, subjectKind: kind, subjectId: z.string(), ownerId: nullableText,
  exactUrl: nullableText, snapshot: z.record(z.string(), z.json()), snapshotHash: digest,
  sourceBinding: imageHistorySourceBindingSchema.nullable(),
  state: z.enum(["PENDING", "OBSERVED", "ADOPTED", "COPYING", "RECONCILING", "BLOCKED", "SOURCE_RETAINED", "RETIREMENT_REQUESTED", "EXCLUDED"]),
  token: nullableId, leaseExpiresAt: time.nullable(), sourceObservationId: nullableId, assetId: nullableId,
  sourceObjectId: nullableId, targetObjectId: nullableId, reservationId: nullableId, attempt: z.number().int().nonnegative(),
  intentKey: nullableText, targetKey: nullableText, replicaVerificationId: nullableId, retirementJobId: nullableId,
  errorCode: nullableText, createdAt: time, updatedAt: time,
  source: imageHistoryObjectDescriptorSchema.nullable(), target: imageHistoryObjectDescriptorSchema.nullable(),
}).strict();
export const imageHistoryJobSchema = z.object({
  id: imageIdSchema, requestId: imageIdSchema, actorId: z.string(), mode: z.enum(["ADOPT", "COPY"]),
  scope: z.enum(["ALL", "GENERATED", "CANVAS_IMPORT", "REFERENCE_URL"]), planDigest: digest,
  publicUrlBase: z.string().min(1).max(2048),
  sourceBindings: z.array(imageHistorySourceBindingSchema).max(IMAGE_HISTORY_PAGE_LIMIT), targetLocationId: nullableText,
  retireSource: z.boolean(), upperBound: time, cursor: nullableText, scanComplete: z.boolean(),
  state: z.enum(["PLANNED", "RUNNING", "WAITING", "SUCCEEDED", "PARTIAL", "CANCELLED"]),
  totalItems: z.number().int().nonnegative(), completedItems: z.number().int().nonnegative(), blockedItems: z.number().int().nonnegative(),
  createdAt: time, updatedAt: time,
}).strict();
export const imageHistoryItemsPageSchema = z.object({ items: z.array(imageHistoryItemSchema).max(IMAGE_HISTORY_PAGE_LIMIT), nextCursor: nullableId }).strict();
export const imageObservationResultSchema = z.object({ id: imageIdSchema }).strict();
export const imageHistoryAdoptResultSchema = z.object({ item: imageHistoryItemSchema, replayed: z.boolean(), accountedDelta: imageByteStringSchema, overLimit: z.boolean() }).strict();
export const imageHistoryCopyResultSchema = z.object({ item: imageHistoryItemSchema, reservation: imageReservationSchema, ticket: imageWriteTicketSchema }).strict();
export const imageHistoryReconcileReadSchema = z.object({ item: imageHistoryItemSchema, readExpiresAt: time }).strict();
export const imageHistoryReconcileResultSchema = z.object({ accepted: z.boolean(), state: z.string(), byteDelta: z.literal("0"), item: imageHistoryItemSchema }).strict();
export const imageHistorySwitchResultSchema = z.object({ switched: z.boolean(), replayed: z.boolean(), replicaVerificationId: imageIdSchema, item: imageHistoryItemSchema }).strict();
export const imageHistoryRetireResultSchema = z.object({ item: imageHistoryItemSchema, job: imageMaintenanceJobSchema }).strict();

export type ImageHistorySourceBinding = z.infer<typeof imageHistorySourceBindingSchema>;
export type ImageHistoryCandidate = z.infer<typeof imageHistoryCandidateSchema>;
export type ImageHistoryItem = z.infer<typeof imageHistoryItemSchema>;
export type ImageHistoryJob = z.infer<typeof imageHistoryJobSchema>;
export type ImageHistoryScope = ImageHistoryJob["scope"];
export type ImageHistoryScanInput = { scope?: ImageHistoryScope; cursor?: string; upperBound?: string; limit?: number };
export type ImageHistoryBeginApplyInput = {
  requestId: string; actorId: string; planDigest: string; publicUrlBase: string; scope: ImageHistoryScope; sourceBindings: ImageHistorySourceBinding[];
  targetLocationId?: string; retireSource: boolean; upperBound: string;
};
export type ImageHistoryJobInput = { jobId: string; requestId?: never } | { requestId: string; jobId?: never };
export type ImageHistoryItemsInput = { jobId: string; cursor?: string; limit?: number };
export type ImageHistoryClaimInput = { jobId: string; workerId: string; token: string; itemId?: string };
export type ImageHistoryItemInput = { itemId: string };
export type ImageHistoryOwnedInput = { itemId: string; token: string };
export type ImageHistoryBlockInput = ImageHistoryOwnedInput & { errorCode: string };
export type ImageObjectObservationInput = ImageHistoryOwnedInput & {
  requestId: string; kind: "SOURCE" | "TARGET_READBACK" | "WRITE_RECONCILIATION"; sourceSnapshotHash: string;
  locationId: string; key: string; readResult: "FULL" | "DECLARED" | "MISSING" | "FAILED" | "UNVERIFIED";
  byteLength?: string; sha256?: string; mimeType?: string; versionEvidence: "UNVERSIONED" | "VERSIONED" | "UNKNOWN";
  versionId?: string; etag?: string; lastModified?: string; writerEvidence: "NOT_APPLICABLE" | "QUIESCED" | "UNKNOWN";
  originalWriteToken?: string; writerProofSha256?: string;
};
export type ImageHistoryAdoptInput = ImageHistoryOwnedInput & { observationId: string; expectedBusinessSnapshotHash: string };
export type ImageHistoryPrepareCopyInput = ImageHistoryOwnedInput & { expectedSourceObjectId: string; targetLocationId: string };
export type ImageHistoryReconcileInput = ImageHistoryOwnedInput & { expectedTargetObjectId: string };
export type ImageHistoryFinishReconciliationInput = ImageHistoryOwnedInput & { observationId: string; expectedOriginalWriteToken: string };
export type ImageHistorySwitchInput = ImageHistoryOwnedInput & { targetReadbackObservationId: string; expectedActiveObjectId: string; aliasUrls: string[]; readerProtocolRevision: 3 };
