// @vitest-environment node

import { createHash, randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasImportAsset } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  user: vi.fn(), storage: vi.fn(), transaction: vi.fn(), query: vi.fn(), execute: vi.fn(), find: vi.fn(), create: vi.fn(),
}));
vi.mock("@/lib/server/current-user", () => ({ getCurrentUserRecord: mocks.user }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ CANVAS_ENABLED: true, S3_ENDPOINT: "https://storage.invalid", S3_REGION: "auto", S3_BUCKET: "canvas-tests", S3_PUBLIC_BASE_URL: "https://cdn.invalid/media" }) }));
vi.mock("@/lib/db", () => ({ db: { $transaction: mocks.transaction, $executeRaw: mocks.execute, canvasImportAsset: { findFirst: mocks.find } } }));
vi.mock("@/lib/canvas/storage", async (original) => ({ ...await original<typeof import("@/lib/canvas/storage")>(), createCanvasStorageAdapter: mocks.storage }));

import { POST } from "@/app/api/me/canvas-assets/route";
import { GET as readAsset } from "@/app/api/me/canvas-assets/[id]/route";
import { GET as readUpload } from "@/app/api/me/canvas-assets/uploads/[uploadId]/route";
import { importCanvasAsset, readCanvasUpload, withCanvasUploadSlot, type CanvasVerifiedUpload } from "@/lib/canvas/assets";
import { CANVAS_LIMITS, CanvasContractError } from "@/lib/canvas/contracts";
import { canvasStorageLocation, type CanvasStorageAdapter } from "@/lib/canvas/storage";
import { canvasAssetRow, canvasPng, canvasStorageTestEnv, canvasTestIds } from "./helpers/canvas-api-fixtures";

let rows: Map<string, CanvasImportAsset>;
let storage: CanvasStorageAdapter;
let loseCommitAck: boolean;
const tx = { $queryRaw: mocks.query, $executeRaw: mocks.execute, canvasImportAsset: { findFirst: mocks.find, create: mocks.create } };

function verified(pixel = 0, uploadId: string = canvasTestIds.upload): CanvasVerifiedUpload {
  const bytes = canvasPng(pixel);
  return { bytes, declaration: { uploadId, byteLength: bytes.length, mimeType: "image/png", sha256: createHash("sha256").update(bytes).digest("hex") } };
}

function multipart(change?: (form: FormData) => void): Request {
  const input = verified(); const form = new FormData();
  for (const [name, value] of Object.entries(input.declaration)) form.append(name, String(value));
  form.append("file", new Blob([new Uint8Array(input.bytes)], { type: "image/png" }), "original.png");
  change?.(form);
  return new Request("http://localhost/api/me/canvas-assets", { method: "POST", body: form });
}

beforeEach(() => {
  vi.clearAllMocks(); rows = new Map(); loseCommitAck = false;
  mocks.user.mockResolvedValue({ id: "owner" });
  const location = canvasStorageLocation({ endpoint: canvasStorageTestEnv.S3_ENDPOINT, region: canvasStorageTestEnv.S3_REGION, bucket: canvasStorageTestEnv.S3_BUCKET });
  storage = {
    location, close: vi.fn(),
    getBucketVersioning: vi.fn().mockResolvedValue({ locationId: location.id, verified: true }),
    putObject: vi.fn().mockResolvedValue({ versionId: null }),
  };
  mocks.storage.mockReturnValue(storage);
  let queue = Promise.resolve<unknown>(undefined);
  mocks.transaction.mockImplementation((operation: (transaction: unknown) => Promise<unknown>) => {
    const result = queue.then(async () => {
      const value = await operation(tx);
      if (loseCommitAck && [...rows.values()].some((asset) => asset.state === "READY")) { loseCommitAck = false; throw new Error("lost final commit ACK"); }
      return value;
    });
    queue = result.catch(() => undefined);
    return result;
  });
  mocks.find.mockImplementation(async ({ where }: { where: { id?: string; ownerId: string; userId?: string; uploadId?: string } }) => [...rows.values()].find((asset) => asset.ownerId === where.ownerId && (!where.id || asset.id === where.id) && (!where.uploadId || asset.uploadId === where.uploadId) && (!where.userId || asset.userId === where.userId)) ?? null);
  mocks.create.mockImplementation(async ({ data }: { data: Partial<CanvasImportAsset> & { id: string; byteLength: number; ownerId: string } }) => {
    const owned = [...rows.values()].filter((asset) => asset.ownerId === data.ownerId);
    const accounted = owned.filter((asset) => asset.physicalBytesAccounted);
    if (accounted.length >= CANVAS_LIMITS.ownerAccountedImports || accounted.reduce((sum, asset) => sum + asset.byteLength, 0) + data.byteLength > CANVAS_LIMITS.ownerImportBytes || owned.filter((asset) => asset.state === "UPLOADING" && asset.uploadExpiresAt.getTime() > Date.now()).length >= CANVAS_LIMITS.activeUploadsPerOwner) {
      throw { code: "P2010", meta: { code: "P0001", message: "CANVAS_QUOTA_EXCEEDED" } };
    }
    const asset = canvasAssetRow({ ...data, state: "UPLOADING", putOutcome: "NOT_STARTED", readyAt: null, detachedAt: null, uploadExpiresAt: new Date(Date.now() + CANVAS_LIMITS.uploadLeaseSeconds * 1000) });
    rows.set(asset.id, asset);
    return { ...asset };
  });
  mocks.query.mockImplementation(async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const sql = parts.join("");
    if (sql.includes("canvas_lock_owner")) return [];
    if (sql.includes("SET state = 'READY'")) {
      const [id, owner, user, token] = values as string[];
      const asset = rows.get(id);
      if (!asset || asset.ownerId !== owner || asset.userId !== user || asset.uploadToken !== token || asset.state !== "UPLOADING" || asset.uploadExpiresAt.getTime() <= Date.now()) return [];
      asset.state = "READY"; asset.putOutcome = "CONFIRMED"; asset.readyAt = new Date(); asset.detachedAt = new Date();
      return [{ ...asset }];
    }
    throw new Error("Unexpected SQL in upload fake");
  });
  mocks.execute.mockImplementation(async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const sql = parts.join("");
    if (sql.includes("canvas_lock_owner")) return 1;
    if (sql.includes('"uploadExpiresAt" <= clock_timestamp()')) {
      const [owner, uploadId] = values;
      const asset = [...rows.values()].find((row) => row.ownerId === owner && row.uploadId === uploadId);
      if (!asset || asset.state !== "UPLOADING" || asset.uploadExpiresAt.getTime() > Date.now()) return 0;
      asset.state = "QUARANTINED"; asset.putOutcome = "UNKNOWN"; asset.detachedAt = new Date();
      return 1;
    }
    if (sql.includes('"storageVersionId" = COALESCE')) {
      const [version, code, id, owner, token] = values as [string | null, string, string, string, string];
      const asset = rows.get(id);
      if (!asset || asset.ownerId !== owner || asset.uploadToken !== token || !["UPLOADING", "QUARANTINED"].includes(asset.state)) return 0;
      asset.state = "QUARANTINED"; asset.putOutcome = "UNKNOWN"; asset.storageVersionId ??= version; asset.lastStorageErrorCode = code; asset.detachedAt ??= new Date();
      return 1;
    }
    if (sql.includes('"needsReconciliation" = true')) {
      const [version, id, owner, token] = values as string[];
      const asset = rows.get(id);
      if (!asset || asset.ownerId !== owner || asset.uploadToken !== token || asset.putOutcome !== "UNKNOWN" || asset.storageVersionId !== null || !["DELETING", "DELETED"].includes(asset.state)) return 0;
      asset.storageVersionId = version; asset.physicalBytesAccounted = true; asset.needsReconciliation = true; asset.lastStorageErrorCode = "CANVAS_STORAGE_CAPABILITY_INVALID";
      return 1;
    }
    throw new Error("Unexpected mutation in upload fake");
  });
});

describe("canvas multipart boundary", () => {
  it("verifies actual length, digest, MIME and full container using exactly five multipart fields", async () => {
    expect(await readCanvasUpload(multipart())).toEqual(verified());
  });

  it.each([
    (form: FormData) => form.append("file", new Blob(["extra"]), "second.png"),
    (form: FormData) => form.append("ownerId", "foreign"),
    (form: FormData) => form.append("sha256", "0".repeat(64)),
    (form: FormData) => form.set("sha256", "0".repeat(64)),
    (form: FormData) => form.set("byteLength", "1"),
    (form: FormData) => form.set("mimeType", "image/jpeg"),
    (form: FormData) => form.set("file", new Blob(["not an image"], { type: "image/png" }), "pretend.png"),
  ])("rejects unknown/duplicate fields and forged original declarations %#", async (change) => {
    await expect(readCanvasUpload(multipart(change))).rejects.toBeInstanceOf(CanvasContractError);
  });

  it("rejects declared or actual oversized transport before multipart buffering", async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(CANVAS_LIMITS.uploadBodyBytes + 1)); controller.close(); } });
    const request = new Request("http://localhost", { method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=x" }, body, duplex: "half" } as RequestInit);
    await expect(readCanvasUpload(request)).rejects.toMatchObject({ code: "CANVAS_LIMIT_EXCEEDED" });
    expect(mocks.storage).not.toHaveBeenCalled();
  });

  it("bounds in-process upload bodies and releases slots on failure", async () => {
    const release: Array<() => void> = [];
    const pending = [1, 2, 3].map(() => withCanvasUploadSlot("slot-owner", () => new Promise<void>((resolve) => release.push(resolve))));
    await expect(withCanvasUploadSlot("slot-owner", async () => undefined)).rejects.toMatchObject({ code: "CANVAS_QUOTA_EXCEEDED" });
    release.forEach((resolve) => resolve()); await Promise.all(pending);
    await expect(withCanvasUploadSlot("slot-owner", async () => { throw new Error("interrupted"); })).rejects.toThrow("interrupted");
    await expect(withCanvasUploadSlot("slot-owner", async () => "available")).resolves.toBe("available");
  });
});

describe("upload-once canvas assets (fake transactions/storage only)", () => {
  it("registers a trusted immutable identity before PUT, outside the transaction, then reuses READY", async () => {
    storage.putObject = vi.fn(async ({ key }) => {
      const registered = [...rows.values()];
      expect(registered).toHaveLength(1); expect(registered[0]).toMatchObject({ storageKey: key, state: "UPLOADING", physicalBytesAccounted: true });
      return { versionId: null };
    });
    const response = await POST(multipart());
    expect(response.status).toBe(200);
    const asset = (await response.json()).data.asset;
    expect(asset).toMatchObject({ state: "READY", sha256: verified().declaration.sha256, url: expect.stringMatching(/^https:\/\/cdn\.invalid\/media\/canvas-imports\//) });
    expect(asset).not.toHaveProperty("storageKey"); expect(asset).not.toHaveProperty("uploadToken");
    expect(await importCanvasAsset("owner", verified())).toMatchObject({ asset: { id: asset.id }, pending: false });
    expect(storage.putObject).toHaveBeenCalledOnce(); expect(rows.size).toBe(1);
  });

  it("returns 202 for active same-upload retries and provides owner-scoped lost-ACK status", async () => {
    const active = canvasAssetRow({ state: "UPLOADING", readyAt: null, putOutcome: "NOT_STARTED" }); rows.set(active.id, active);
    expect((await POST(multipart())).status).toBe(202);
    const context = { params: Promise.resolve({ uploadId: active.uploadId }) };
    const status = await readUpload(new Request("http://localhost"), context);
    expect(status.status).toBe(202); expect(await status.json()).toMatchObject({ data: { asset: { id: active.id, state: "UPLOADING", url: null } } });
    mocks.user.mockResolvedValue({ id: "foreign" });
    expect(await (await readUpload(new Request("http://localhost"), context)).json()).toMatchObject({ code: "CANVAS_INPUT_UNAVAILABLE" });
    expect(mocks.storage).not.toHaveBeenCalled();
  });

  it("keeps upload intent immutable even when the replacement is another valid image", async () => {
    const asset = canvasAssetRow(); rows.set(asset.id, asset);
    await expect(importCanvasAsset("owner", verified(255))).rejects.toMatchObject({ code: "CANVAS_UPLOAD_CONFLICT" });
    expect(storage.putObject).not.toHaveBeenCalled(); expect(rows.get(asset.id)!.sha256).toBe(asset.sha256);
  });

  it("retains inventory/accounting after ambiguous PUT and never retries that identity", async () => {
    storage.putObject = vi.fn().mockRejectedValue(new Error("private upstream failure"));
    await expect(importCanvasAsset("owner", verified())).rejects.toMatchObject({ code: "CANVAS_UPLOAD_QUARANTINED" });
    const asset = [...rows.values()][0];
    expect(asset).toMatchObject({ state: "QUARANTINED", putOutcome: "UNKNOWN", physicalBytesAccounted: true, storageKey: expect.stringMatching(/^canvas-imports\//) });
    await expect(importCanvasAsset("owner", verified())).rejects.toMatchObject({ code: "CANVAS_UPLOAD_QUARANTINED" });
    expect(storage.putObject).toHaveBeenCalledOnce();
  });

  it("quarantines stale reservations without a second PUT or renewal", async () => {
    const asset = canvasAssetRow({ state: "UPLOADING", putOutcome: "NOT_STARTED", readyAt: null, uploadExpiresAt: new Date(0) }); rows.set(asset.id, asset);
    await expect(importCanvasAsset("owner", verified())).rejects.toMatchObject({ code: "CANVAS_UPLOAD_QUARANTINED" });
    expect(rows.get(asset.id)).toMatchObject({ state: "QUARANTINED", putOutcome: "UNKNOWN", uploadExpiresAt: new Date(0), physicalBytesAccounted: true });
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it("records unexpected version receipts and refuses READY", async () => {
    storage.putObject = vi.fn().mockResolvedValue({ versionId: "original-version" });
    await expect(importCanvasAsset("owner", verified())).rejects.toMatchObject({ code: "CANVAS_STORAGE_CAPABILITY_INVALID" });
    expect([...rows.values()][0]).toMatchObject({ state: "QUARANTINED", storageVersionId: "original-version", physicalBytesAccounted: true, putOutcome: "UNKNOWN" });
    expect(storage.close).toHaveBeenCalledOnce();
  });

  it("does not publish after losing the upload fence", async () => {
    storage.putObject = vi.fn(async () => { [...rows.values()][0].state = "QUARANTINED"; return { versionId: null }; });
    await expect(importCanvasAsset("owner", verified())).rejects.toMatchObject({ code: "CANVAS_LEASE_LOST" });
    expect([...rows.values()][0].state).toBe("QUARANTINED");
  });

  it("recovers an ambiguous final database ACK by original READY identity without a second PUT", async () => {
    loseCommitAck = true;
    await expect(importCanvasAsset("owner", verified())).rejects.toThrow("lost final commit ACK");
    const id = [...rows.keys()][0];
    expect(await importCanvasAsset("owner", verified())).toMatchObject({ asset: { id, state: "READY" }, pending: false });
    expect(storage.putObject).toHaveBeenCalledOnce();
  });

  it.each(["count", "bytes", "active"])("rejects the database quota before PUT, including quarantined physical inventory: %s", async (kind) => {
    const count = kind === "count" ? CANVAS_LIMITS.ownerAccountedImports : kind === "bytes" ? 128 : 3;
    for (let index = 0; index < count; index += 1) {
      const asset = canvasAssetRow({ id: `quota-${index}`, uploadId: randomUUID(), state: kind === "active" ? "UPLOADING" : "QUARANTINED", byteLength: kind === "bytes" ? CANVAS_LIMITS.importBytes : 1 });
      rows.set(asset.id, asset);
    }
    await expect(importCanvasAsset("owner", verified())).rejects.toMatchObject({ code: "CANVAS_QUOTA_EXCEEDED" });
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it("same-upload concurrent arrivals use one reservation and one original PUT", async () => {
    const results = await Promise.all([importCanvasAsset("owner", verified()), importCanvasAsset("owner", verified())]);
    expect(new Set(results.map((result) => result.asset.id)).size).toBe(1);
    expect(rows.size).toBe(1); expect(storage.putObject).toHaveBeenCalledOnce();
  });

  it("does not query or expose a foreign asset and returns an explicit deleted state for owned inventory", async () => {
    const asset = canvasAssetRow({ state: "DELETED" }); rows.set(asset.id, asset);
    const context = { params: Promise.resolve({ id: asset.id }) };
    expect(await (await readAsset(new Request("http://localhost"), context)).json()).toMatchObject({ data: { asset: { state: "DELETED", url: null } } });
    mocks.user.mockResolvedValue({ id: "foreign" });
    expect(await (await readAsset(new Request("http://localhost"), context)).json()).toMatchObject({ code: "CANVAS_INPUT_UNAVAILABLE" });
  });

  it.each(["DELETING", "DELETED"] as const)("records a late original version receipt in %s without state/lease revival or unhandled rejection", async (state) => {
    vi.useFakeTimers();
    try {
      let resolvePut!: (receipt: { versionId: string | null }) => void;
      storage.putObject = vi.fn(() => new Promise<{ versionId: string | null }>((resolve) => { resolvePut = resolve; }));
      const failed = expect(importCanvasAsset("owner", verified())).rejects.toMatchObject({ code: "CANVAS_UPLOAD_QUARANTINED" });
      await vi.advanceTimersByTimeAsync(30_001); await failed;
      const asset = [...rows.values()][0];
      asset.state = state; asset.deleteToken = canvasTestIds.token; asset.deleteExpiresAt = new Date("2099-01-01T00:00:00.000Z"); asset.deleteOutcome = state === "DELETED" ? "DELETED" : "NOT_STARTED";
      const fence = { state, deleteToken: asset.deleteToken, deleteExpiresAt: asset.deleteExpiresAt, deleteOutcome: asset.deleteOutcome };
      resolvePut({ versionId: "late-original-version" });
      await vi.advanceTimersByTimeAsync(1);
      expect(rows.get(asset.id)).toMatchObject({ ...fence, storageVersionId: "late-original-version", putOutcome: "UNKNOWN", physicalBytesAccounted: true, needsReconciliation: true });
      expect(storage.putObject).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
});
