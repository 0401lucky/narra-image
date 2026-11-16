import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { CanvasImportAsset } from "@prisma/client";
import type { z } from "zod";

import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { ImageRepository } from "@/lib/storage/image-repository";
import { getImageAvailability } from "@/lib/storage/image-availability";
import { abandonPreparedImageWrite, prepareManagedImageWrite, putManagedImageObject } from "@/lib/storage/managed-image-storage";
import { canvasUploadDeclarationSchema } from "@/lib/validators";
import { readCanvasBody } from "./body-limit";
import { CANVAS_LIMITS, CanvasContractError, type CanvasAssetDtoV1, type CanvasErrorCode } from "./contracts";
import { parseCanvasInput } from "./http";
import { verifyCanvasImage } from "./image-container";
import { boundedCanvasStorageCall, canvasAssetUrl, canvasMediaInclude, createCanvasStorageAdapter, verifyCanvasStorageCapability, type CanvasStorageAdapter, type CanvasMediaRelation } from "./storage";
import { canvasTransaction, lockCanvasOwner } from "./transactions";

export type CanvasUploadDeclaration = z.output<typeof canvasUploadDeclarationSchema>;
export type CanvasVerifiedUpload = { declaration: CanvasUploadDeclaration; bytes: Buffer };

// Bound in-process body/verification work as well as the DB's fleet-wide PUT
// reservations. This contains counters only, never reusable user data.
const activeRequests = new Map<string, number>();

export async function withCanvasUploadSlot<T>(ownerId: string, operation: () => Promise<T>): Promise<T> {
  const active = activeRequests.get(ownerId) ?? 0;
  if (active >= CANVAS_LIMITS.activeUploadsPerOwner) throw new CanvasContractError("CANVAS_QUOTA_EXCEEDED");
  activeRequests.set(ownerId, active + 1);
  try { return await operation(); }
  finally {
    const remaining = (activeRequests.get(ownerId) ?? 1) - 1;
    if (remaining === 0) activeRequests.delete(ownerId);
    else activeRequests.set(ownerId, remaining);
  }
}

export function serializeCanvasAsset(asset: CanvasImportAsset & CanvasMediaRelation): CanvasAssetDtoV1 {
  return {
    availability: asset.state === "DELETED" ? "cleaned" : asset.state === "READY" ? getImageAvailability(asset) : "unavailable",
    id: asset.id,
    uploadId: asset.uploadId,
    state: asset.state,
    byteLength: asset.byteLength,
    mimeType: asset.mimeType,
    sha256: asset.sha256,
    readyAt: asset.readyAt?.toISOString() ?? null,
    url: asset.state === "READY" ? canvasAssetUrl(asset) : null,
  };
}

export async function readCanvasUpload(request: Request): Promise<CanvasVerifiedUpload> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType) || contentType.length > 256) throw new CanvasContractError("CANVAS_INVALID_INPUT");
  const bytes = await readCanvasBody(request, CANVAS_LIMITS.uploadBodyBytes);
  let form: FormData;
  try {
    // Only the already-counted bounded body reaches the multipart decoder.
    form = await new Response(new Uint8Array(bytes), { headers: { "Content-Type": contentType } }).formData();
  } catch { throw new CanvasContractError("CANVAS_INVALID_INPUT"); }
  const fields = ["uploadId", "byteLength", "mimeType", "sha256", "file"];
  const entries = [...form.entries()];
  if (entries.length !== fields.length || entries.some(([key]) => !fields.includes(key)) || fields.some((key) => form.getAll(key).length !== 1)) throw new CanvasContractError("CANVAS_INVALID_INPUT");
  const size = form.get("byteLength");
  if (typeof size !== "string" || !/^[1-9][0-9]{0,9}$/.test(size)) throw new CanvasContractError("CANVAS_INVALID_INPUT");
  const declaration = parseCanvasInput(canvasUploadDeclarationSchema, {
    uploadId: form.get("uploadId"), byteLength: Number(size), mimeType: form.get("mimeType"), sha256: form.get("sha256"),
  });
  const file = form.get("file");
  if (!file || typeof file === "string" || file.size !== declaration.byteLength || file.type !== declaration.mimeType) throw new CanvasContractError("CANVAS_INVALID_INPUT");
  const original = Buffer.from(await file.arrayBuffer());
  if (original.length !== declaration.byteLength || createHash("sha256").update(original).digest("hex") !== declaration.sha256) throw new CanvasContractError("CANVAS_INVALID_INPUT");
  verifyCanvasImage(original, declaration.mimeType);
  return { declaration, bytes: original };
}

function requireMatchingUpload(asset: CanvasImportAsset, declaration: CanvasUploadDeclaration): void {
  if (asset.sha256 !== declaration.sha256 || asset.byteLength !== declaration.byteLength || asset.mimeType !== declaration.mimeType) throw new CanvasContractError("CANVAS_UPLOAD_CONFLICT");
}

function uploadReplay(asset: CanvasImportAsset & CanvasMediaRelation): { asset: CanvasAssetDtoV1; pending: boolean } {
  if (asset.state === "READY" || asset.state === "UPLOADING") {
    const dto = serializeCanvasAsset(asset);
    if (asset.state === "READY" && !dto.url) throw new CanvasContractError("CANVAS_INPUT_UNAVAILABLE");
    return { asset: dto, pending: asset.state === "UPLOADING" };
  }
  throw new CanvasContractError("CANVAS_UPLOAD_QUARANTINED");
}

async function expireCanvasUpload(ownerId: string, uploadId: string): Promise<void> {
  await db.$executeRaw`UPDATE "CanvasImportAsset" SET state = 'QUARANTINED', "putOutcome" = 'UNKNOWN', "lastStorageErrorCode" = 'CANVAS_UPLOAD_QUARANTINED'
    WHERE "ownerId" = ${ownerId}::text AND "uploadId" = ${uploadId}::uuid AND state = 'UPLOADING' AND "uploadExpiresAt" <= clock_timestamp()`;
}

export async function getCanvasUpload(ownerId: string, uploadId: string): Promise<CanvasAssetDtoV1> {
  await expireCanvasUpload(ownerId, uploadId);
  const asset = await db.canvasImportAsset.findFirst({ where: { ownerId, userId: ownerId, uploadId }, include: canvasMediaInclude });
  if (!asset) throw new CanvasContractError("CANVAS_INPUT_UNAVAILABLE");
  const dto = serializeCanvasAsset(asset);
  if (asset.state === "READY" && !dto.url) throw new CanvasContractError("CANVAS_INPUT_UNAVAILABLE");
  return dto;
}

export async function getCanvasAsset(ownerId: string, id: string): Promise<CanvasAssetDtoV1> {
  const asset = await db.canvasImportAsset.findFirst({ where: { id, ownerId, userId: ownerId }, include: canvasMediaInclude });
  if (!asset) throw new CanvasContractError("CANVAS_INPUT_UNAVAILABLE");
  if (asset.state === "UPLOADING") return getCanvasUpload(ownerId, asset.uploadId);
  const dto = serializeCanvasAsset(asset);
  if (asset.state === "READY" && !dto.url) throw new CanvasContractError("CANVAS_INPUT_UNAVAILABLE");
  return dto;
}

async function quarantineCanvasUpload(asset: CanvasImportAsset, code: CanvasErrorCode, versionId: string | null = null): Promise<void> {
  await canvasTransaction(async (tx) => {
    const changed = await tx.$executeRaw`UPDATE "CanvasImportAsset" SET state = 'QUARANTINED', "putOutcome" = 'UNKNOWN',
      "storageVersionId" = COALESCE("storageVersionId", ${versionId}::text), "lastStorageErrorCode" = ${code}::text
      WHERE id = ${asset.id}::text AND "ownerId" = ${asset.ownerId}::text AND "uploadToken" = ${asset.uploadToken}::uuid AND state IN ('UPLOADING', 'QUARANTINED')`;
    if (changed === 0 && versionId !== null) {
      await tx.$executeRaw`UPDATE "CanvasImportAsset" SET "storageVersionId" = ${versionId}::text,
        "physicalBytesAccounted" = true, "needsReconciliation" = true, "lastStorageErrorCode" = 'CANVAS_STORAGE_CAPABILITY_INVALID'
        WHERE id = ${asset.id}::text AND "ownerId" = ${asset.ownerId}::text AND "uploadToken" = ${asset.uploadToken}::uuid
          AND state IN ('DELETING', 'DELETED') AND "storageVersionId" IS NULL AND "putOutcome" = 'UNKNOWN'`;
    }
  });
}

function versionReceiptFence(versionId: string): string {
  // Invalid oversized receipts still install a non-null fence against v1 GC.
  return versionId.length <= 1024 ? versionId : `unsupported-receipt-sha256:${createHash("sha256").update(versionId).digest("hex")}`;
}

export async function importCanvasAsset(ownerId: string, input: CanvasVerifiedUpload, dependencies: { storage?: () => CanvasStorageAdapter } = {}): Promise<{ asset: CanvasAssetDtoV1; pending: boolean }> {
  const { declaration, bytes } = input;
  // Recheck the service boundary too: callers cannot bypass verified payloads.
  if (bytes.length !== declaration.byteLength || createHash("sha256").update(bytes).digest("hex") !== declaration.sha256) throw new CanvasContractError("CANVAS_INVALID_INPUT");
  verifyCanvasImage(bytes, declaration.mimeType);
  await expireCanvasUpload(ownerId, declaration.uploadId);
  const previous = await db.canvasImportAsset.findFirst({ where: { ownerId, userId: ownerId, uploadId: declaration.uploadId }, include: canvasMediaInclude });
  if (previous) { requireMatchingUpload(previous, declaration); return uploadReplay(previous); }

  const storage = (dependencies.storage ?? createCanvasStorageAdapter)();
  try { return await importWithCanvasStorage(ownerId, input, storage); }
  finally { storage.close?.(); }
}

async function importWithCanvasStorage(ownerId: string, { declaration, bytes }: CanvasVerifiedUpload, storage: CanvasStorageAdapter): Promise<{ asset: CanvasAssetDtoV1; pending: boolean }> {
  await verifyCanvasStorageCapability(storage);
  if (getEnv().IMAGE_STORAGE_MANAGED_ENABLED) return importManagedCanvasAsset(ownerId, { declaration, bytes }, storage);
  const reservation = await canvasTransaction(async (tx) => {
    await lockCanvasOwner(tx, ownerId);
    const existing = await tx.canvasImportAsset.findFirst({ where: { ownerId, uploadId: declaration.uploadId } });
    if (existing) {
      if (existing.userId !== ownerId) throw new CanvasContractError("CANVAS_INPUT_UNAVAILABLE");
      requireMatchingUpload(existing, declaration);
      return { asset: existing, created: false };
    }
    const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[declaration.mimeType];
    if (!extension) throw new CanvasContractError("CANVAS_INVALID_INPUT");
    // The shared INSERT guard atomically checks owner byte/count/active quotas
    // and replaces this expiry placeholder with its own authoritative DB clock.
    const asset = await tx.canvasImportAsset.create({ data: {
      id: randomUUID(), ownerId, userId: ownerId,
      ...declaration,
      storageLocation: storage.location.id,
      storageEndpoint: storage.location.endpoint,
      storageRegion: storage.location.region,
      storageBucket: storage.location.bucket,
      storageKey: `canvas-imports/${randomUUID()}.${extension}`,
      uploadToken: randomUUID(),
      uploadExpiresAt: new Date(0),
    } });
    return { asset, created: true };
  });
  if (!reservation.created) return uploadReplay(reservation.asset);
  const asset = reservation.asset;

  let receipt: { versionId: string | null };
  try {
    receipt = await boundedCanvasStorageCall(
      (signal) => storage.putObject({ key: asset.storageKey, bytes, mimeType: asset.mimeType, sha256: asset.sha256, signal }),
      undefined,
      async (lateReceipt) => {
        if (lateReceipt.versionId !== null) await quarantineCanvasUpload(asset, "CANVAS_STORAGE_CAPABILITY_INVALID", versionReceiptFence(lateReceipt.versionId));
      },
    );
  } catch {
    await quarantineCanvasUpload(asset, "CANVAS_UPLOAD_QUARANTINED");
    throw new CanvasContractError("CANVAS_UPLOAD_QUARANTINED");
  }
  if (receipt.versionId !== null) {
    await quarantineCanvasUpload(asset, "CANVAS_STORAGE_CAPABILITY_INVALID", versionReceiptFence(receipt.versionId));
    throw new CanvasContractError("CANVAS_STORAGE_CAPABILITY_INVALID");
  }

  const ready = await canvasTransaction(async (tx) => {
    const rows = await tx.$queryRaw<CanvasImportAsset[]>`UPDATE "CanvasImportAsset" SET state = 'READY', "putOutcome" = 'CONFIRMED', "lastStorageErrorCode" = NULL
      WHERE id = ${asset.id}::text AND "ownerId" = ${ownerId}::text AND "userId" = ${ownerId}::text
        AND state = 'UPLOADING' AND "uploadToken" = ${asset.uploadToken}::uuid AND "uploadExpiresAt" > clock_timestamp() RETURNING *`;
    return rows[0] ?? null;
  }).catch(async (error: unknown) => {
    if (error instanceof CanvasContractError && error.code === "CANVAS_LEASE_LOST") await quarantineCanvasUpload(asset, "CANVAS_LEASE_LOST");
    throw error;
  });
  if (!ready) {
    await quarantineCanvasUpload(asset, "CANVAS_LEASE_LOST");
    throw new CanvasContractError("CANVAS_LEASE_LOST");
  }
  return uploadReplay(ready);
}

async function importManagedCanvasAsset(ownerId: string, { declaration, bytes }: CanvasVerifiedUpload, storage: CanvasStorageAdapter): Promise<{ asset: CanvasAssetDtoV1; pending: boolean }> {
  const identity = createHash("sha256").update(JSON.stringify([ownerId, declaration.uploadId])).digest("hex");
  const canvasAssetId = `import-${identity}`;
  const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[declaration.mimeType];
  const prepared = await prepareManagedImageWrite({
    ownerId, bytes, purpose: "CANVAS_IMPORT", originId: canvasAssetId,
    intentKey: `canvas-import:${declaration.uploadId}`, key: `canvas-imports/${identity}.${extension}`, leaseSeconds: 120,
  });
  const repository = new ImageRepository();
  const { ticket } = prepared;
  let asset: CanvasImportAsset & CanvasMediaRelation;
  try {
    if (prepared.location.id !== storage.location.id) throw new CanvasContractError("CANVAS_STORAGE_CAPABILITY_INVALID");
    asset = await canvasTransaction(async (tx) => {
      await lockCanvasOwner(tx, ownerId);
      const existing = await tx.canvasImportAsset.findFirst({ where: { ownerId, uploadId: declaration.uploadId }, include: canvasMediaInclude });
      if (existing) {
        requireMatchingUpload(existing, declaration);
        if (existing.userId !== ownerId || existing.mediaAssetId !== ticket.asset.id || existing.storageKey !== ticket.object.key) throw new CanvasContractError("CANVAS_UPLOAD_CONFLICT");
        return existing;
      }
      // Both the global physical gate and this original per-owner logical gate
      // must succeed before the first (and only) physical PUT is permitted.
      return tx.canvasImportAsset.create({ data: {
        id: canvasAssetId, ownerId, userId: ownerId, ...declaration,
        sourceProvider: prepared.location.provider, mediaAssetId: ticket.asset.id,
        storageLocation: prepared.location.id, storageEndpoint: prepared.location.endpoint,
        storageRegion: prepared.location.region, storageBucket: prepared.location.bucket,
        storageKey: ticket.object.key, uploadToken: ticket.object.writeToken, uploadExpiresAt: new Date(0),
      }, include: canvasMediaInclude });
    });
  } catch (error) {
    // No caller can PUT a replayed grant. Definite registry rollback proves
    // absence; uncertain database commit keeps an accounted reconciliation row.
    await abandonPreparedImageWrite(prepared, error instanceof CanvasContractError).catch(() => undefined);
    throw error;
  }
  if (!ticket.writeGranted) return uploadReplay(asset);
  try {
    let receipt: { versionId: string | null };
    try {
      receipt = await boundedCanvasStorageCall((signal) => putManagedImageObject({
        location: prepared.location, key: ticket.object.key, bytes, mimeType: declaration.mimeType, sha256: declaration.sha256, signal,
      }), undefined, async (late) => {
        await repository.finishObject({ objectId: ticket.object.id, writeToken: ticket.object.writeToken, outcome: "UNKNOWN", versionId: late.versionId, errorCode: "IMAGE_STORAGE_UNAVAILABLE" });
        if (late.versionId !== null) await quarantineCanvasUpload(asset, "CANVAS_STORAGE_CAPABILITY_INVALID", versionReceiptFence(late.versionId));
      });
    } catch {
      await repository.finishObject({ objectId: ticket.object.id, writeToken: ticket.object.writeToken, outcome: "UNKNOWN", errorCode: "IMAGE_STORAGE_UNAVAILABLE" }).catch(() => undefined);
      await quarantineCanvasUpload(asset, "CANVAS_UPLOAD_QUARANTINED");
      throw new CanvasContractError("CANVAS_UPLOAD_QUARANTINED");
    }
    if (receipt.versionId !== null) {
      await repository.finishObject({ objectId: ticket.object.id, writeToken: ticket.object.writeToken, outcome: "UNKNOWN", versionId: receipt.versionId, errorCode: "IMAGE_STORAGE_UNAVAILABLE" });
      await quarantineCanvasUpload(asset, "CANVAS_STORAGE_CAPABILITY_INVALID", versionReceiptFence(receipt.versionId));
      throw new CanvasContractError("CANVAS_STORAGE_CAPABILITY_INVALID");
    }
    const confirmed = await repository.finishObject({ objectId: ticket.object.id, writeToken: ticket.object.writeToken, outcome: "CONFIRMED" });
    if (!confirmed.accepted || confirmed.asset.state !== "AVAILABLE") {
      await quarantineCanvasUpload(asset, "CANVAS_LEASE_LOST");
      throw new CanvasContractError("CANVAS_LEASE_LOST");
    }
    const ready = await canvasTransaction(async (tx) => {
      const count = await tx.$executeRaw`UPDATE "CanvasImportAsset" SET state = 'READY', "putOutcome" = 'CONFIRMED', "lastStorageErrorCode" = NULL
        WHERE id = ${asset.id}::text AND "ownerId" = ${ownerId}::text AND "userId" = ${ownerId}::text
          AND state = 'UPLOADING' AND "uploadToken" = ${asset.uploadToken}::uuid AND "uploadExpiresAt" > clock_timestamp()`;
      return count ? tx.canvasImportAsset.findFirst({ where: { id: asset.id, ownerId }, include: canvasMediaInclude }) : null;
    });
    if (!ready) {
      await quarantineCanvasUpload(asset, "CANVAS_LEASE_LOST");
      throw new CanvasContractError("CANVAS_LEASE_LOST");
    }
    return uploadReplay(ready);
  } finally {
    await repository.closeReservation({ reservationId: prepared.reservation.id, token: prepared.reservation.token }).catch(() => undefined);
  }
}
