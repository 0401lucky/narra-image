import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockBatchDelete,
  mockBatchFindUnique,
  mockBatchUpdate,
  mockInviteCodeDeleteMany,
  mockInviteCodeFindMany,
  mockRequireAdminRecord,
  mockTransaction,
} = vi.hoisted(() => ({
  mockBatchDelete: vi.fn(),
  mockBatchFindUnique: vi.fn(),
  mockBatchUpdate: vi.fn(),
  mockInviteCodeDeleteMany: vi.fn(),
  mockInviteCodeFindMany: vi.fn(),
  mockRequireAdminRecord: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: mockTransaction,
    inviteBatch: {
      delete: mockBatchDelete,
      findUnique: mockBatchFindUnique,
      update: mockBatchUpdate,
    },
    inviteCode: {
      deleteMany: mockInviteCodeDeleteMany,
      findMany: mockInviteCodeFindMany,
    },
  },
}));

vi.mock("@/lib/server/current-user", () => ({
  requireAdminRecord: mockRequireAdminRecord,
}));

import { GET } from "@/app/api/admin/invites/batches/[id]/route";

describe("后台邀请码批次详情接口", () => {
  beforeEach(() => {
    mockBatchDelete.mockReset();
    mockBatchFindUnique.mockReset();
    mockBatchUpdate.mockReset();
    mockInviteCodeDeleteMany.mockReset();
    mockInviteCodeFindMany.mockReset();
    mockRequireAdminRecord.mockReset();
    mockTransaction.mockReset();
  });

  it("按批次返回邀请码详情，供弹窗直接读取 data.codes", async () => {
    const claimedAt = new Date("2026-05-24T01:00:00.000Z");
    const usedAt = new Date("2026-05-24T02:00:00.000Z");

    mockRequireAdminRecord.mockResolvedValue({ id: "admin_1" });
    mockBatchFindUnique.mockResolvedValue({ title: "Ld士多" });
    mockInviteCodeFindMany.mockResolvedValue([
      {
        claimedAt: null,
        code: "OPEN-001",
        id: "invite_1",
        usedAt: null,
        usedBy: null,
      },
      {
        claimedAt,
        code: "CLAIMED-002",
        id: "invite_2",
        usedAt: null,
        usedBy: null,
      },
      {
        claimedAt,
        code: "USED-003",
        id: "invite_3",
        usedAt,
        usedBy: { email: "user@example.com" },
      },
    ]);

    const response = await GET(new Request("https://example.com"), {
      params: Promise.resolve({ id: "batch_1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        codes: [
          {
            claimedAt: null,
            code: "OPEN-001",
            id: "invite_1",
            usedAt: null,
            usedBy: null,
          },
          {
            claimedAt: claimedAt.toISOString(),
            code: "CLAIMED-002",
            id: "invite_2",
            usedAt: null,
            usedBy: null,
          },
          {
            claimedAt: claimedAt.toISOString(),
            code: "USED-003",
            id: "invite_3",
            usedAt: usedAt.toISOString(),
            usedBy: { email: "user@example.com" },
          },
        ],
        title: "Ld士多",
      },
    });
    expect(mockInviteCodeFindMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "asc" },
      select: {
        claimedAt: true,
        code: true,
        id: true,
        usedAt: true,
        usedBy: {
          select: {
            email: true,
          },
        },
      },
      where: { batchId: "batch_1" },
    });
  });

  it("批次不存在时返回明确错误", async () => {
    mockRequireAdminRecord.mockResolvedValue({ id: "admin_1" });
    mockBatchFindUnique.mockResolvedValue(null);

    const response = await GET(new Request("https://example.com"), {
      params: Promise.resolve({ id: "missing_batch" }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "批次不存在" });
    expect(mockInviteCodeFindMany).not.toHaveBeenCalled();
  });
});
