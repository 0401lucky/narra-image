import { beforeEach, describe, expect, it, vi } from "vitest";
import { GenerationStatus } from "@prisma/client";

const {
  mockDeleteMany,
  mockFinalizeAndRefund,
  mockFindMany,
  mockRequireAdminRecord,
  mockTransaction,
  mockUpdateMany,
  mockUserUpdate,
} = vi.hoisted(() => ({
  mockDeleteMany: vi.fn(),
  mockFinalizeAndRefund: vi.fn(),
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

vi.mock("@/lib/generation/job-refund", () => ({
  failGenerationJobAndRefundInTransaction: mockFinalizeAndRefund,
}));

vi.mock("@/lib/server/current-user", () => ({
  requireAdminRecord: mockRequireAdminRecord,
}));

import { DELETE } from "@/app/api/admin/generations/route";

describe("后台生成记录接口", () => {
  beforeEach(() => {
    mockDeleteMany.mockReset();
    mockFindMany.mockReset();
    mockFinalizeAndRefund.mockReset();
    mockRequireAdminRecord.mockReset();
    mockTransaction.mockReset();
    mockUpdateMany.mockReset();
    mockUserUpdate.mockReset();
    mockTransaction.mockImplementation((callback) => callback(tx));
    mockFindMany.mockResolvedValue([]);
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockFinalizeAndRefund.mockResolvedValue({
      refundedCredits: 0,
      updated: true,
    });
  });

  it("可批量删除选中的生成任务，并对重复 id 去重", async () => {
    mockRequireAdminRecord.mockResolvedValue({ id: "admin_1" });
    mockFindMany.mockResolvedValue([
      {
        _count: { attempts: 0 },
        contractVersion: 0,
        creditsSpent: 0,
        id: "job_1",
        status: GenerationStatus.SUCCEEDED,
      },
      {
        _count: { attempts: 0 },
        contractVersion: 0,
        creditsSpent: 0,
        id: "job_2",
        status: GenerationStatus.SUCCEEDED,
      },
    ]);
    mockDeleteMany.mockResolvedValue({ count: 1 });

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
        deletedIds: ["job_1", "job_2"],
        refundedCredits: 0,
      },
    });
    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ["job_1", "job_2"],
        },
      },
      select: expect.any(Object),
    });
    expect(mockDeleteMany).toHaveBeenCalledTimes(2);
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
        _count: { attempts: 0 },
        contractVersion: 0,
        creditsSpent: 20,
        id: "job_1",
        status: GenerationStatus.PENDING,
      },
      {
        _count: { attempts: 0 },
        contractVersion: 0,
        creditsSpent: 5,
        id: "job_2",
        status: GenerationStatus.FAILED,
      },
      {
        _count: { attempts: 0 },
        contractVersion: 0,
        creditsSpent: 20,
        id: "job_3",
        status: GenerationStatus.SUCCEEDED,
      },
    ]);
    mockDeleteMany.mockResolvedValue({ count: 1 });
    mockFinalizeAndRefund
      .mockResolvedValueOnce({ refundedCredits: 20, updated: true })
      .mockResolvedValueOnce({ refundedCredits: 5, updated: true });

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
        deletedIds: ["job_1", "job_2", "job_3"],
        refundedCredits: 25,
      },
    });
    expect(mockFinalizeAndRefund).toHaveBeenCalledTimes(2);
  });

  it("v1 或存在 attempt 的记录保留协调证据", async () => {
    mockRequireAdminRecord.mockResolvedValue({ id: "admin_1" });
    mockFindMany.mockResolvedValue([
      {
        _count: { attempts: 1 },
        contractVersion: 1,
        creditsSpent: 20,
        id: "job_v1",
        status: GenerationStatus.FAILED,
      },
    ]);

    const response = await DELETE(
      new Request("http://localhost/api/admin/generations", {
        body: JSON.stringify({ ids: ["job_v1"] }),
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        deleted: 0,
        deletedIds: [],
        protectedIds: ["job_v1"],
        refundedCredits: 0,
      },
    });
    expect(mockFinalizeAndRefund).not.toHaveBeenCalled();
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });
});
