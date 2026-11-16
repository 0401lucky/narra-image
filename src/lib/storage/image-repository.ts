import "server-only";

import { Prisma } from "@prisma/client";
import { z } from "zod";

import {
  IMAGE_DEFAULT_LEASE_SECONDS, MAX_IMAGE_BYTES, ImageStorageError, imageByteLength, imageDatabaseError, imageIdSchema,
  imageLocationSchema, imageObjectReceiptSchema, imageOutputBudget, imageReservationSchema, imageUsageSchema,
  imageWriteTicketSchema, managedImageSchema,
  type ImageAcquireForJobInput, type ImageActivateObjectInput, type ImageBeginObjectInput,
  type ImageBindReservationInput, type ImageCloseReservationInput, type ImageFinishObjectInput,
  type ImageLocationInput, type ImageReferenceInput, type ImageReserveInput, type ImageReserveOutputsInput,
} from "./image-contract";
import { probeImageSchema } from "./image-schema";
import {
  imageCleanupPreviewSchema, imageDeleteClaimSchema, imageDeleteReceiptSchema, imageMaintenanceJobSchema,
  imageReadLeaseSchema, imageReservationCleanupSchema, imageStorageOverviewSchema,
  type ImageClaimMaintenanceInput, type ImageFinishMaintenanceInput, type ImageMaintenanceLeaseInput,
  type ImagePrepareCopyInput, type ImageReadInput, type ImageReplicaVerificationInput, type ImageSourceRetirementInput,
} from "./image-maintenance-contract";
import type {
  ImageCancelMaintenanceInput, ImageConfirmCleanupInput, ImageMaintenanceJobInput,
  ImagePreviewCleanupInput, ImageQuotaCleanupInput, ImageUpdatePolicyInput,
} from "./image-maintenance-types";
import { imagePolicySchema } from "./image-contract";
import * as history from "./image-history-contract";

export type ImageQueryer = Pick<Prisma.TransactionClient, "$queryRaw">;

/** SQL owns locks, the database clock, quota transitions and durable fencing. */
export class ImageRepository {
  constructor(private readonly queryer?: ImageQueryer) {}

  async verifySchema(): Promise<void> {
    const report = await probeImageSchema(async (sql) => {
      const database = this.queryer ?? (await import("@/lib/db")).db;
      // The SQL is the bundled read-only pg_catalog query, never caller input.
      const rows = await database.$queryRaw<Array<{ result: unknown }>>(Prisma.raw(sql));
      if (rows.length !== 1) throw new Error("Image schema catalogue unavailable");
      return rows[0].result;
    });
    if (!report.ready) throw new ImageStorageError("IMAGE_STORAGE_UNAVAILABLE", { cause: report });
  }

  private async query<T>(query: Prisma.Sql, schema: z.ZodType<T>): Promise<T> {
    try {
      const database = this.queryer ?? (await import("@/lib/db")).db;
      const rows = await database.$queryRaw<Array<{ result: unknown }>>(query);
      if (rows.length !== 1) throw new ImageStorageError("IMAGE_INTERNAL_ERROR");
      const parsed = schema.safeParse(rows[0].result);
      if (!parsed.success) throw new ImageStorageError("IMAGE_INTERNAL_ERROR", { cause: parsed.error });
      return parsed.data;
    } catch (error) {
      throw imageDatabaseError(error) ?? new ImageStorageError("IMAGE_INTERNAL_ERROR", { cause: error });
    }
  }

  registerLocation(input: ImageLocationInput) {
    return this.query(Prisma.sql`SELECT image_register_location(${JSON.stringify(input)}::jsonb) AS result`, imageLocationSchema);
  }

  reserveOutputs(input: ImageReserveOutputsInput) {
    imageOutputBudget(input.count);
    const payload = {
      ownerId: input.ownerId, intentKey: input.intentKey, kind: "OUTPUT",
      slotBytes: Array.from({ length: input.count }, () => String(MAX_IMAGE_BYTES)),
      leaseSeconds: input.leaseSeconds ?? IMAGE_DEFAULT_LEASE_SECONDS,
    };
    return this.query(Prisma.sql`SELECT image_reserve_write(${JSON.stringify(payload)}::jsonb) AS result`, imageReservationSchema);
  }

  reserveInput(input: ImageReserveInput) {
    const payload = {
      ownerId: input.ownerId, intentKey: input.intentKey, kind: input.kind ?? "INPUT",
      slotBytes: [imageByteLength(input.byteLength)], leaseSeconds: input.leaseSeconds ?? IMAGE_DEFAULT_LEASE_SECONDS,
    };
    return this.query(Prisma.sql`SELECT image_reserve_write(${JSON.stringify(payload)}::jsonb) AS result`, imageReservationSchema);
  }

  bindReservation(input: ImageBindReservationInput) {
    return this.query(Prisma.sql`SELECT image_bind_reservation(${JSON.stringify(input)}::jsonb) AS result`, imageReservationSchema);
  }

  acquireForJob(input: ImageAcquireForJobInput) {
    return this.query(Prisma.sql`SELECT image_acquire_for_job(${JSON.stringify(input)}::jsonb) AS result`, imageReservationSchema);
  }

  getReservationByJob(jobId: string) {
    return this.query(Prisma.sql`SELECT image_get_reservation_by_job(${jobId}::text) AS result`, imageReservationSchema.nullable());
  }

  closeReservation(input: ImageCloseReservationInput) {
    return this.query(Prisma.sql`SELECT image_close_reservation(${JSON.stringify(input)}::jsonb) AS result`, z.boolean());
  }

  beginObject(input: ImageBeginObjectInput) {
    const payload = { ...input, byteLength: imageByteLength(input.byteLength) };
    return this.query(Prisma.sql`SELECT image_begin_object(${JSON.stringify(payload)}::jsonb) AS result`, imageWriteTicketSchema);
  }

  finishObject(input: ImageFinishObjectInput) {
    return this.query(Prisma.sql`SELECT image_finish_object(${JSON.stringify(input)}::jsonb) AS result`, imageObjectReceiptSchema);
  }

  getByToken(publicToken: string) {
    return this.query(Prisma.sql`SELECT image_get_by_token(${publicToken}::text) AS result`, managedImageSchema.nullable());
  }

  getByAssetId(assetId: string, ownerId?: string) {
    if (!imageIdSchema.safeParse(assetId).success) throw new ImageStorageError("IMAGE_INVALID_INPUT");
    return this.query(Prisma.sql`SELECT image_get_asset(${assetId}::uuid,${ownerId ?? null}::text) AS result`, managedImageSchema.nullable());
  }

  resolveUrl(url: string, ownerId?: string) {
    return this.query(Prisma.sql`SELECT image_resolve_url(${url}::text,${ownerId ?? null}::text) AS result`, managedImageSchema.nullable());
  }

  async registerAlias(input: { assetId: string; url: string }): Promise<void> {
    await this.query(Prisma.sql`SELECT image_register_alias(${JSON.stringify(input)}::jsonb) AS result`, z.boolean());
  }

  async replaceReferences(input: ImageReferenceInput): Promise<void> {
    await this.query(Prisma.sql`SELECT image_replace_references(${JSON.stringify(input)}::jsonb) AS result`, z.boolean());
  }

  activateObject(input: ImageActivateObjectInput) {
    return this.query(Prisma.sql`SELECT image_activate_object(${JSON.stringify(input)}::jsonb) AS result`, z.boolean());
  }

  getUsage() {
    return this.query(Prisma.sql`SELECT image_get_usage() AS result`, imageUsageSchema);
  }

  getStorageOverview() {
    return this.query(Prisma.sql`SELECT image_get_storage_overview() AS result`, imageStorageOverviewSchema);
  }
  updateStoragePolicy(input: ImageUpdatePolicyInput) {
    return this.query(Prisma.sql`SELECT image_update_storage_policy(${JSON.stringify(input)}::jsonb) AS result`, imagePolicySchema);
  }
  previewCleanup(input: ImagePreviewCleanupInput) {
    return this.query(Prisma.sql`SELECT image_preview_cleanup(${JSON.stringify(input)}::jsonb) AS result`, imageCleanupPreviewSchema);
  }
  confirmCleanup(input: ImageConfirmCleanupInput) {
    return this.query(Prisma.sql`SELECT image_confirm_cleanup(${JSON.stringify(input)}::jsonb) AS result`, imageMaintenanceJobSchema);
  }
  getMaintenanceJob(input: ImageMaintenanceJobInput) {
    return this.query(Prisma.sql`SELECT image_get_maintenance_job(${JSON.stringify(input)}::jsonb) AS result`, imageMaintenanceJobSchema.nullable());
  }
  cancelMaintenance(input: ImageCancelMaintenanceInput) {
    return this.query(Prisma.sql`SELECT image_cancel_maintenance(${JSON.stringify(input)}::jsonb) AS result`, imageMaintenanceJobSchema);
  }
  requestQuotaCleanup(input: ImageQuotaCleanupInput) {
    return this.query(Prisma.sql`SELECT image_request_quota_cleanup(${JSON.stringify(input)}::jsonb) AS result`, imageMaintenanceJobSchema.nullable());
  }
  enqueueDueCleanup() {
    return this.query(Prisma.sql`SELECT image_enqueue_due_cleanup() AS result`, imageMaintenanceJobSchema.nullable());
  }
  acquireMaintenanceLease(input: ImageMaintenanceLeaseInput) {
    return this.query(Prisma.sql`SELECT image_acquire_maintenance_lease(${JSON.stringify(input)}::jsonb) AS result`, z.boolean());
  }
  releaseMaintenanceLease(input: ImageMaintenanceLeaseInput) {
    return this.query(Prisma.sql`SELECT image_release_maintenance_lease(${JSON.stringify(input)}::jsonb) AS result`, z.boolean());
  }
  listMaintenanceLocations() {
    return this.query(Prisma.sql`SELECT image_list_maintenance_locations() AS result`, z.array(imageLocationSchema));
  }
  claimMaintenance(input: ImageClaimMaintenanceInput) {
    return this.query(Prisma.sql`SELECT image_claim_maintenance(${JSON.stringify(input)}::jsonb) AS result`, z.array(imageDeleteClaimSchema));
  }
  finishMaintenanceObject(input: ImageFinishMaintenanceInput) {
    return this.query(Prisma.sql`SELECT image_finish_maintenance_object(${JSON.stringify(input)}::jsonb) AS result`, imageDeleteReceiptSchema);
  }
  closeExpiredReservations(input: { limit?: number } = {}) {
    return this.query(Prisma.sql`SELECT image_close_expired_reservations(${JSON.stringify(input)}::jsonb) AS result`, imageReservationCleanupSchema);
  }
  beginRead(input: ImageReadInput) {
    return this.query(Prisma.sql`SELECT image_begin_read(${JSON.stringify(input)}::jsonb) AS result`, imageReadLeaseSchema.nullable());
  }
  prepareCopy(input: ImagePrepareCopyInput) {
    return this.query(Prisma.sql`SELECT image_prepare_copy(${JSON.stringify(input)}::jsonb) AS result`, imageReservationSchema);
  }
  recordReplicaVerification(input: ImageReplicaVerificationInput) {
    return this.query(Prisma.sql`SELECT image_record_replica_verification(${JSON.stringify(input)}::jsonb) AS result`, z.object({ id: imageIdSchema }).strict());
  }
  requestSourceRetirement(input: ImageSourceRetirementInput) {
    return this.query(Prisma.sql`SELECT image_request_source_retirement(${JSON.stringify(input)}::jsonb) AS result`, imageMaintenanceJobSchema);
  }

  scanImageHistory(input: history.ImageHistoryScanInput = {}) {
    return this.query(Prisma.sql`SELECT image_scan_history(${JSON.stringify(input)}::jsonb) AS result`, history.imageHistoryScanPageSchema);
  }
  beginImageHistoryApply(input: history.ImageHistoryBeginApplyInput) {
    return this.query(Prisma.sql`SELECT image_begin_history_apply(${JSON.stringify(input)}::jsonb) AS result`, history.imageHistoryJobSchema);
  }
  getImageHistoryJob(input: history.ImageHistoryJobInput) {
    return this.query(Prisma.sql`SELECT image_get_history_job(${JSON.stringify(input)}::jsonb) AS result`, history.imageHistoryJobSchema.nullable());
  }
  listImageHistoryItems(input: history.ImageHistoryItemsInput) {
    return this.query(Prisma.sql`SELECT image_list_history_items(${JSON.stringify(input)}::jsonb) AS result`, history.imageHistoryItemsPageSchema);
  }
  claimImageHistoryItem(input: history.ImageHistoryClaimInput) {
    return this.query(Prisma.sql`SELECT image_claim_history_item(${JSON.stringify(input)}::jsonb) AS result`, history.imageHistoryItemSchema.nullable());
  }
  getImageHistoryItem(input: history.ImageHistoryItemInput) {
    return this.query(Prisma.sql`SELECT image_get_history_item(${JSON.stringify(input)}::jsonb) AS result`, history.imageHistoryItemSchema.nullable());
  }
  getImageHistoryAliases(input: { assetId: string }) {
    return this.query(Prisma.sql`SELECT image_get_history_aliases(${JSON.stringify(input)}::jsonb) AS result`, z.array(z.string()).max(history.IMAGE_HISTORY_PAGE_LIMIT));
  }
  blockImageHistoryItem(input: history.ImageHistoryBlockInput) {
    return this.query(Prisma.sql`SELECT image_block_history_item(${JSON.stringify(input)}::jsonb) AS result`, history.imageHistoryItemSchema);
  }
  recordImageObjectObservation(input: history.ImageObjectObservationInput) {
    return this.query(Prisma.sql`SELECT image_record_object_observation(${JSON.stringify(input)}::jsonb) AS result`, history.imageObservationResultSchema);
  }
  adoptObservedImageObject(input: history.ImageHistoryAdoptInput) {
    return this.query(Prisma.sql`SELECT image_adopt_observed_object(${JSON.stringify(input)}::jsonb) AS result`, history.imageHistoryAdoptResultSchema);
  }
  prepareImageMigrationCopy(input: history.ImageHistoryPrepareCopyInput) {
    return this.query(Prisma.sql`SELECT image_prepare_migration_copy(${JSON.stringify(input)}::jsonb) AS result`, history.imageHistoryCopyResultSchema);
  }
  prepareImageCopyReconciliation(input: history.ImageHistoryReconcileInput) {
    return this.query(Prisma.sql`SELECT image_prepare_copy_reconciliation(${JSON.stringify(input)}::jsonb) AS result`, history.imageHistoryReconcileReadSchema);
  }
  finishImageCopyReconciliation(input: history.ImageHistoryFinishReconciliationInput) {
    return this.query(Prisma.sql`SELECT image_finish_copy_reconciliation(${JSON.stringify(input)}::jsonb) AS result`, history.imageHistoryReconcileResultSchema);
  }
  commitImageMigrationSwitch(input: history.ImageHistorySwitchInput) {
    return this.query(Prisma.sql`SELECT image_commit_migration_switch(${JSON.stringify(input)}::jsonb) AS result`, history.imageHistorySwitchResultSchema);
  }
  requestImageHistorySourceRetirement(input: history.ImageHistoryOwnedInput) {
    return this.query(Prisma.sql`SELECT image_request_history_source_retirement(${JSON.stringify(input)}::jsonb) AS result`, history.imageHistoryRetireResultSchema);
  }
}
