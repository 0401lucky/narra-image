// @vitest-environment node

import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

const mocks = vi.hoisted(() => ({ beginRead: vi.fn(), send: vi.fn(), destroy: vi.fn(), root: "" }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ IMAGE_STORAGE_MANAGED_ENABLED: true, IMAGE_STORAGE_BACKEND: "local",
  IMAGE_STORAGE_PATH: mocks.root, IMAGE_STORAGE_VOLUME_ID: "37bea8ac-809f-4298-92d8-a3597a8437c6",
  S3_ACCESS_KEY_ID: "fixture-access", S3_SECRET_ACCESS_KEY: "fixture-secret" }) }));
vi.mock("@/lib/storage/image-repository", () => ({ ImageRepository: class { beginRead = mocks.beginRead; } }));
vi.mock("@aws-sdk/client-s3", async (original) => ({ ...await original<typeof import("@aws-sdk/client-s3")>(),
  S3Client: class { send = mocks.send; destroy = mocks.destroy; } }));

import { ImageStorageError, imageLocalLocation, imageS3Location, type ManagedImage } from "@/lib/storage/image-contract";
import { createLocalImageStore, initializeLocalImageVolume } from "@/lib/storage/local-image-store";
import { headManagedImage, openManagedImage, readManagedImage } from "@/lib/storage/managed-image-storage";

const bytes = Buffer.from("guarded image bytes");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const assetId = "00112233-4455-4677-8899-aabbccddeeff";
const objectId = "11223344-5566-4788-99aa-bbccddeeff00";
const stamp = "2026-01-01T00:00:00.000Z";
const directories: string[] = [];
function managedImage(): ManagedImage {
  const location = imageLocalLocation("37bea8ac-809f-4298-92d8-a3597a8437c6");
  return { asset: { id: assetId, ownerId: "owner", purpose: "REFERENCE", originId: null, publicToken: "a".repeat(64),
    byteLength: String(bytes.length), mimeType: "image/png", sha256, state: "AVAILABLE", activeObjectId: objectId,
    detachedAt: stamp, deletedAt: null, deleteReason: null, createdAt: stamp, updatedAt: stamp },
    object: { id: objectId, assetId, provenance: "WRITE", sourceObservationId: null, reconciliationObservationId: null,
      reservationId: "22334455-6677-4899-aabb-ccddeeff0011", slot: 0,
      locationId: location.id, physicalNamespace: location.id, key: "images/guarded.png", byteLength: String(bytes.length), mimeType: "image/png", sha256,
      state: "READY", writeToken: "44556677-8899-4abb-ccdd-eeff00112233", writeExpiresAt: stamp, putOutcome: "CONFIRMED", versionId: null,
      accounted: true, needsReconciliation: false, deleteToken: null, deleteExpiresAt: null, deleteOutcome: "NOT_STARTED", deleteAttempts: 0,
      nextDeleteAt: null, deletedAt: null, lastErrorCode: null, createdAt: stamp, updatedAt: stamp },
    location: { ...location, physicalNamespace: location.id, createdAt: stamp } };
}
function lease(image: ManagedImage, milliseconds = 45_000) { return { image, readExpiresAt: new Date(Date.now() + milliseconds).toISOString() }; }

beforeEach(async () => {
  vi.resetAllMocks();
  mocks.root = await mkdtemp(path.join(tmpdir(), "narra-image-read-fence-"));
  directories.push(mocks.root);
  const config = { rootDirectory: mocks.root, volumeId: "37bea8ac-809f-4298-92d8-a3597a8437c6" };
  await initializeLocalImageVolume(config);
  await createLocalImageStore(config).put({ key: "images/guarded.png", bytes, byteLength: bytes.length, sha256 });
  mocks.beginRead.mockImplementation(async () => lease(managedImage()));
});
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    const target = path.resolve(directory);
    if (path.dirname(target) !== path.resolve(tmpdir()) || !path.basename(target).startsWith("narra-image-read-fence-")) throw new Error("Unexpected image read fixture cleanup path");
    await rm(target, { recursive: true, force: true });
  }
});

describe("managed readers share the deletion fence", () => {
  it("uses the fresh protected replica for buffer, HEAD and streaming consumers", async () => {
    const stale = managedImage();
    stale.object = { ...stale.object!, key: "images/old-replica.png" };
    expect(await readManagedImage(stale)).toEqual(bytes);
    await expect(headManagedImage(stale, new AbortController().signal)).resolves.toBeUndefined();
    const stream = await openManagedImage(stale, new AbortController().signal);
    expect(Buffer.from(await new Response(stream).arrayBuffer())).toEqual(bytes);
    expect(mocks.beginRead).toHaveBeenCalledTimes(3);
    expect(mocks.beginRead).toHaveBeenCalledWith({ assetId });
  });
  it("refuses expired/deleting descriptors even while physical bytes still exist", async () => {
    mocks.beginRead.mockResolvedValue(lease(managedImage(), 4_000));
    await expect(readManagedImage(managedImage())).rejects.toMatchObject({ code: "IMAGE_UNAVAILABLE" });
    mocks.beginRead.mockRejectedValue(new ImageStorageError("IMAGE_UNAVAILABLE"));
    await expect(openManagedImage(managedImage(), new AbortController().signal)).rejects.toMatchObject({ code: "IMAGE_UNAVAILABLE" });
  });
  it("does not obtain a reader lease after its caller already cancelled", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(readManagedImage(managedImage(), controller.signal)).rejects.toMatchObject({ code: "IMAGE_UNAVAILABLE" });
    expect(mocks.beginRead).not.toHaveBeenCalled();
  });
  it("closes an already-returned stalled S3 body on cancellation", async () => {
    const image = managedImage();
    const location = imageS3Location({ endpoint: "https://storage.example.test", region: "us-east-1", bucket: "images" });
    image.location = { ...location, physicalNamespace: location.id, createdAt: stamp };
    image.object = { ...image.object!, locationId: location.id, physicalNamespace: location.id };
    mocks.beginRead.mockResolvedValue(lease(image));
    const body = new Readable({ read() {} });
    mocks.send.mockResolvedValue({ Body: body, ContentLength: bytes.length });
    const controller = new AbortController();
    const reading = readManagedImage(image, controller.signal);
    const assertion = expect(reading).rejects.toMatchObject({ code: "IMAGE_STORAGE_UNAVAILABLE" });
    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledOnce());
    controller.abort();
    await assertion;
    expect(body.destroyed).toBe(true);
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });
});
