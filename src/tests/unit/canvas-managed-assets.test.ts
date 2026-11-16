// @vitest-environment node

import { createHash } from "node:crypto";

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), execute: vi.fn(), find: vi.fn(), create: vi.fn(), prepare: vi.fn(), abandon: vi.fn(), put: vi.fn(), finish: vi.fn(), close: vi.fn(), verify: vi.fn(), events: [] as string[] }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ IMAGE_STORAGE_MANAGED_ENABLED: true, APP_URL: "https://app.example.test" }) }));
vi.mock("@/lib/db", () => ({ db: { $transaction: mocks.transaction, $executeRaw: mocks.execute, canvasImportAsset: { findFirst: mocks.find } } }));
vi.mock("@/lib/storage/managed-image-storage", () => ({ prepareManagedImageWrite: mocks.prepare, abandonPreparedImageWrite: mocks.abandon, putManagedImageObject: mocks.put }));
vi.mock("@/lib/storage/image-repository", () => ({ ImageRepository: class { finishObject = mocks.finish; closeReservation = mocks.close; } }));
vi.mock("@/lib/canvas/storage", async (original) => ({ ...await original<typeof import("@/lib/canvas/storage")>(), verifyCanvasStorageCapability: mocks.verify,
  createCanvasStorageAdapter: () => ({ location: { id: "local-v1:00112233-4455-4677-8899-aabbccddeeff", provider: "LOCAL", endpoint: null, region: null, bucket: null, volumeId: "00112233-4455-4677-8899-aabbccddeeff" } }),
}));

import { importCanvasAsset } from "@/lib/canvas/assets";
import { CanvasContractError } from "@/lib/canvas/contracts";
import { canvasAssetRow, canvasPng, canvasTestIds } from "./helpers/canvas-api-fixtures";

const bytes = canvasPng();
const input = { bytes, declaration: { uploadId: canvasTestIds.upload, byteLength: bytes.length, mimeType: "image/png" as const, sha256: createHash("sha256").update(bytes).digest("hex") } };
const media = () => ({ state: "PENDING", publicToken: "a".repeat(64), activeObjectId: null as string | null });
type Row = ReturnType<typeof canvasAssetRow> & { mediaAsset: ReturnType<typeof media> };
let row: Row | null;
const prepared = () => ({ bytes, location: { id: "local-v1:00112233-4455-4677-8899-aabbccddeeff", provider: "LOCAL", endpoint: null, region: null, bucket: null }, reservation: { id: "reservation", token: "fence" },
  ticket: { writeGranted: true, asset: { id: "22334455-6677-4899-aabb-ccddeeff0011" }, object: { id: "object", key: "canvas-imports/registered.png", writeToken: canvasTestIds.token } } });

beforeEach(() => {
  vi.resetAllMocks(); row = null; mocks.events.length = 0;
  mocks.close.mockResolvedValue(true); mocks.abandon.mockResolvedValue(undefined);
  const tx = { $executeRaw: mocks.execute, canvasImportAsset: { findFirst: mocks.find, create: mocks.create } };
  mocks.transaction.mockImplementation(async (operation) => operation(tx));
  mocks.find.mockImplementation(async () => row);
  mocks.create.mockImplementation(async ({ data }: { data: Partial<ReturnType<typeof canvasAssetRow>> }) => {
    mocks.events.push("registry");
    row = { ...canvasAssetRow({ ...data, state: "UPLOADING", putOutcome: "NOT_STARTED", readyAt: null }), mediaAsset: media() };
    return row;
  });
  mocks.prepare.mockImplementation(async () => { mocks.events.push("prepare"); return prepared(); });
  mocks.put.mockImplementation(async () => { mocks.events.push("put"); return { versionId: null }; });
  mocks.finish.mockImplementation(async (receipt: { outcome: string }) => {
    if (receipt.outcome === "CONFIRMED" && row) row.mediaAsset = { ...media(), state: "AVAILABLE", activeObjectId: "object" };
    return { accepted: true, asset: { state: "AVAILABLE" } };
  });
  mocks.execute.mockImplementation(async (sql: TemplateStringsArray) => {
    if (sql.join("").includes("SET state = 'READY'") && row) { row.state = "READY"; row.putOutcome = "CONFIRMED"; row.readyAt = new Date(); return 1; }
    return 0;
  });
});

describe("LOCAL Canvas registry and physical write ordering", () => {
  it("reserves globally before the owner registry, then publishes one verified image", async () => {
    const result = await importCanvasAsset("owner", input);
    expect(mocks.events).toEqual(["prepare", "registry", "put"]);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ sourceProvider: "LOCAL", storageEndpoint: null, storageRegion: null, storageBucket: null, mediaAssetId: prepared().ticket.asset.id }) }));
    expect(result.pending).toBe(false);
    expect(result.asset.url).toBe(`https://app.example.test/media/images/${"a".repeat(64)}`);
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it("READY upload replay precedes current global/owner quota and physical probes", async () => {
    row = { ...canvasAssetRow({ ...input.declaration, mediaAssetId: prepared().ticket.asset.id }), mediaAsset: { ...media(), state: "AVAILABLE", activeObjectId: "object" } };
    expect((await importCanvasAsset("owner", input)).pending).toBe(false);
    expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.verify).not.toHaveBeenCalled(); expect(mocks.put).not.toHaveBeenCalled();
  });
  it("a definite owner quota rejection releases only a proven unattempted ticket", async () => {
    mocks.create.mockRejectedValue(new CanvasContractError("CANVAS_QUOTA_EXCEEDED"));
    await expect(importCanvasAsset("owner", input)).rejects.toMatchObject({ code: "CANVAS_QUOTA_EXCEEDED" });
    expect(mocks.put).not.toHaveBeenCalled(); expect(mocks.abandon).toHaveBeenCalledWith(expect.anything(), true);
  });
  it("uncertain registry commit never performs PUT or claims absence", async () => {
    mocks.transaction.mockRejectedValueOnce(new Error("lost registry commit ACK"));
    await expect(importCanvasAsset("owner", input)).rejects.toThrow("lost registry commit ACK");
    expect(mocks.put).not.toHaveBeenCalled(); expect(mocks.abandon).toHaveBeenCalledWith(expect.anything(), false);
  });
  it("a concurrent upload replay can register a pending identity but cannot PUT the first caller's grant", async () => {
    mocks.prepare.mockResolvedValue({ ...prepared(), ticket: { ...prepared().ticket, writeGranted: false } });
    expect((await importCanvasAsset("owner", input)).pending).toBe(true);
    expect(mocks.put).not.toHaveBeenCalled(); expect(mocks.finish).not.toHaveBeenCalled();
  });
});
