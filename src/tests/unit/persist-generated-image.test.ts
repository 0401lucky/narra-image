import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("persistGeneratedImage", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();

    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("APP_URL", "http://localhost:3000");
    vi.stubEnv("AUTH_SECRET", "unit-test-secret");
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@127.0.0.1:1/test");
    vi.stubEnv("ENABLE_DATABASE_IMAGE_STORAGE", "false");
    vi.stubEnv("ENABLE_LOCAL_IMAGE_FALLBACK", "true");
    for (const name of ["S3_ACCESS_KEY_ID", "S3_BUCKET", "S3_ENDPOINT", "S3_PUBLIC_BASE_URL", "S3_SECRET_ACCESS_KEY"]) {
      vi.stubEnv(name, "");
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
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

  it("生产数据库存图不依赖开发回退并保留完整参考图字节", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "https://narra.example.com");
    vi.stubEnv("AUTH_SECRET", "production-test-secret-with-at-least-32-characters");
    vi.stubEnv("ENABLE_DATABASE_IMAGE_STORAGE", "true");
    vi.stubEnv("ENABLE_LOCAL_IMAGE_FALLBACK", "false");
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const { persistGeneratedImage } = await import("@/lib/storage/persist-generated-image");

    for (const input of [
      { buffer: bytes, mimeType: "image/png", userId: "user-1" },
      { b64Json: bytes.toString("base64"), mimeType: "image/png", userId: "user-1" },
    ]) {
      const result = await persistGeneratedImage(input);
      expect(result).toBe(`data:image/png;base64,${bytes.toString("base64")}`);
    }
  });

  it("数据库存图会转存上游 URL 参考图", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "https://narra.example.com");
    vi.stubEnv("AUTH_SECRET", "production-test-secret-with-at-least-32-characters");
    vi.stubEnv("ENABLE_DATABASE_IMAGE_STORAGE", "true");
    vi.stubEnv("ENABLE_LOCAL_IMAGE_FALLBACK", "false");
    const bytes = new Uint8Array([1, 2, 3]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes, { headers: { "content-type": "image/webp" } })));
    const { persistGeneratedImage } = await import("@/lib/storage/persist-generated-image");
    await expect(persistGeneratedImage({ url: "https://temporary.example.com/reference.webp", userId: "user-1" }))
      .resolves.toBe("data:image/webp;base64,AQID");
  });

  it("数据库存图默认关闭且没有任何存储选项时失败", async () => {
    vi.stubEnv("ENABLE_LOCAL_IMAGE_FALLBACK", "false");
    const { persistGeneratedImage } = await import("@/lib/storage/persist-generated-image");
    await expect(persistGeneratedImage({ buffer: Buffer.from([1, 2, 3]), userId: "user-1" }))
      .rejects.toThrow("当前没有可用的图片存储配置");
  });
});
