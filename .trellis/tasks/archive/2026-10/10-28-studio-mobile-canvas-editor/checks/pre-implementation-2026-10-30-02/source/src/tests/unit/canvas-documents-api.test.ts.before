// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Canvas, CanvasImportAsset, Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  user: vi.fn(), env: { CANVAS_ENABLED: true },
  query: vi.fn(), execute: vi.fn(), transaction: vi.fn(),
  findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), count: vi.fn(), assets: vi.fn(),
}));
vi.mock("@/lib/server/current-user", () => ({ getCurrentUserRecord: mocks.user }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ ...mocks.env, S3_ENDPOINT: "https://storage.invalid", S3_REGION: "auto", S3_BUCKET: "canvas-tests", S3_PUBLIC_BASE_URL: "https://cdn.invalid/media" }) }));
vi.mock("@/lib/db", () => ({ db: {
  $transaction: mocks.transaction,
  canvas: { findFirst: mocks.findFirst, findMany: mocks.findMany },
} }));

import { GET as list, POST as create } from "@/app/api/me/canvases/route";
import { DELETE as remove, GET as read, PATCH as rename } from "@/app/api/me/canvases/[id]/route";
import { PUT as save } from "@/app/api/me/canvases/[id]/snapshot/route";
import { CanvasContractError } from "@/lib/canvas/contracts";
import { decodeCanvasCursor } from "@/lib/canvas/cursors";
import { canvasAssetRow, canvasJsonRequest, canvasRow, canvasScene, canvasTestIds } from "./helpers/canvas-api-fixtures";

let rows: Map<string, Canvas>;
let roots: string[];
let assets: CanvasImportAsset[];
const context = (id: string = canvasTestIds.canvas) => ({ params: Promise.resolve({ id }) });
const body = () => ({ expectedRevision: 0, saveId: canvasTestIds.save, scene: canvasScene() });
const tx = {
  $queryRaw: mocks.query, $executeRaw: mocks.execute,
  canvas: { findUnique: mocks.findUnique, findFirst: mocks.findFirst, count: mocks.count, update: mocks.update },
  canvasImportAsset: { findMany: mocks.assets },
};

beforeEach(() => {
  vi.clearAllMocks();
  rows = new Map(); roots = []; assets = [];
  mocks.env.CANVAS_ENABLED = true;
  mocks.user.mockResolvedValue({ id: "owner" });
  mocks.transaction.mockImplementation(async (operation: (transaction: unknown) => Promise<unknown>) => operation(tx));
  mocks.count.mockImplementation(async () => [...rows.values()].filter((row) => !row.deletedAt && row.ownerId === "owner").length);
  mocks.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null);
  mocks.findFirst.mockImplementation(async ({ where }: { where: { id: string; ownerId: string; userId: string } }) => {
    const row = rows.get(where.id);
    return row?.ownerId === where.ownerId && row.userId === where.userId ? row : null;
  });
  mocks.assets.mockImplementation(async ({ where }: { where: { id: { in: string[] }; ownerId: string; state: string } }) => assets.filter((asset) => where.id.in.includes(asset.id) && asset.ownerId === where.ownerId && asset.state === where.state));
  mocks.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: { title: string } }) => {
    const row = rows.get(where.id)!;
    row.title = data.title; row.revision += 1; row.updatedAt = new Date("2026-10-29T12:00:00.000Z");
    return row;
  });
  mocks.execute.mockImplementation(async (parts: TemplateStringsArray, ...values: unknown[]) => {
    if (parts.join("").includes('INSERT INTO "Canvas"')) {
      const [id, ownerId, userId, title] = values as string[];
      if (!rows.has(id)) rows.set(id, canvasRow({ id, ownerId, userId, title }));
    }
    return 1;
  });
  mocks.query.mockImplementation(async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const sql = parts.join("");
    if (sql.includes("canvas_lock_owner")) return [];
    if (sql.includes("FOR UPDATE")) {
      const row = rows.get(values[0] as string);
      return row?.ownerId === values[1] ? [row] : [];
    }
    const row = rows.get(values[1] as string);
    if (!row || row.ownerId !== values[0]) throw new CanvasContractError("CANVAS_NOT_FOUND");
    if (sql.includes("canvas_delete_document")) {
      if (!row.deletedAt) {
        if (row.revision !== values[2]) throw new CanvasContractError("CANVAS_REVISION_CONFLICT");
        row.deletedAt = new Date(); row.revision += 1; row.scene = null; row.lastSaveId = null; row.lastSaveHash = null; row.lastSaveRevision = null; row.lastSavedAt = null; roots = [];
      }
      return [{ revision: row.revision }];
    }
    if (sql.includes("canvas_save_snapshot")) {
      if (row.deletedAt) throw new CanvasContractError("CANVAS_DELETED");
      const [, , expectedRevision, saveId, json, hash] = values as [string, string, number, string, string, string];
      if (row.lastSaveId === saveId) {
        if (row.lastSaveHash !== hash) throw new CanvasContractError("CANVAS_SAVE_CONFLICT");
      } else {
        if (row.revision !== expectedRevision) throw new CanvasContractError("CANVAS_REVISION_CONFLICT");
        row.scene = JSON.parse(json) as Prisma.JsonValue; row.revision += 1; row.lastSaveRevision = row.revision; row.lastSaveId = saveId; row.lastSaveHash = hash; row.lastSavedAt = new Date("2026-10-29T00:00:00.000Z");
        roots = (JSON.parse(json) as ReturnType<typeof canvasScene>).nodes.flatMap((node) => node.kind === "reference" ? [node.source.assetId] : []);
      }
      return [{ acknowledgedRevision: row.lastSaveRevision, sceneHash: row.lastSaveHash }];
    }
    throw new Error("unexpected SQL in bounded document mock");
  });
});

describe("canvas document owner APIs", () => {
  it("requires authentication and feature enablement before touching body or storage", async () => {
    mocks.user.mockResolvedValue(null);
    expect((await create(canvasJsonRequest("/api/me/canvases", "POST", {}))).status).toBe(401);
    mocks.user.mockResolvedValue({ id: "owner" }); mocks.env.CANVAS_ENABLED = false;
    expect((await list(new Request("http://localhost/api/me/canvases"))).status).toBe(404);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("registers a revision-zero unsaved shell, trims title, and replays its live identity without overwrite", async () => {
    const request = () => canvasJsonRequest("/api/me/canvases", "POST", { id: canvasTestIds.canvas, title: "  Draft  " });
    expect(await (await create(request())).json()).toMatchObject({ data: { canvas: { title: "Draft", revision: 0, lastSavedAt: null, hasSavedSnapshot: false } } });
    rows.get(canvasTestIds.canvas)!.title = "Already renamed";
    expect(await (await create(request())).json()).toMatchObject({ data: { canvas: { title: "Already renamed", revision: 0 } } });
    expect(await (await read(new Request("http://localhost"), context())).json()).toMatchObject({ data: { scene: null } });
  });

  it.each([
    { row: canvasRow({ ownerId: "foreign", userId: "foreign" }), code: "CANVAS_NOT_FOUND", status: 404 },
    { row: canvasRow({ deletedAt: new Date() }), code: "CANVAS_DELETED", status: 409 },
  ])("never recreates foreign or tombstoned identity: $code", async ({ row, code, status }) => {
    rows.set(row.id, row);
    const result = await create(canvasJsonRequest("/api/me/canvases", "POST", { id: row.id, title: "New" }));
    expect(result.status).toBe(status); expect(await result.json()).toMatchObject({ code });
  });

  it("enforces shell quota and rejects extra/unresolved scene fields on New", async () => {
    mocks.count.mockResolvedValue(100);
    const request = canvasJsonRequest("/api/me/canvases", "POST", { id: canvasTestIds.canvas, title: "New" });
    expect(await (await create(request)).json()).toMatchObject({ code: "CANVAS_QUOTA_EXCEEDED" });
    expect((await create(canvasJsonRequest("/api/me/canvases", "POST", { id: canvasTestIds.canvas, title: "New", scene: canvasScene() }))).status).toBe(400);
  });

  it("renames metadata via expected revision without claiming an unsaved graph was saved", async () => {
    rows.set(canvasTestIds.canvas, canvasRow());
    const response = await rename(canvasJsonRequest("/api", "PATCH", { title: "Renamed", expectedRevision: 0 }), context());
    expect(await response.json()).toMatchObject({ data: { canvas: { title: "Renamed", revision: 1, hasSavedSnapshot: false, lastSavedAt: null } } });
    expect(rows.get(canvasTestIds.canvas)!.scene).toBeNull();
    expect(await (await rename(canvasJsonRequest("/api", "PATCH", { title: "Stale", expectedRevision: 0 }), context())).json()).toMatchObject({ code: "CANVAS_REVISION_CONFLICT" });
  });

  it("saves incomplete prompts and every disconnected original using the one atomic SQL authority", async () => {
    rows.set(canvasTestIds.canvas, canvasRow()); assets = [canvasAssetRow()];
    const input = body();
    input.scene.nodes.push({ id: canvasTestIds.reference, kind: "reference", position: { x: 0, y: 0 }, source: { kind: "imported", assetId: "asset-one" } });
    const response = await save(canvasJsonRequest("/api", "PUT", input), context());
    expect(await response.json()).toMatchObject({ data: { saveId: canvasTestIds.save, acknowledgedRevision: 1, sceneHash: expect.stringMatching(/^[a-f0-9]{64}$/), canvas: { revision: 1, hasSavedSnapshot: true } } });
    expect(roots).toEqual(["asset-one"]);
    expect((await (await read(new Request("http://localhost"), context())).json()).data.scene).toEqual(input.scene);
  });

  it.each(["foreign", "QUARANTINED", "other-location"])("rejects an unavailable original without replacing the snapshot: %s", async (mode) => {
    rows.set(canvasTestIds.canvas, canvasRow());
    assets = [canvasAssetRow(mode === "foreign" ? { ownerId: "foreign" } : mode === "QUARANTINED" ? { state: "QUARANTINED" } : { storageLocation: "different-location" })];
    const input = body(); input.scene.nodes.push({ id: canvasTestIds.reference, kind: "reference", position: { x: 0, y: 0 }, source: { kind: "imported", assetId: "asset-one" } });
    expect(await (await save(canvasJsonRequest("/api", "PUT", input), context())).json()).toMatchObject({ code: "CANVAS_INPUT_UNAVAILABLE" });
    expect(rows.get(canvasTestIds.canvas)!.revision).toBe(0); expect(roots).toEqual([]);
  });

  it("returns the exact captured receipt after Rename and refuses changed/obsolete save intents", async () => {
    rows.set(canvasTestIds.canvas, canvasRow());
    await save(canvasJsonRequest("/api", "PUT", body()), context());
    await rename(canvasJsonRequest("/api", "PATCH", { title: "Title only", expectedRevision: 1 }), context());
    expect(await (await save(canvasJsonRequest("/api", "PUT", body()), context())).json()).toMatchObject({ data: { acknowledgedRevision: 1, canvas: { revision: 2, title: "Title only" } } });
    const changed = body(); changed.scene.viewport.x = 10;
    expect(await (await save(canvasJsonRequest("/api", "PUT", changed), context())).json()).toMatchObject({ code: "CANVAS_SAVE_CONFLICT" });
    await save(canvasJsonRequest("/api", "PUT", { ...changed, expectedRevision: 2, saveId: canvasTestIds.otherSave }), context());
    expect(await (await save(canvasJsonRequest("/api", "PUT", body()), context())).json()).toMatchObject({ code: "CANVAS_REVISION_CONFLICT" });
  });

  it("checks tombstones before replay, makes Delete idempotent, and only clears organization", async () => {
    rows.set(canvasTestIds.canvas, canvasRow()); await save(canvasJsonRequest("/api", "PUT", body()), context());
    expect((await remove(canvasJsonRequest("/api", "DELETE", { expectedRevision: 0 }), context())).status).toBe(409);
    expect(await (await remove(canvasJsonRequest("/api", "DELETE", { expectedRevision: 1 }), context())).json()).toMatchObject({ data: { deleted: true, revision: 2 } });
    expect(await (await remove(canvasJsonRequest("/api", "DELETE", { expectedRevision: 1 }), context())).json()).toMatchObject({ data: { deleted: true, revision: 2 } });
    expect(await (await save(canvasJsonRequest("/api", "PUT", body()), context())).json()).toMatchObject({ code: "CANVAS_DELETED" });
    expect(rows.get(canvasTestIds.canvas)!.scene).toBeNull(); expect(roots).toEqual([]);
    // This fake has no generation/media/billing delegates: any such access fails.
  });

  it("pages metadata on immutable creation keys even when a concurrent Rename changed updatedAt", async () => {
    const items = [canvasRow({ id: canvasTestIds.canvas }), canvasRow({ id: canvasTestIds.otherCanvas, createdAt: new Date("2026-10-19T00:00:00.000Z"), updatedAt: new Date("2026-10-30T00:00:00.000Z") })];
    mocks.findMany.mockResolvedValue(items);
    const response = await list(new Request("http://localhost/api/me/canvases?limit=1"));
    const data = (await response.json()).data;
    expect(data.canvases).toHaveLength(1); expect(data.canvases[0]).not.toHaveProperty("scene");
    const key = decodeCanvasCursor(data.nextCursor, { ownerId: "owner", scope: "canvas", parentId: null });
    expect(key.at).toEqual(items[0].createdAt);
    await list(new Request(`http://localhost/api/me/canvases?limit=1&cursor=${data.nextCursor}`));
    expect(mocks.findMany.mock.lastCall?.[0]).toMatchObject({
      where: { ownerId: "owner", userId: "owner", deletedAt: null, OR: [{ createdAt: { lt: key.at } }, { createdAt: key.at, id: { lt: key.id } }] },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 2,
    });
    expect(mocks.findMany.mock.lastCall?.[0].select).not.toHaveProperty("scene");
  });

  it("rejects a forged non-UUID canvas cursor before the UUID database comparison", async () => {
    const cursor = Buffer.from(JSON.stringify({ schemaVersion: 1, ownerId: "owner", scope: "canvas", parentId: null, at: "2026-10-20T00:00:00.000Z", id: "job_opaque" })).toString("base64url");
    const response = await list(new Request(`http://localhost/api/me/canvases?cursor=${cursor}`));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "CANVAS_INVALID_INPUT" });
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("never replaces an unsupported persisted scene with an empty document", async () => {
    rows.set(canvasTestIds.canvas, canvasRow({ scene: { schemaVersion: 999 } }));
    expect(await (await read(new Request("http://localhost"), context())).json()).toMatchObject({ code: "CANVAS_VERSION_UNSUPPORTED" });
  });
});
