import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDelete,
  mockGetWorkMutationTarget,
  mockRequireCurrentUserRecord,
} = vi.hoisted(() => ({
  mockDelete: vi.fn(),
  mockGetWorkMutationTarget: vi.fn(),
  mockRequireCurrentUserRecord: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    generationImage: {
      delete: mockDelete,
    },
  },
}));

vi.mock("@/lib/server/current-user", () => ({
  requireCurrentUserRecord: mockRequireCurrentUserRecord,
}));

vi.mock("@/lib/server/works", () => ({
  getWorkMutationTarget: mockGetWorkMutationTarget,
}));

import { DELETE } from "@/app/api/me/works/[id]/route";

describe("用户作品删除接口", () => {
  beforeEach(() => {
    mockDelete.mockReset();
    mockGetWorkMutationTarget.mockReset();
    mockRequireCurrentUserRecord.mockReset();
  });

  it("允许删除自己的作品数据库记录", async () => {
    mockRequireCurrentUserRecord.mockResolvedValue({ id: "user_1" });
    mockGetWorkMutationTarget.mockResolvedValue({
      job: {
        userId: "user_1",
      },
    });
    mockDelete.mockResolvedValue({ id: "work_1" });

    const response = await DELETE(new Request("https://example.com"), {
      params: Promise.resolve({ id: "work_1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        id: "work_1",
      },
    });
    expect(mockDelete).toHaveBeenCalledWith({
      where: {
        id: "work_1",
      },
    });
  });

  it("拒绝删除他人的作品", async () => {
    mockRequireCurrentUserRecord.mockResolvedValue({ id: "user_1" });
    mockGetWorkMutationTarget.mockResolvedValue({
      job: {
        userId: "user_2",
      },
    });

    const response = await DELETE(new Request("https://example.com"), {
      params: Promise.resolve({ id: "work_1" }),
    });

    expect(response.status).toBe(404);
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
