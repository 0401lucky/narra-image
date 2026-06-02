import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("persistGeneratedImage", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();

    process.env.AUTH_SECRET = "unit-test-secret";
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/test";
    process.env.ENABLE_LOCAL_IMAGE_FALLBACK = "true";
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_BUCKET;
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_PUBLIC_BASE_URL;
    delete process.env.S3_SECRET_ACCESS_KEY;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("远程 URL 图片会下载后再保存，避免持久化临时地址", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/webp" },
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { persistGeneratedImage } = await import(
      "@/lib/storage/persist-generated-image"
    );
    const result = await persistGeneratedImage({
      url: "https://temporary.example.com/generated.webp",
      userId: "user-1",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://temporary.example.com/generated.webp",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result).toBe("data:image/webp;base64,AQID");
  });
});
