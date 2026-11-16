// @vitest-environment node

const mocks = vi.hoisted(() => ({ get: vi.fn(), open: vi.fn(), head: vi.fn() }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ IMAGE_STORAGE_MANAGED_ENABLED: true, IMAGE_STORAGE_VOLUME_ID: "00112233-4455-4677-8899-aabbccddeeff", IMAGE_STORAGE_PATH: "/unused-fixture" }) }));
vi.mock("@/lib/storage/image-repository", () => ({ ImageRepository: class {
  getByToken = mocks.get;
  beginRead = async () => ({ image: await mocks.get(), readExpiresAt: new Date(Date.now() + 45_000).toISOString() });
} }));
vi.mock("@/lib/storage/local-image-store", async (original) => ({ ...await original<typeof import("@/lib/storage/local-image-store")>(), createLocalImageStore: () => ({ open: mocks.open, head: mocks.head }) }));

import { LocalImageStoreError, type LocalImageStoreErrorCode } from "@/lib/storage/local-image-store";
import { GET, HEAD } from "@/app/media/images/[token]/route";

const token = "a".repeat(64);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockResolvedValue({ asset: { id: "00112233-4455-4677-8899-aabbccddeeff", state: "AVAILABLE", byteLength: "3", mimeType: "image/png", sha256: "b".repeat(64) },
    object: { state: "READY", key: "images/one.png", byteLength: "3", sha256: "b".repeat(64) },
    location: { id: "local-v1:00112233-4455-4677-8899-aabbccddeeff", provider: "LOCAL", volumeId: "00112233-4455-4677-8899-aabbccddeeff" } });
});

describe("real local error mapping through the public image route", () => {
  it.each<[LocalImageStoreErrorCode, number]>([
    ["LOCAL_IMAGE_NOT_FOUND", 404], ["LOCAL_IMAGE_VOLUME_MISMATCH", 503], ["LOCAL_IMAGE_VOLUME_UNAVAILABLE", 503],
    ["LOCAL_IMAGE_STORAGE_UNAVAILABLE", 503], ["LOCAL_IMAGE_CONTENT_MISMATCH", 503], ["LOCAL_IMAGE_UNSAFE_PATH", 503],
  ])("%s produces %i without exposing storage details", async (code, status) => {
    mocks.open.mockRejectedValue(new LocalImageStoreError(code)); mocks.head.mockRejectedValue(new LocalImageStoreError(code));
    for (const handler of [GET, HEAD]) {
      const response = await handler(new Request(`http://app.test/media/images/${token}`), { params: Promise.resolve({ token }) });
      expect(response.status).toBe(status); expect(await response.text()).toBe(""); expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });
});
