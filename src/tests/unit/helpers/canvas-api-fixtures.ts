import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import type { Canvas, CanvasImportAsset } from "@prisma/client";

import { canvasStorageLocation } from "@/lib/canvas/storage";
import type { CanvasSceneV1 } from "@/lib/canvas/contracts";

export const canvasTestIds = {
  canvas: "a1111111-1111-4111-8111-111111111111",
  otherCanvas: "a2222222-2222-4222-8222-222222222222",
  node: "a3333333-3333-4333-8333-333333333333",
  reference: "a4444444-4444-4444-8444-444444444444",
  save: "a5555555-5555-4555-8555-555555555555",
  otherSave: "a6666666-6666-4666-8666-666666666666",
  upload: "a7777777-7777-4777-8777-777777777777",
  token: "a8888888-8888-4888-8888-888888888888",
};

export const canvasStorageTestEnv = {
  S3_ENDPOINT: "https://storage.invalid",
  S3_REGION: "auto",
  S3_BUCKET: "canvas-tests",
  S3_PUBLIC_BASE_URL: "https://cdn.invalid/media",
  S3_ACCESS_KEY_ID: "fake-access",
  S3_SECRET_ACCESS_KEY: "fake-secret",
};

export function canvasPngChunk(kind: string | Buffer, data: Buffer): Buffer {
  const content = Buffer.concat([typeof kind === "string" ? Buffer.from(kind) : kind, data]);
  let crc = 0xffffffff;
  for (const byte of content) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, content, checksum]);
}

export function canvasPng(pixel = 0): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    canvasPngChunk("IHDR", header),
    canvasPngChunk("IDAT", deflateSync(Buffer.from([0, pixel, pixel, pixel, 255]))),
    canvasPngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export function canvasScene(): CanvasSceneV1 {
  return { schemaVersion: 1, nodes: [{ id: canvasTestIds.node, kind: "prompt", position: { x: -10, y: 0 }, text: "" }], edges: [], viewport: { x: -100, y: 0, zoom: 1 }, runBindings: [] };
}

export function canvasRow(overrides: Partial<Canvas> = {}): Canvas {
  return {
    id: canvasTestIds.canvas, ownerId: "owner", userId: "owner", title: "Canvas", revision: 0, scene: null,
    lastSaveId: null, lastSaveHash: null, lastSaveRevision: null, lastSavedAt: null, deletedAt: null,
    createdAt: new Date("2026-10-20T00:00:00.000Z"), updatedAt: new Date("2026-10-20T00:00:00.000Z"),
    ...overrides,
  };
}

export function canvasAssetRow(overrides: Partial<CanvasImportAsset> = {}): CanvasImportAsset {
  const location = canvasStorageLocation({ endpoint: canvasStorageTestEnv.S3_ENDPOINT, region: canvasStorageTestEnv.S3_REGION, bucket: canvasStorageTestEnv.S3_BUCKET });
  const bytes = canvasPng();
  return {
    id: "asset-one", ownerId: "owner", userId: "owner", uploadId: canvasTestIds.upload, kind: "IMPORT",
    sha256: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.length, mimeType: "image/png",
    storageLocation: location.id, storageEndpoint: location.endpoint, storageRegion: location.region, storageBucket: location.bucket,
    storageKey: "canvas-imports/original.png", storageVersionId: null, state: "READY", uploadToken: canvasTestIds.token,
    uploadExpiresAt: new Date("2099-01-01T00:00:00.000Z"), preparationExpiresAt: null,
    readyAt: new Date("2026-10-20T00:00:00.000Z"), detachedAt: new Date("2026-10-20T00:00:00.000Z"),
    putOutcome: "CONFIRMED", deleteOutcome: "NOT_STARTED", deleteToken: null, deleteExpiresAt: null,
    deleteAttempts: 0, nextDeleteAt: null, deletedAt: null, lastStorageErrorCode: null,
    physicalBytesAccounted: true, needsReconciliation: false,
    createdAt: new Date("2026-10-20T00:00:00.000Z"), updatedAt: new Date("2026-10-20T00:00:00.000Z"),
    ...overrides,
  };
}

export function canvasJsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(`http://localhost${url}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
