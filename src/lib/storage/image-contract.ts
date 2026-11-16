import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

import { canvasStorageLocationMaterialV1 } from "@/lib/canvas/contracts";

import fixture from "../../../contracts/media/v1/contract.json";

if (fixture.contract !== "narra.image.storage" || fixture.version !== 1) {
  throw new Error("Unsupported image storage contract");
}

export const IMAGE_CONTRACT_VERSION = 1 as const;
export const DEFAULT_IMAGE_QUOTA_BYTES = BigInt(fixture.limits.defaultQuotaBytes);
export const MAX_IMAGE_BYTES = fixture.limits.imageBytes;
export const MAX_IMAGE_OUTPUT_COUNT = fixture.limits.outputCount;
export const IMAGE_DEFAULT_LEASE_SECONDS = fixture.limits.defaultLeaseSeconds;
export const IMAGE_MAXIMUM_LEASE_SECONDS = fixture.limits.maximumLeaseSeconds;
export const IMAGE_MIME_TYPES = Object.freeze(fixture.mimeTypes);
export type ImageErrorCode = keyof typeof fixture.errors;
export type ImageProvider = "S3" | "LOCAL";
export type ImagePurpose = "GENERATED" | "REFERENCE" | "CANVAS_IMPORT";
export type ImageReferenceKind = "JOB_INPUT" | "CANVAS_SAVED" | "SHOWCASE" | "SITE_COVER";

// JavaScript's $ can match before a trailing line terminator. Use an absolute
// end assertion for identifiers and decimal strings shared with Go/PostgreSQL.
const canonicalUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\s\S])/;
const digestPattern = /^[0-9a-f]{64}(?![\s\S])/;
const decimalBytesPattern = /^(0|[1-9][0-9]*)(?![\s\S])/;
const positiveBytesPattern = /^[1-9][0-9]*(?![\s\S])/;

export class ImageStorageError extends Error {
  readonly code: ImageErrorCode;
  readonly status: number;

  constructor(code: ImageErrorCode, options: { cause?: unknown } = {}) {
    super(fixture.errors[code].message, options);
    this.name = "ImageStorageError";
    this.code = code;
    this.status = fixture.errors[code].status;
  }
}

export function isImageErrorCode(value: unknown): value is ImageErrorCode {
  return typeof value === "string" && Object.hasOwn(fixture.errors, value);
}

export function imageOutputBudget(count: number): bigint {
  if (!Number.isInteger(count) || count < 1 || count > MAX_IMAGE_OUTPUT_COUNT) {
    throw new ImageStorageError("IMAGE_INVALID_INPUT");
  }
  return BigInt(count) * BigInt(MAX_IMAGE_BYTES);
}

export function imageByteLength(value: number | bigint | string): string {
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new ImageStorageError("IMAGE_INVALID_INPUT");
  const encoded = String(value);
  if (encoded.length > 19 || !positiveBytesPattern.test(encoded)) throw new ImageStorageError("IMAGE_INVALID_INPUT");
  const size = BigInt(encoded);
  if (size > BigInt(MAX_IMAGE_BYTES)) throw new ImageStorageError("IMAGE_INVALID_INPUT");
  return encoded;
}

export const imageIdSchema = z.uuid().length(36).regex(canonicalUuidPattern);
const uuid = imageIdSchema;
const timestamp = z.iso.datetime({ offset: true });
const byteString = z.string().max(19).regex(decimalBytesPattern)
  .refine((value) => value.length <= 19 && decimalBytesPattern.test(value) && BigInt(value) <= BigInt("9223372036854775807"));
export const imageByteStringSchema = byteString;
const nullableText = z.string().nullable();

export const imageLocationSchema = z.object({
  id: z.string(),
  provider: z.enum(["S3", "LOCAL"]),
  endpoint: nullableText,
  region: nullableText,
  bucket: nullableText,
  volumeId: nullableText,
  publicBaseUrl: nullableText,
  physicalNamespace: z.string(),
  createdAt: timestamp,
}).strict();

export const imageAssetSchema = z.object({
  id: uuid,
  ownerId: z.string(),
  purpose: z.enum(["GENERATED", "REFERENCE", "CANVAS_IMPORT"]),
  originId: nullableText,
  publicToken: z.string().regex(digestPattern),
  byteLength: byteString,
  mimeType: z.string(),
  sha256: z.string().regex(digestPattern),
  state: z.enum(["PENDING", "AVAILABLE", "QUARANTINED", "DELETING", "DELETED"]),
  activeObjectId: uuid.nullable(),
  detachedAt: timestamp.nullable(),
  deletedAt: timestamp.nullable(),
  deleteReason: nullableText,
  createdAt: timestamp,
  updatedAt: timestamp,
}).strict();

const imageObjectBaseSchema = z.object({
  id: uuid,
  assetId: uuid,
  locationId: z.string(),
  physicalNamespace: z.string(),
  key: z.string(),
  byteLength: byteString,
  mimeType: z.string(),
  sha256: z.string().regex(digestPattern),
  state: z.enum(["WRITING", "READY", "UNKNOWN", "DELETING", "DELETED"]),
  versionId: nullableText,
  accounted: z.boolean(),
  needsReconciliation: z.boolean(),
  deleteToken: uuid.nullable(),
  deleteExpiresAt: timestamp.nullable(),
  deleteOutcome: z.enum(["NOT_STARTED", "DELETED", "MISSING", "FAILED", "UNKNOWN"]),
  deleteAttempts: z.number().int().nonnegative(),
  nextDeleteAt: timestamp.nullable(),
  deletedAt: timestamp.nullable(),
  lastErrorCode: nullableText,
  createdAt: timestamp,
  updatedAt: timestamp,
}).strict();

export const imageWriteObjectSchema = imageObjectBaseSchema.extend({
  provenance: z.literal("WRITE"),
  reservationId: uuid,
  slot: z.number().int().min(0).max(3),
  writeToken: uuid,
  writeExpiresAt: timestamp,
  putOutcome: z.enum(["NOT_STARTED", "CONFIRMED", "UNKNOWN"]),
  sourceObservationId: z.null(),
  reconciliationObservationId: uuid.nullable(),
}).refine((object) => object.byteLength.length <= 19 && positiveBytesPattern.test(object.byteLength) && BigInt(object.byteLength) <= BigInt(MAX_IMAGE_BYTES));
const imageObservedObjectSchema = imageObjectBaseSchema.extend({
  provenance: z.literal("OBSERVED"),
  reservationId: z.null(),
  slot: z.null(),
  writeToken: z.null(),
  writeExpiresAt: z.null(),
  putOutcome: z.enum(["NOT_APPLICABLE", "UNKNOWN"]),
  sourceObservationId: uuid,
  reconciliationObservationId: z.null(),
});
export const imageObjectSchema = z.discriminatedUnion("provenance", [imageWriteObjectSchema, imageObservedObjectSchema])
  .refine((object) => object.byteLength.length <= 19 && positiveBytesPattern.test(object.byteLength) && (object.state !== "READY" || (object.accounted && !object.needsReconciliation
    && (object.versionId === null || (object.provenance === "WRITE" && object.putOutcome === "CONFIRMED"))
    && BigInt(object.byteLength) <= BigInt(MAX_IMAGE_BYTES) && (object.putOutcome === "CONFIRMED"
      || object.putOutcome === "NOT_APPLICABLE" || object.reconciliationObservationId !== null))));

export const imageReservationSchema = z.object({
  id: uuid,
  token: uuid,
  ownerId: z.string(),
  intentKey: z.string(),
  kind: z.enum(["OUTPUT", "INPUT", "COPY"]),
  slotBytes: z.array(byteString).min(1).max(MAX_IMAGE_OUTPUT_COUNT),
  remainingBytes: byteString,
  state: z.enum(["ACTIVE", "CLOSED"]),
  outputJobId: nullableText,
  workerId: nullableText,
  leaseExpiresAt: timestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
}).strict();

export const imagePolicySchema = z.object({
  scope: z.literal("images"),
  version: z.number().int().positive(),
  limitBytes: byteString,
  enabled: z.boolean(),
  quotaCleanupEnabled: z.boolean(),
  scheduleEnabled: z.boolean(),
  retentionDays: z.number().int().positive(),
  intervalSeconds: z.number().int().positive(),
  nextRunAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
}).strict();

export const managedImageSchema = z.object({
  asset: imageAssetSchema,
  object: imageObjectSchema.nullable(),
  location: imageLocationSchema.nullable(),
}).strict().refine(({ asset, object, location }) => asset.state === "AVAILABLE"
  ? Boolean(object && location && object.state === "READY" && object.assetId === asset.id && object.id === asset.activeObjectId
    && object.locationId === location.id && object.byteLength === asset.byteLength && object.sha256 === asset.sha256 && object.mimeType === asset.mimeType)
  : object === null && location === null);
export const imageWriteTicketSchema = z.object({ asset: imageAssetSchema, object: imageWriteObjectSchema, writeGranted: z.boolean() }).strict()
  .refine(({ asset, object, writeGranted }) => asset.id === object.assetId && asset.byteLength === object.byteLength && asset.sha256 === object.sha256
    && (!writeGranted || (object.state === "WRITING" && object.putOutcome === "NOT_STARTED" && object.accounted)));
export const imageObjectReceiptSchema = z.object({ asset: imageAssetSchema, object: imageObjectSchema, accepted: z.boolean() }).strict()
  .refine(({ asset, object }) => asset.id === object.assetId && asset.byteLength === object.byteLength && asset.sha256 === object.sha256);
export const imageUsageSchema = z.object({
  policy: imagePolicySchema,
  usedBytes: byteString,
  reservedBytes: byteString,
  assetCount: byteString,
  objectCount: byteString,
}).strict();

export type ImageLocation = z.infer<typeof imageLocationSchema>;
export type ImageAssetRecord = z.infer<typeof imageAssetSchema>;
export type ImageObjectRecord = z.infer<typeof imageObjectSchema>;
export type ImageReservation = z.infer<typeof imageReservationSchema>;
export type ImagePolicy = z.infer<typeof imagePolicySchema>;
export type ManagedImage = z.infer<typeof managedImageSchema>;
export type ImageWriteTicket = z.infer<typeof imageWriteTicketSchema>;
export type ImageObjectReceipt = z.infer<typeof imageObjectReceiptSchema>;
export type ImageUsage = z.infer<typeof imageUsageSchema>;
export type ImageLocationInput = Omit<ImageLocation, "physicalNamespace" | "createdAt">;
export type ImageReserveOutputsInput = { ownerId: string; intentKey: string; count: number; leaseSeconds?: number };
export type ImageReserveInput = { ownerId: string; intentKey: string; byteLength: number | bigint | string; leaseSeconds?: number; kind?: "INPUT" | "COPY" };
export type ImageBindReservationInput = { reservationId: string; token: string; ownerId: string; jobId: string };
export type ImageAcquireForJobInput = { jobId: string; workerId: string; leaseSeconds?: number };
export type ImageCloseReservationInput = { reservationId: string; token: string };
export type ImageBeginObjectInput = {
  reservationId: string; token: string; slot: number; locationId: string; key: string;
  byteLength: number | bigint | string; mimeType: string; sha256: string; purpose: ImagePurpose; originId?: string; assetId?: string;
};
export type ImageFinishObjectInput = { objectId: string; writeToken: string; outcome: "CONFIRMED" | "UNKNOWN" | "NOT_WRITTEN"; versionId?: string | null; errorCode?: ImageErrorCode | null };
export type ImageReferenceInput = { ownerId: string; kind: ImageReferenceKind; referenceKey: string; assetIds: string[] };
export type ImageActivateObjectInput = { assetId: string; objectId: string; expectedObjectId: string | null };

export function imageLocalLocation(volumeId: string): ImageLocationInput {
  if (!canonicalUuidPattern.test(volumeId)) {
    throw new ImageStorageError("IMAGE_LOCATION_CONFLICT");
  }
  return { id: `local-v1:${volumeId}`, provider: "LOCAL", endpoint: null, region: null, bucket: null, volumeId, publicBaseUrl: null };
}

export function imageS3Location(input: { endpoint: string; region: string; bucket: string; publicBaseUrl?: string | null }): ImageLocationInput {
  let material: string;
  try { material = canvasStorageLocationMaterialV1(input); }
  catch { throw new ImageStorageError("IMAGE_LOCATION_CONFLICT"); }
  const endpoint = new URL(input.endpoint.trim());
  const region = input.region.trim();
  const bucket = input.bucket.trim();
  let publicBaseUrl: string | null = null;
  if (input.publicBaseUrl) {
    try {
      const base = new URL(input.publicBaseUrl);
      if (!["https:", "http:"].includes(base.protocol) || /^[a-z]+:\/\/[^/]*@/i.test(input.publicBaseUrl.trim()) || base.search || base.hash) throw new Error("invalid base");
      publicBaseUrl = base.toString().replace(/\/+$/, "");
    } catch { throw new ImageStorageError("IMAGE_LOCATION_CONFLICT"); }
  }
  const origin = endpoint.origin;
  const digest = createHash("sha256").update(material, "utf8").digest("hex");
  return { id: `s3-v1:${digest}`, provider: "S3", endpoint: origin, region, bucket, volumeId: null, publicBaseUrl };
}

export function imagePublicUrl(appUrl: string, publicToken: string): string {
  if (!digestPattern.test(publicToken)) throw new ImageStorageError("IMAGE_INVALID_INPUT");
  try {
    const base = new URL(appUrl);
    if (!["http:", "https:"].includes(base.protocol) || /^[a-z]+:\/\/[^/]*@/i.test(appUrl.trim()) || base.search || base.hash) throw new Error("invalid base");
    return `${base.toString().replace(/\/+$/, "")}/media/images/${publicToken}`;
  } catch { throw new ImageStorageError("IMAGE_INVALID_INPUT"); }
}

export function imageDatabaseError(error: unknown): ImageStorageError | null {
  if (error instanceof ImageStorageError) return error;
  if (!error || typeof error !== "object") return null;
  const root = error as Record<string, unknown>;
  const meta = root.meta && typeof root.meta === "object" ? root.meta as Record<string, unknown> : null;
  const adapter = meta?.driverAdapterError && typeof meta.driverAdapterError === "object" ? meta.driverAdapterError as Record<string, unknown> : null;
  const cause = adapter?.cause ?? (root.name === "DriverAdapterError" ? root.cause : null);
  const driver = cause && typeof cause === "object" ? cause as Record<string, unknown> : null;
  const code = driver?.originalCode ?? (root.code === "P2010" ? meta?.code : root.code);
  const message = driver?.originalMessage ?? (root.code === "P2010" ? meta?.message : root.message);
  return (code === "23514" || code === "P0001") && isImageErrorCode(message) ? new ImageStorageError(message) : null;
}
