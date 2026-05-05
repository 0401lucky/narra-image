import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDeleteMany, mockRequireAdminRecord } = vi.hoisted(() => ({
  mockDeleteMany: vi.fn(),
  mockRequireAdminRecord: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    generationJob: {
      deleteMany: mockDeleteMany,
    },
  },
}));

vi.mock("@/lib/server/current-user", () => ({
  requireAdminRecord: mockRequireAdminRecord,
}));

import { DELETE } from "@/app/api/admin/generations/route";

describe("后台生成记录接口", () => {
  beforeEach(() => {
    mockDeleteMany.mockReset();
    mockRequireAdminRecord.mockReset();
  });

  it("可批量删除选中的生成任务，并对重复 id 去重", async () => {
    mockRequireAdminRecord.mockResolvedValue({ id: "admin_1" });
    mockDeleteMany.mockResolvedValue({ count: 2 });

    const response = await DELETE(
      new Request("http://localhost/api/admin/generations", {
        body: JSON.stringify({ ids: ["job_1", "job_2", "job_1"] }),
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        deleted: 2,
        ids: ["job_1", "job_2"],
      },
    });
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ["job_1", "job_2"],
        },
      },
    });
  });

  it("未选择记录时拒绝删除", async () => {
    mockRequireAdminRecord.mockResolvedValue({ id: "admin_1" });

    const response = await DELETE(
      new Request("http://localhost/api/admin/generations", {
        body: JSON.stringify({ ids: [] }),
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(400);
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });
});
