// @vitest-environment node

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), getByAssetId: vi.fn(), read: vi.fn(), remote: vi.fn() }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ APP_URL: "https://app.unit.invalid" }) }));
vi.mock("@/lib/storage/managed-image-storage", () => ({ resolveManagedImageUrl: mocks.resolve, readManagedImage: mocks.read }));
vi.mock("@/lib/storage/image-repository", () => ({ ImageRepository: class { getByAssetId = mocks.getByAssetId; } }));
vi.mock("@/lib/server/current-user", () => ({ getCurrentUserRecord: async () => ({ id: "referencing-owner" }) }));
vi.mock("@/lib/server/safe-remote-url", () => ({ fetchPublicHttpUrl: mocks.remote }));

import { downloadExternalImage } from "@/lib/external-api/source-images";
import { formatImageGenerationData } from "@/lib/external-api/images";
import { GET as download } from "@/app/api/proxy-image/route";

const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const publicUrl = `http://127.0.0.1:1/media/images/${"a".repeat(64)}`;
beforeEach(() => {
  vi.clearAllMocks(); mocks.resolve.mockResolvedValue({ asset: { ownerId: "source-owner", byteLength: String(bytes.length), mimeType: "image/png" } }); mocks.read.mockResolvedValue(bytes);
});

describe("registered image consumers avoid public HTTP round trips", () => {
  it("external API edit/reference input reads the registered bytes before public URL validation", async () => {
    const image = await downloadExternalImage(publicUrl, 1);
    expect(image).toEqual({ data: bytes, fileName: "source-2.png", mimeType: "image/png" });
    expect(mocks.resolve).toHaveBeenCalledWith(publicUrl);
  });
  it("b64 output encodes the same registered bytes", async () => {
    const result = await formatImageGenerationData([{ url: publicUrl, width: null, height: null }], "b64_json");
    expect(result[0]).toMatchObject({ b64_json: bytes.toString("base64") });
  });
  it("projects an adopted source URL and reads b64 by its logical asset after a replica switch", async () => {
    const originalUrl = "https://old-r2.unit.invalid/adopted.png";
    const publicToken = "b".repeat(64);
    const image = { url: originalUrl, width: null, height: null, mediaAssetId: "00000000-0000-4000-8000-000000000001",
      mediaAsset: { state: "AVAILABLE", activeObjectId: "new-local-copy", publicToken } };
    const current = { asset: { id: image.mediaAssetId, byteLength: String(bytes.length), mimeType: "image/png" }, object: { id: "new-local-copy" } };
    mocks.getByAssetId.mockResolvedValue(current);
    const result = await formatImageGenerationData([image], "b64_json");
    expect(result).toEqual([{ url: `https://app.unit.invalid/media/images/${publicToken}`, b64_json: bytes.toString("base64"), width: null, height: null }]);
    expect(mocks.getByAssetId).toHaveBeenCalledWith(image.mediaAssetId);
    expect(mocks.read).toHaveBeenCalledWith(current);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(image.url).toBe(originalUrl);
  });
  it("proxy download preserves content and attachment headers without external fetch", async () => {
    const response = await download(new Request(`http://app.test/api/proxy-image?url=${encodeURIComponent(publicUrl)}`));
    expect(response.status).toBe(200); expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes); expect(mocks.remote).not.toHaveBeenCalled();
  });
  it("keeps each consumer's pre-read byte bound", async () => {
    mocks.resolve.mockResolvedValue({ asset: { byteLength: String(26 * 1024 * 1024), mimeType: "image/png" } });
    await expect(downloadExternalImage(publicUrl)).rejects.toThrow("10MB");
    await expect(formatImageGenerationData([{ url: publicUrl, width: null, height: null }], "b64_json")).rejects.toThrow("b64_json");
    expect((await download(new Request(`http://app.test/api/proxy-image?url=${encodeURIComponent(publicUrl)}`))).status).toBe(413);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it.each(["url", "b64_json"] as const)("rejects a cleaned image batch before formatting %s or reading any bytes", async (format) => {
    await expect(formatImageGenerationData([
      { url: publicUrl, width: null, height: null },
      { url: publicUrl, width: null, height: null, mediaAssetId: "cleaned_asset", mediaAsset: { state: "DELETED", activeObjectId: null } },
    ], format)).rejects.toMatchObject({ code: "IMAGE_UNAVAILABLE" });
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("fails closed for a linked image whose availability join is missing", async () => {
    await expect(formatImageGenerationData([
      { url: publicUrl, width: null, height: null, mediaAssetId: "missing_asset" },
    ], "url")).rejects.toMatchObject({ code: "IMAGE_UNAVAILABLE" });
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
