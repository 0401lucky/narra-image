import "server-only";

import { createHash } from "node:crypto";
import { Prisma, type Canvas } from "@prisma/client";

import { db } from "@/lib/db";
import { canvasSceneSchema } from "@/lib/validators";
import { CANVAS_LIMITS, CanvasContractError, canonicalCanvasJson, type CanvasDocumentDtoV1, type CanvasMetadataDtoV1, type CanvasMetadataPageDtoV1, type CanvasSaveReceiptDtoV1, type CanvasSceneV1 } from "./contracts";
import { encodeCanvasCursor, type CanvasKeyset } from "./cursors";
import { canvasAssetUrl } from "./storage";
import { canvasTransaction, lockCanvasOwner, type CanvasTransaction } from "./transactions";

type CanvasMetadataRecord = Pick<Canvas, "id" | "title" | "revision" | "lastSavedAt" | "createdAt" | "updatedAt">;
export const canvasMetadataSelect = { id: true, title: true, revision: true, lastSavedAt: true, createdAt: true, updatedAt: true } satisfies Prisma.CanvasSelect;

export function serializeCanvasMetadata(canvas: CanvasMetadataRecord): CanvasMetadataDtoV1 {
  return {
    id: canvas.id,
    title: canvas.title,
    revision: canvas.revision,
    lastSavedAt: canvas.lastSavedAt?.toISOString() ?? null,
    hasSavedSnapshot: canvas.lastSavedAt !== null,
    createdAt: canvas.createdAt.toISOString(),
    updatedAt: canvas.updatedAt.toISOString(),
  };
}

export function readStoredCanvasScene(scene: Prisma.JsonValue | null): CanvasSceneV1 | null {
  if (scene === null) return null;
  const parsed = canvasSceneSchema.safeParse(scene);
  if (!parsed.success) throw new CanvasContractError("CANVAS_VERSION_UNSUPPORTED");
  return parsed.data;
}

export async function lockOwnedCanvas(tx: CanvasTransaction, ownerId: string, id: string): Promise<Canvas> {
  const rows = await tx.$queryRaw<Canvas[]>`SELECT * FROM "Canvas" WHERE id = ${id}::uuid AND "ownerId" = ${ownerId}::text FOR UPDATE`;
  const row = rows[0];
  if (!row || row.userId !== ownerId) throw new CanvasContractError("CANVAS_NOT_FOUND");
  if (row.deletedAt !== null) throw new CanvasContractError("CANVAS_DELETED");
  return row;
}

export async function createCanvas(ownerId: string, input: { id: string; title: string }): Promise<{ canvas: CanvasMetadataDtoV1 }> {
  return canvasTransaction(async (tx) => {
    await lockCanvasOwner(tx, ownerId);
    const existing = await tx.canvas.findUnique({ where: { id: input.id } });
    if (existing) {
      if (existing.ownerId !== ownerId || existing.userId !== ownerId) throw new CanvasContractError("CANVAS_NOT_FOUND");
      if (existing.deletedAt !== null) throw new CanvasContractError("CANVAS_DELETED");
      return { canvas: serializeCanvasMetadata(existing) };
    }
    if (await tx.canvas.count({ where: { ownerId, deletedAt: null } }) >= CANVAS_LIMITS.liveCanvasesPerOwner) throw new CanvasContractError("CANVAS_QUOTA_EXCEEDED");
    // A foreign principal can race the same UUID; conflict never overwrites its shell.
    await tx.$executeRaw`INSERT INTO "Canvas" (id, "ownerId", "userId", title) VALUES (${input.id}::uuid, ${ownerId}, ${ownerId}, ${input.title}) ON CONFLICT (id) DO NOTHING`;
    const canvas = await lockOwnedCanvas(tx, ownerId, input.id);
    return { canvas: serializeCanvasMetadata(canvas) };
  });
}

export async function listCanvases(ownerId: string, page: { limit: number; key: CanvasKeyset | null }): Promise<CanvasMetadataPageDtoV1> {
  const canvases = await db.canvas.findMany({
    where: {
      ownerId, userId: ownerId, deletedAt: null,
      ...(page.key ? { OR: [{ createdAt: { lt: page.key.at } }, { createdAt: page.key.at, id: { lt: page.key.id } }] } : {}),
    },
    select: canvasMetadataSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: page.limit + 1,
  });
  const visible = canvases.slice(0, page.limit);
  const last = visible.at(-1);
  return {
    canvases: visible.map(serializeCanvasMetadata),
    nextCursor: canvases.length > page.limit && last ? encodeCanvasCursor({ ownerId, scope: "canvas", parentId: null }, { at: last.createdAt, id: last.id }) : null,
  };
}

export async function getCanvas(ownerId: string, id: string): Promise<CanvasDocumentDtoV1> {
  const canvas = await db.canvas.findFirst({ where: { id, ownerId, userId: ownerId } });
  if (!canvas) throw new CanvasContractError("CANVAS_NOT_FOUND");
  if (canvas.deletedAt !== null) throw new CanvasContractError("CANVAS_DELETED");
  return { canvas: serializeCanvasMetadata(canvas), scene: readStoredCanvasScene(canvas.scene) };
}

export async function renameCanvas(ownerId: string, id: string, input: { title: string; expectedRevision: number }): Promise<{ canvas: CanvasMetadataDtoV1 }> {
  return canvasTransaction(async (tx) => {
    const existing = await lockOwnedCanvas(tx, ownerId, id);
    if (existing.revision !== input.expectedRevision) throw new CanvasContractError("CANVAS_REVISION_CONFLICT");
    const canvas = await tx.canvas.update({ where: { id }, data: { title: input.title, revision: { increment: 1 } }, select: canvasMetadataSelect });
    return { canvas: serializeCanvasMetadata(canvas) };
  });
}

export async function saveCanvasSnapshot(ownerId: string, id: string, input: { expectedRevision: number; saveId: string; scene: CanvasSceneV1 }): Promise<CanvasSaveReceiptDtoV1> {
  const sceneJson = canonicalCanvasJson(input.scene);
  const hash = createHash("sha256").update(sceneJson, "utf8").digest("hex");
  return canvasTransaction(async (tx) => {
    const existing = await lockOwnedCanvas(tx, ownerId, id);
    if (existing.lastSaveId !== input.saveId) {
      if (existing.revision !== input.expectedRevision) throw new CanvasContractError("CANVAS_REVISION_CONFLICT");
      const ids = [...new Set(input.scene.nodes.flatMap((node) => node.kind === "reference" ? [node.source.assetId] : []))];
      if (ids.length) {
        const assets = await tx.canvasImportAsset.findMany({ where: { id: { in: ids }, ownerId, userId: ownerId, state: "READY" } });
        if (assets.length !== ids.length || assets.some((asset) => !canvasAssetUrl(asset))) throw new CanvasContractError("CANVAS_INPUT_UNAVAILABLE");
      }
    }
    // SQL owns tombstone-first replay, full resource checks, sorted locks, CAS, and all saved roots.
    const receipts = await tx.$queryRaw<Array<{ acknowledgedRevision: number; sceneHash: string }>>`
      SELECT * FROM canvas_save_snapshot(${ownerId}::text, ${id}::uuid, ${input.expectedRevision}::integer, ${input.saveId}::uuid, ${sceneJson}::jsonb, ${hash}::text)`;
    const canvas = await tx.canvas.findFirst({ where: { id, ownerId, userId: ownerId }, select: canvasMetadataSelect });
    if (!canvas || !receipts[0]) throw new CanvasContractError("CANVAS_INTERNAL_ERROR");
    return { canvas: serializeCanvasMetadata(canvas), saveId: input.saveId, sceneHash: receipts[0].sceneHash, acknowledgedRevision: receipts[0].acknowledgedRevision };
  });
}

export async function deleteCanvas(ownerId: string, id: string, expectedRevision: number): Promise<{ id: string; deleted: true; revision: number }> {
  return canvasTransaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ revision: number }>>`SELECT canvas_delete_document(${ownerId}::text, ${id}::uuid, ${expectedRevision}::integer) AS revision`;
    if (!rows[0]) throw new CanvasContractError("CANVAS_INTERNAL_ERROR");
    return { id, deleted: true, revision: rows[0].revision };
  });
}
