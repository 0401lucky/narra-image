import { GenerationStatus } from "@prisma/client";
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

import { POST } from "@/app/api/admin/generations/cleanup-failed/route";

describe("后台失败生成记录清理接口", () => {
  beforeEach(() => {
    mockDeleteMany.mockReset();
    mockRequireAdminRecord.mockReset();
  });

  it("仅清理失败状态的生成任务", async () => {
    mockRequireAdminRecord.mockResolvedValue({ id: "admin_1" });
    mockDeleteMany.mockResolvedValue({ count: 3 });

    const response = await POST();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        deleted: 3,
      },
    });
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: {
        status: GenerationStatus.FAILED,
      },
    });
  });
});
