import type { Prisma } from "@prisma/client";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $queryRaw: mocks.query } }));
vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  return {
    ...actual,
    S3Client: class {
      send = mocks.send;
      destroy = vi.fn();
    },
  };
});

function configureProductionDatabaseStorage() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("APP_URL", "https://narra.example.com");
  vi.stubEnv("AUTH_SECRET", "production-test-secret-with-at-least-32-characters");
  vi.stubEnv("ENABLE_DATABASE_IMAGE_STORAGE", "true");
  vi.stubEnv("ENABLE_LOCAL_IMAGE_FALLBACK", "false");
}

function configureS3() {
  vi.stubEnv("S3_ENDPOINT", "https://s3.example.test");
  vi.stubEnv("S3_BUCKET", "test-bucket");
  vi.stubEnv("S3_ACCESS_KEY_ID", "fixture-key");
  vi.stubEnv("S3_SECRET_ACCESS_KEY", "fixture-secret");
  vi.stubEnv("S3_PUBLIC_BASE_URL", "https://cdn.example.test");
}

describe("persistGeneratedImage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    vi.resetModules();

    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("APP_URL", "http://localhost:3000");
    vi.stubEnv("AUTH_SECRET", "unit-test-secret");
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@127.0.0.1:1/test");
    vi.stubEnv("ENABLE_DATABASE_IMAGE_STORAGE", "false");
    vi.stubEnv("ENABLE_LOCAL_IMAGE_FALLBACK", "true");
    vi.stubEnv("IMAGE_STORAGE_MANAGED_ENABLED", "false");
    vi.stubEnv("IMAGE_STORAGE_BACKEND", "s3");
    vi.stubEnv("IMAGE_STORAGE_PATH", path.resolve("fixture-images"));
    vi.stubEnv("IMAGE_STORAGE_VOLUME_ID", "00112233-4455-4677-8899-aabbccddeeff");
    vi.stubEnv("S3_REGION", "auto");
    for (const name of ["S3_ACCESS_KEY_ID", "S3_BUCKET", "S3_ENDPOINT", "S3_PUBLIC_BASE_URL", "S3_SECRET_ACCESS_KEY"]) {
      vi.stubEnv(name, "");
    }
    mocks.query.mockImplementation(async (query: Prisma.Sql) => {
      if (query.text !== "SELECT image_resolve_url($1::text,$2::text) AS result"
        || query.values.length !== 2 || ![
          "https://temporary.example.com/generated.webp",
          "https://temporary.example.com/reference.webp",
        ].includes(String(query.values[0])) || query.values[1] !== null) {
        throw new Error("Unexpected database query in external image fixture");
      }
      return [{ result: null }];
    });
    mocks.send.mockRejectedValue(new Error("Unexpected object storage IO in image fixture"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.query.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]);
  });

  it("生产数据库存图不依赖开发回退并保留完整参考图字节", async () => {
    configureProductionDatabaseStorage();
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
    configureProductionDatabaseStorage();
    const bytes = new Uint8Array([1, 2, 3]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes, { headers: { "content-type": "image/webp" } })));
    const { persistGeneratedImage } = await import("@/lib/storage/persist-generated-image");
    await expect(persistGeneratedImage({ url: "https://temporary.example.com/reference.webp", userId: "user-1" }))
      .resolves.toBe("data:image/webp;base64,AQID");
  });

  it("已有 S3 时数据库开关仍保留 S3 的原始字节和公开地址", async () => {
    configureProductionDatabaseStorage();
    configureS3();
    mocks.send.mockResolvedValue({ $metadata: { httpStatusCode: 200 } });
    const bytes = Buffer.from([1, 2, 3]);
    const { persistGeneratedImage } = await import("@/lib/storage/persist-generated-image");
    const result = await persistGeneratedImage({ buffer: bytes, mimeType: "image/webp", fileExtension: "webp", userId: "user-1" });
    const command = mocks.send.mock.calls[0][0];
    expect(command.input).toMatchObject({ Body: bytes, Bucket: "test-bucket", ContentType: "image/webp" });
    expect(command.input.Key).toMatch(/^user-1\/[0-9a-f-]+\.webp$/);
    expect(result).toBe(`https://cdn.example.test/${command.input.Key}`);
  });

  it("S3 写入失败时不因数据库开关改走 B64", async () => {
    configureProductionDatabaseStorage();
    configureS3();
    const failure = new Error("fixture S3 PUT failed");
    mocks.send.mockRejectedValue(failure);
    const { persistGeneratedImage } = await import("@/lib/storage/persist-generated-image");
    await expect(persistGeneratedImage({ buffer: Buffer.from([1, 2, 3]), userId: "user-1" })).rejects.toBe(failure);
  });

  it.each(["local", "s3"] as const)("数据库开关不能绕过受管理 %s 的图片额度", async (backend) => {
    configureProductionDatabaseStorage();
    configureS3();
    vi.stubEnv("IMAGE_STORAGE_MANAGED_ENABLED", "true");
    vi.stubEnv("IMAGE_STORAGE_BACKEND", backend);
    const { ImageRepository } = await import("@/lib/storage/image-repository");
    const { ImageStorageError, imageLocalLocation, imageS3Location } = await import("@/lib/storage/image-contract");
    const location = backend === "local"
      ? imageLocalLocation("00112233-4455-4677-8899-aabbccddeeff")
      : imageS3Location({ endpoint: "https://s3.example.test", region: "auto", bucket: "test-bucket", publicBaseUrl: "https://cdn.example.test" });
    vi.spyOn(ImageRepository.prototype, "registerLocation").mockResolvedValue({ ...location, physicalNamespace: "fixture", createdAt: "2026-11-16T00:00:00Z" });
    vi.spyOn(ImageRepository.prototype, "reserveInput").mockRejectedValue(new ImageStorageError("IMAGE_QUOTA_EXCEEDED"));
    vi.spyOn(ImageRepository.prototype, "requestQuotaCleanup").mockResolvedValue(null);
    const begin = vi.spyOn(ImageRepository.prototype, "beginObject");
    const bytes = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
    const { persistGeneratedImage } = await import("@/lib/storage/persist-generated-image");
    await expect(persistGeneratedImage({ buffer: bytes, userId: "user-1" })).rejects.toMatchObject({ code: "IMAGE_QUOTA_EXCEEDED" });
    expect(begin).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("受管理存储缺少 S3 时数据库开关不能补成 B64", async () => {
    configureProductionDatabaseStorage();
    vi.stubEnv("IMAGE_STORAGE_MANAGED_ENABLED", "true");
    const bytes = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
    const { persistGeneratedImage } = await import("@/lib/storage/persist-generated-image");
    await expect(persistGeneratedImage({ buffer: bytes, userId: "user-1" })).rejects.toMatchObject({ code: "IMAGE_STORAGE_UNAVAILABLE" });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it.each(["local", "s3"] as const)("受管理 %s 持久化失败不会退到旧存储路径", async (backend) => {
    configureProductionDatabaseStorage();
    configureS3();
    vi.stubEnv("IMAGE_STORAGE_MANAGED_ENABLED", "true");
    vi.stubEnv("IMAGE_STORAGE_BACKEND", backend);
    const managed = await import("@/lib/storage/managed-image-storage");
    const { ImageStorageError } = await import("@/lib/storage/image-contract");
    const failure = new ImageStorageError("IMAGE_STORAGE_UNAVAILABLE");
    vi.spyOn(managed, "persistManagedImageBytes").mockRejectedValue(failure);
    const { persistGeneratedImage } = await import("@/lib/storage/persist-generated-image");
    await expect(persistGeneratedImage({ buffer: Buffer.from([1, 2, 3]), userId: "user-1" })).rejects.toBe(failure);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("数据库开关不解除受管理 base64 解码前的大小边界", async () => {
    configureProductionDatabaseStorage();
    vi.stubEnv("IMAGE_STORAGE_MANAGED_ENABLED", "true");
    const managed = await import("@/lib/storage/managed-image-storage");
    const persist = vi.spyOn(managed, "persistManagedImageBytes");
    const { MAX_IMAGE_BYTES } = await import("@/lib/storage/image-contract");
    const encoded = "!".repeat(Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 1);
    const { persistGeneratedImage } = await import("@/lib/storage/persist-generated-image");
    await expect(persistGeneratedImage({ b64Json: encoded, userId: "user-1" })).rejects.toMatchObject({ code: "IMAGE_INVALID_INPUT" });
    expect(persist).not.toHaveBeenCalled();
  });

  it("数据库存图保留远程图片大小边界", async () => {
    configureProductionDatabaseStorage();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1]), {
      headers: { "content-type": "image/webp", "content-length": String(50 * 1024 * 1024 + 1) },
    })));
    const { persistGeneratedImage } = await import("@/lib/storage/persist-generated-image");
    await expect(persistGeneratedImage({ url: "https://temporary.example.com/reference.webp", userId: "user-1" })).rejects.toThrow("远程图片过大");
  });

  it("关闭受管理新写入并开启数据库存图后仍拒绝已清理的已知图片", async () => {
    configureProductionDatabaseStorage();
    const time = "2026-11-16T00:00:00Z";
    mocks.query.mockResolvedValueOnce([{ result: {
      asset: {
        id: "00112233-4455-4677-8899-aabbccddeeff", ownerId: "user-1", purpose: "REFERENCE",
        originId: null, publicToken: "a".repeat(64), byteLength: "3", mimeType: "image/webp", sha256: "b".repeat(64),
        state: "DELETED", activeObjectId: null, detachedAt: null, deletedAt: time,
        deleteReason: "RETENTION", createdAt: time, updatedAt: time,
      },
      object: null, location: null,
    } }]).mockResolvedValueOnce([{ result: null }]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { persistGeneratedImage } = await import("@/lib/storage/persist-generated-image");
    await expect(persistGeneratedImage({ url: "https://temporary.example.com/generated.webp", userId: "user-1" })).rejects.toMatchObject({ code: "IMAGE_UNAVAILABLE" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("数据库存图默认关闭且没有任何存储选项时失败", async () => {
    vi.stubEnv("ENABLE_LOCAL_IMAGE_FALLBACK", "false");
    const { persistGeneratedImage } = await import("@/lib/storage/persist-generated-image");
    await expect(persistGeneratedImage({ buffer: Buffer.from([1, 2, 3]), userId: "user-1" }))
      .rejects.toThrow("当前没有可用的图片存储配置");
  });
});
