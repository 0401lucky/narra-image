import { beforeEach, describe, expect, it, vi } from "vitest";
import { GenerationClientSource } from "@prisma/client";

const { mockCount, mockUpsert } = vi.hoisted(() => ({
  mockCount: vi.fn(),
  mockUpsert: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    apiConfig: {
      upsert: mockUpsert,
    },
    generationJob: {
      count: mockCount,
    },
  },
}));

import { assertApiRateLimit } from "@/lib/api-config";

describe("API 统一速率限制", () => {
  beforeEach(() => {
    mockCount.mockReset();
    mockUpsert.mockReset();
    mockUpsert.mockResolvedValue({
      isEnabled: true,
      requestsPerDay: 500,
      requestsPerMinute: 20,
      updatedAt: new Date("2026-05-05T12:00:00.000Z"),
    });
  });

  it("未达到限制时允许继续", async () => {
    mockCount.mockResolvedValueOnce(3).mockResolvedValueOnce(20);

    await expect(assertApiRateLimit("key_1")).resolves.toBeUndefined();
    expect(mockCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          apiKeyId: "key_1",
          clientSource: GenerationClientSource.API,
        }),
      }),
    );
  });

  it("超过每分钟限制时拒绝", async () => {
    mockCount.mockResolvedValueOnce(20).mockResolvedValueOnce(20);

    await expect(assertApiRateLimit("key_1")).rejects.toThrow("请求过于频繁");
  });

  it("超过每天限制时拒绝", async () => {
    mockCount.mockResolvedValueOnce(3).mockResolvedValueOnce(500);

    await expect(assertApiRateLimit("key_1")).rejects.toThrow("今日 API 调用已达上限");
  });

  it("后台关闭 API 时拒绝", async () => {
    mockUpsert.mockResolvedValue({
      isEnabled: false,
      requestsPerDay: 500,
      requestsPerMinute: 20,
      updatedAt: new Date("2026-05-05T12:00:00.000Z"),
    });

    await expect(assertApiRateLimit("key_1")).rejects.toThrow("站点 API 当前已关闭");
    expect(mockCount).not.toHaveBeenCalled();
  });
});
