import type { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getEnv: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/env", () => ({ getEnv: mocks.getEnv }));
vi.mock("@/lib/db", () => ({ db: { $queryRaw: mocks.query } }));

describe("persistGeneratedImage", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    mocks.getEnv.mockReturnValue({ APP_URL: "https://app.invalid", IMAGE_STORAGE_MANAGED_ENABLED: false,
      ENABLE_LOCAL_IMAGE_FALLBACK: true, S3_REGION: "auto" });
    mocks.query.mockImplementation(async (query: Prisma.Sql) => {
      if (query.text !== "SELECT image_resolve_url($1::text,$2::text) AS result"
        || query.values.length !== 2 || query.values[0] !== "https://temporary.example.com/generated.webp" || query.values[1] !== null) {
        throw new Error("Unexpected database query in external image fixture");
      }
      return [{ result: null }];
    });
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
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.query.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]);
  });
});
