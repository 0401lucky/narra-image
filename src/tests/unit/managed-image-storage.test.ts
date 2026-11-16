// @vitest-environment node

import { createHash } from "node:crypto";

const mocks = vi.hoisted(() => ({ register: vi.fn(), reserve: vi.fn(), begin: vi.fn(), finish: vi.fn(), close: vi.fn(), alias: vi.fn(), resolve: vi.fn(), getByToken: vi.fn(), schema: vi.fn(), output: vi.fn(), put: vi.fn(), read: vi.fn(), probe: vi.fn(), cleanup: vi.fn(),
  env: { IMAGE_STORAGE_MANAGED_ENABLED: true, IMAGE_STORAGE_BACKEND: "local", IMAGE_STORAGE_PATH: "/unused-fixture", IMAGE_STORAGE_VOLUME_ID: "00112233-4455-4677-8899-aabbccddeeff", APP_URL: "https://images.example.test" } }));
vi.mock("@/lib/env", () => ({ getEnv: () => mocks.env }));
vi.mock("@/lib/storage/image-repository", () => ({ ImageRepository: class {
  registerLocation = mocks.register; reserveInput = mocks.reserve; beginObject = mocks.begin; finishObject = mocks.finish;
  closeReservation = mocks.close; registerAlias = mocks.alias; resolveUrl = mocks.resolve; verifySchema = mocks.schema; reserveOutputs = mocks.output;
  requestQuotaCleanup = mocks.cleanup;
  getByToken = mocks.getByToken;
} }));
vi.mock("@/lib/storage/local-image-store", () => ({ createLocalImageStore: () => ({ put: mocks.put, read: mocks.read, probeWritable: mocks.probe }) }));

import { ImageStorageError, imageLocalLocation } from "@/lib/storage/image-contract";
import { completeManagedImageWrite, detectManagedImageMime, prepareManagedImageWrite, reserveManagedImageOutputs, resolveManagedImageUrl } from "@/lib/storage/managed-image-storage";

const bytes = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const token = "a".repeat(64);
const location = imageLocalLocation(mocks.env.IMAGE_STORAGE_VOLUME_ID);
const reservation = { id: "reservation", token: "fence" };
const ticket = () => ({ writeGranted: true, asset: { id: "asset", state: "PENDING", publicToken: token }, object: { id: "object", key: "images/one.png", writeToken: "write-fence", state: "WRITING", sha256, mimeType: "image/png", byteLength: String(bytes.length) } });

beforeEach(() => {
  vi.resetAllMocks(); mocks.env.IMAGE_STORAGE_MANAGED_ENABLED = true;
  mocks.register.mockResolvedValue(location); mocks.reserve.mockResolvedValue(reservation); mocks.begin.mockResolvedValue(ticket());
  mocks.finish.mockResolvedValue({ accepted: true, asset: { state: "AVAILABLE" }, object: { state: "READY" } });
  mocks.close.mockResolvedValue(true);
  mocks.cleanup.mockResolvedValue(null);
  mocks.put.mockResolvedValue(undefined); mocks.probe.mockResolvedValue({ locationId: location.id, volumeId: location.volumeId });
});

describe("managed physical image write boundary", () => {
  it("registers and reserves exact bytes before IO, then confirms the one write", async () => {
    const prepared = await prepareManagedImageWrite({ bytes, ownerId: "owner", purpose: "REFERENCE", key: "images/one.png", intentKey: "upload:one" });
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.reserve).toHaveBeenCalledWith(expect.objectContaining({ byteLength: bytes.length, ownerId: "owner", intentKey: "upload:one" }));
    expect(mocks.begin).toHaveBeenCalledWith(expect.objectContaining({ byteLength: bytes.length, sha256, mimeType: "image/png", purpose: "REFERENCE" }));
    await expect(completeManagedImageWrite(prepared)).resolves.toBe(`https://images.example.test/media/images/${token}`);
    expect(mocks.put).toHaveBeenCalledOnce();
    expect(mocks.finish).toHaveBeenCalledWith(expect.objectContaining({ outcome: "CONFIRMED", objectId: "object", writeToken: "write-fence" }));
    expect(mocks.close).toHaveBeenCalledWith({ reservationId: "reservation", token: "fence" });
  });
  it("does not grant IO when physical quota admission fails", async () => {
    mocks.reserve.mockRejectedValue(new ImageStorageError("IMAGE_QUOTA_EXCEEDED"));
    await expect(prepareManagedImageWrite({ bytes, ownerId: "owner", purpose: "REFERENCE" })).rejects.toMatchObject({ code: "IMAGE_QUOTA_EXCEEDED" });
    expect(mocks.begin).not.toHaveBeenCalled(); expect(mocks.put).not.toHaveBeenCalled();
  });
  it("never retries a prior write grant, whether READY or still uncertain", async () => {
    mocks.begin.mockResolvedValue({ ...ticket(), writeGranted: false });
    const pending = await prepareManagedImageWrite({ bytes, ownerId: "owner", purpose: "REFERENCE" });
    await expect(completeManagedImageWrite(pending)).rejects.toMatchObject({ code: "IMAGE_WRITE_CONFLICT" });
    mocks.begin.mockResolvedValue({ ...ticket(), writeGranted: false, asset: { ...ticket().asset, state: "AVAILABLE" }, object: { ...ticket().object, state: "READY" } });
    const ready = await prepareManagedImageWrite({ bytes, ownerId: "owner", purpose: "REFERENCE" });
    await expect(completeManagedImageWrite(ready)).resolves.toContain(`/media/images/${token}`);
    expect(mocks.put).not.toHaveBeenCalled(); expect(mocks.finish).not.toHaveBeenCalled();
  });
  it("retains an UNKNOWN receipt after an attempted IO error", async () => {
    const prepared = await prepareManagedImageWrite({ bytes, ownerId: "owner", purpose: "REFERENCE" });
    mocks.put.mockRejectedValue(new Error("lost receipt"));
    await expect(completeManagedImageWrite(prepared)).rejects.toMatchObject({ code: "IMAGE_STORAGE_UNAVAILABLE" });
    expect(mocks.put).toHaveBeenCalledOnce();
    expect(mocks.finish).toHaveBeenCalledWith(expect.objectContaining({ outcome: "UNKNOWN" }));
    expect(mocks.finish).not.toHaveBeenCalledWith(expect.objectContaining({ outcome: "NOT_WRITTEN" }));
  });
  it("releases a proven unattempted write when alias setup fails", async () => {
    mocks.alias.mockRejectedValue(new Error("alias transaction failed"));
    await expect(prepareManagedImageWrite({ bytes, ownerId: "owner", purpose: "REFERENCE" })).rejects.toThrow();
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.finish).toHaveBeenCalledWith(expect.objectContaining({ outcome: "NOT_WRITTEN" }));
  });
  it("requires runtime schema and writable volume before output quota/debit", async () => {
    mocks.probe.mockRejectedValue(new Error("not writable"));
    await expect(reserveManagedImageOutputs({ ownerId: "owner", intentKey: "job:one", count: 1 })).rejects.toMatchObject({ code: "IMAGE_STORAGE_UNAVAILABLE" });
    expect(mocks.schema).toHaveBeenCalledOnce(); expect(mocks.output).not.toHaveBeenCalled();
  });
  it("resolves public aliases without silently adding an owner restriction", async () => {
    mocks.resolve.mockResolvedValue(null);
    await resolveManagedImageUrl("https://images.example.test/shared");
    expect(mocks.resolve).toHaveBeenCalledWith("https://images.example.test/shared");
    mocks.env.IMAGE_STORAGE_MANAGED_ENABLED = false; mocks.resolve.mockClear();
    await expect(resolveManagedImageUrl("https://legacy.example.test/old")).resolves.toBeNull();
    expect(mocks.resolve).toHaveBeenCalledWith("https://legacy.example.test/old");
  });
  it("resolves the exact same-origin public token independently of aliases and the new-write flag", async () => {
    mocks.env.IMAGE_STORAGE_MANAGED_ENABLED = false;
    const current = { asset: { id: "known-image", publicToken: token }, object: { id: "current-local-copy" } };
    mocks.getByToken.mockResolvedValue(current);
    await expect(resolveManagedImageUrl(`https://images.example.test/media/images/${token}`)).resolves.toBe(current);
    expect(mocks.getByToken).toHaveBeenCalledWith(token);
    expect(mocks.resolve).not.toHaveBeenCalled();
    mocks.getByToken.mockResolvedValue(null);
    await expect(resolveManagedImageUrl(`https://images.example.test/media/images/${token}`)).rejects.toMatchObject({ code: "IMAGE_UNAVAILABLE" });
    mocks.resolve.mockRejectedValue(new ImageStorageError("IMAGE_INTERNAL_ERROR"));
    await expect(resolveManagedImageUrl("https://old-r2.invalid/source.png")).rejects.toMatchObject({ code: "IMAGE_INTERNAL_ERROR" });
  });
  it.each(["<svg onload='run()'/>", "<html>image</html>", "", "%PDF-1.0"])("rejects active/non-image bytes before publishing on the app origin", (value) => {
    expect(() => detectManagedImageMime(Buffer.from(value))).toThrow(ImageStorageError);
  });
});
