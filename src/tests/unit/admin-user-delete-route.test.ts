import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFindUnique,
  mockRequireAdminRecord,
  mockUserDelete,
} = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockRequireAdminRecord: vi.fn(),
  mockUserDelete: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      delete: mockUserDelete,
      findUnique: mockFindUnique,
    },
  },
}));

vi.mock("@/lib/server/current-user", () => ({
  requireAdminRecord: mockRequireAdminRecord,
}));

import { DELETE } from "@/app/api/admin/users/[id]/route";

describe("后台用户删除接口", () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
    mockRequireAdminRecord.mockReset();
    mockUserDelete.mockReset();
  });

  it("管理员可删除其他用户", async () => {
    mockRequireAdminRecord.mockResolvedValue({ id: "admin_1" });
    mockFindUnique.mockResolvedValue({ id: "user_2", email: "victim@example.com" });
    mockUserDelete.mockResolvedValue({ id: "user_2" });

    const response = await DELETE(new Request("https://example.com"), {
      params: Promise.resolve({ id: "user_2" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        deleted: { id: "user_2", email: "victim@example.com" },
      },
    });
    expect(mockUserDelete).toHaveBeenCalledWith({ where: { id: "user_2" } });
  });

  it("禁止管理员删除自己", async () => {
    mockRequireAdminRecord.mockResolvedValue({ id: "admin_1" });

    const response = await DELETE(new Request("https://example.com"), {
      params: Promise.resolve({ id: "admin_1" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "不能删除自己的账号",
    });
    expect(mockUserDelete).not.toHaveBeenCalled();
  });

  it("目标用户不存在时返回 404", async () => {
    mockRequireAdminRecord.mockResolvedValue({ id: "admin_1" });
    mockFindUnique.mockResolvedValue(null);

    const response = await DELETE(new Request("https://example.com"), {
      params: Promise.resolve({ id: "ghost" }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "用户不存在" });
    expect(mockUserDelete).not.toHaveBeenCalled();
  });

  it("非管理员调用时返回错误", async () => {
    mockRequireAdminRecord.mockRejectedValue(new Error("没有管理员权限"));

    const response = await DELETE(new Request("https://example.com"), {
      params: Promise.resolve({ id: "user_2" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "没有管理员权限" });
    expect(mockUserDelete).not.toHaveBeenCalled();
  });
});
