import { ShowcaseStatus } from "@prisma/client";
import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  mockCount,
  mockCreate,
  mockDelete,
  mockFindUnique,
  mockFindWork,
  mockGetCurrentUser,
  mockTransaction,
} = vi.hoisted(() => ({
  mockCount: vi.fn(),
  mockCreate: vi.fn(),
  mockDelete: vi.fn(),
  mockFindUnique: vi.fn(),
  mockFindWork: vi.fn(),
  mockGetCurrentUser: vi.fn(),
  mockTransaction: vi.fn(async (callback) =>
    callback({
      workLike: {
        count: mockCount,
        create: mockCreate,
        delete: mockDelete,
        findUnique: mockFindUnique,
      },
    }),
  ),
}));

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: mockTransaction,
    generationImage: {
      findUnique: mockFindWork,
    },
  },
}));

vi.mock("@/lib/server/current-user", () => ({
  getCurrentUserRecord: mockGetCurrentUser,
}));

import { PUT } from "@/app/api/works/[id]/like/route";

describe("作品点赞接口", () => {
  beforeEach(() => {
    mockCount.mockReset();
    mockCreate.mockReset();
    mockDelete.mockReset();
    mockFindUnique.mockReset();
    mockFindWork.mockReset();
    mockGetCurrentUser.mockReset();
    mockTransaction.mockClear();
  });

  it("未登录时拒绝点赞", async () => {
    mockGetCurrentUser.mockResolvedValue(null);

    const response = await PUT(new Request("https://example.com"), {
      params: Promise.resolve({ id: "work_1" }),
    });

    expect(response.status).toBe(401);
  });

  it("公开作品未点赞时创建点赞记录", async () => {
    mockGetCurrentUser.mockResolvedValue({ id: "user_1" });
    mockFindWork.mockResolvedValue({
      id: "work_1",
      showcaseStatus: ShowcaseStatus.FEATURED,
    });
    mockFindUnique.mockResolvedValue(null);
    mockCount.mockResolvedValue(8);

    const response = await PUT(new Request("https://example.com"), {
      params: Promise.resolve({ id: "work_1" }),
    });

    await expect(response.json()).resolves.toEqual({
      data: {
        likeCount: 8,
        liked: true,
      },
    });
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        userId: "user_1",
        workId: "work_1",
      },
    });
  });

  it("已经点赞时再次点击会取消点赞", async () => {
    mockGetCurrentUser.mockResolvedValue({ id: "user_1" });
    mockFindWork.mockResolvedValue({
      id: "work_1",
      showcaseStatus: ShowcaseStatus.FEATURED,
    });
    mockFindUnique.mockResolvedValue({ id: "like_1" });
    mockCount.mockResolvedValue(7);

    const response = await PUT(new Request("https://example.com"), {
      params: Promise.resolve({ id: "work_1" }),
    });

    await expect(response.json()).resolves.toEqual({
      data: {
        likeCount: 7,
        liked: false,
      },
    });
    expect(mockDelete).toHaveBeenCalled();
  });
});
