import { beforeEach, describe, expect, it, vi } from "vitest";
import { GenerationStatus } from "@prisma/client";

const {
  mockDeleteMany,
  mockFindMany,
  mockRequireAdminRecord,
  mockTransaction,
  mockUpdateMany,
  mockUserUpdate,
} = vi.hoisted(() => ({
  mockDeleteMany: vi.fn(),
  mockFindMany: vi.fn(),
  mockRequireAdminRecord: vi.fn(),
  mockTransaction: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockUserUpdate: vi.fn(),
}));

const tx = {
  generationJob: {
    deleteMany: mockDeleteMany,
    findMany: mockFindMany,
    updateMany: mockUpdateMany,
  },
  user: {
    update: mockUserUpdate,
  },
};

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: mockTransaction,
  },
}));

vi.mock("@/lib/server/current-user", () => ({
  requireAdminRecord: mockRequireAdminRecord,
}));

import { DELETE } from "@/app/api/admin/generations/route";

describe("后台生成记录接口", () => {
  beforeEach(() => {
    mockDeleteMany.mockReset();
    mockFindMany.mockReset();
    mockRequireAdminRecord.mockReset();
    mockTransaction.mockReset();
    mockUpdateMany.mockReset();
    mockUserUpdate.mockReset();
    mockTransaction.mockImplementation((callback) => callback(tx));
    mockFindMany.mockResolvedValue([]);
    mockUpdateMany.mockResolvedValue({ count: 1 });
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
        refundedCredits: 0,
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

  it("删除未完成任务时退还预扣积分", async () => {
    mockRequireAdminRecord.mockResolvedValue({ id: "admin_1" });
    mockFindMany.mockResolvedValue([
      {
        creditsSpent: 20,
        id: "job_1",
        status: GenerationStatus.PENDING,
        userId: "user_1",
      },
      {
        creditsSpent: 5,
        id: "job_2",
        status: GenerationStatus.FAILED,
        userId: "user_1",
      },
      {
        creditsSpent: 20,
        id: "job_3",
        status: GenerationStatus.SUCCEEDED,
        userId: "user_1",
      },
    ]);
    mockDeleteMany.mockResolvedValue({ count: 3 });

    const response = await DELETE(
      new Request("http://localhost/api/admin/generations", {
        body: JSON.stringify({ ids: ["job_1", "job_2", "job_3"] }),
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        deleted: 3,
        ids: ["job_1", "job_2", "job_3"],
        refundedCredits: 25,
      },
    });
    expect(mockUserUpdate).toHaveBeenCalledWith({
      data: {
        credits: {
          increment: 25,
        },
      },
      where: { id: "user_1" },
    });
    expect(mockUpdateMany).toHaveBeenCalledTimes(2);
  });
});
