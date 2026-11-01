import { GenerationStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFindMany,
  mockFindUnique,
  mockTransaction,
  mockUpdateMany,
  mockUpdateUser,
} = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockFindUnique: vi.fn(),
  mockTransaction: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockUpdateUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: mockTransaction,
    generationJob: {
      findMany: mockFindMany,
    },
  },
}));

import {
  failGenerationJobAndRefund,
  failStalePendingGenerationJobs,
} from "@/lib/generation/job-refund";

function createRefundJob(
  input: Partial<{
    attemptCount: number;
    contractVersion: number;
    creditsSpent: number;
    handoffState: "NOT_STARTED" | "SUBMITTING" | "SUBMITTED" | "UNKNOWN" | "RESOLVED" | null;
    id: string;
    nextAttemptAt: Date | null;
    refundAppliedAt: Date | null;
    status: GenerationStatus;
    userId: string;
  }> = {},
) {
  return {
    attemptCount: 0,
    contractVersion: 0,
    creditsSpent: 20,
    handoffState: null,
    id: "job_1",
    nextAttemptAt: null,
    refundAppliedAt: null,
    status: GenerationStatus.PENDING,
    userId: "user_1",
    ...input,
  };
}

describe("生成任务失败退款", () => {
  beforeEach(() => {
    mockFindMany.mockReset();
    mockFindUnique.mockReset();
    mockTransaction.mockReset();
    mockUpdateMany.mockReset();
    mockUpdateUser.mockReset();

    mockTransaction.mockImplementation(async (callback) =>
      callback({
        generationJob: {
          findUnique: mockFindUnique,
          updateMany: mockUpdateMany,
        },
        user: {
          update: mockUpdateUser,
        },
      }),
    );
  });

  it("pending 任务失败时退还预扣积分并清零 creditsSpent", async () => {
    mockFindUnique.mockResolvedValue(createRefundJob());
    mockUpdateMany.mockResolvedValue({ count: 1 });

    await expect(
      failGenerationJobAndRefund({
        allowedStatuses: [GenerationStatus.PENDING],
        errorMessage: "渠道超时",
        jobId: "job_1",
      }),
    ).resolves.toEqual({
      refundedCredits: 20,
      updated: true,
    });
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        creditsSpent: 20,
        id: "job_1",
        refundAppliedAt: null,
        status: {
          in: [GenerationStatus.PENDING],
        },
      }),
      data: expect.objectContaining({
        completedAt: expect.any(Date),
        creditsSpent: 0,
        errorMessage: "渠道超时",
        refundAppliedAt: expect.any(Date),
        status: GenerationStatus.FAILED,
      }),
    });
    expect(mockUpdateUser).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: {
        credits: {
          increment: 20,
        },
      },
    });
  });

  it("已成功任务不会被失败退款逻辑覆盖", async () => {
    mockFindUnique.mockResolvedValue(createRefundJob({
      id: "job_done",
      status: GenerationStatus.SUCCEEDED,
    }));

    await expect(
      failGenerationJobAndRefund({
        errorMessage: "迟到的失败",
        jobId: "job_done",
      }),
    ).resolves.toEqual({
      refundedCredits: 0,
      updated: false,
    });
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it("读取后任务状态变化时不会退款", async () => {
    mockFindUnique.mockResolvedValue(createRefundJob({
      id: "job_raced",
    }));
    mockUpdateMany.mockResolvedValue({ count: 0 });

    await expect(
      failGenerationJobAndRefund({
        allowedStatuses: [GenerationStatus.PENDING],
        errorMessage: "用户取消",
        jobId: "job_raced",
      }),
    ).resolves.toEqual({
      refundedCredits: 0,
      updated: false,
    });
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it.each(["SUBMITTED", "UNKNOWN"] as const)(
    "v1 %s handoff 禁止自动退款",
    async (handoffState) => {
      mockFindUnique.mockResolvedValue(createRefundJob({
        contractVersion: 1,
        handoffState,
        id: `job_${handoffState.toLowerCase()}`,
        status: GenerationStatus.FAILED,
      }));

      await expect(
        failGenerationJobAndRefund({
          errorMessage: "管理员清理",
          jobId: `job_${handoffState.toLowerCase()}`,
        }),
      ).resolves.toEqual({
        blockedByHandoff: true,
        refundedCredits: 0,
        updated: false,
      });
      expect(mockUpdateMany).not.toHaveBeenCalled();
      expect(mockUpdateUser).not.toHaveBeenCalled();
    },
  );

  it("v1 缺失 handoffState 时保守禁止退款", async () => {
    mockFindUnique.mockResolvedValue(createRefundJob({
      contractVersion: 1,
      handoffState: null,
      id: "job_missing_handoff",
    }));

    await expect(
      failGenerationJobAndRefund({
        errorMessage: "页面超时清理",
        jobId: "job_missing_handoff",
      }),
    ).resolves.toEqual({
      blockedByHandoff: true,
      refundedCredits: 0,
      updated: false,
    });
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("零积分 FAILED 任务重复清理保持幂等", async () => {
    mockFindUnique.mockResolvedValue(createRefundJob({
      creditsSpent: 0,
      id: "job_zero_failed",
      status: GenerationStatus.FAILED,
    }));

    await expect(
      failGenerationJobAndRefund({
        errorMessage: "重复清理",
        jobId: "job_zero_failed",
      }),
    ).resolves.toEqual({
      refundedCredits: 0,
      updated: false,
    });
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it("v1 PENDING 已进入 Worker 重试后不会被页面清理", async () => {
    mockFindUnique.mockResolvedValue(createRefundJob({
      attemptCount: 1,
      contractVersion: 1,
      handoffState: "NOT_STARTED",
      id: "job_retry_pending",
      nextAttemptAt: new Date("2026-05-05T12:01:00.000Z"),
    }));

    await expect(
      failGenerationJobAndRefund({
        allowedStatuses: [GenerationStatus.PENDING],
        errorMessage: "页面超时清理",
        jobId: "job_retry_pending",
        onlyUnclaimedV1Pending: true,
      }),
    ).resolves.toEqual({
      blockedByWorkerState: true,
      refundedCredits: 0,
      updated: false,
    });
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("只清理 legacy 超时任务和从未 claim 的 v1 PENDING", async () => {
    const now = new Date("2026-05-05T12:00:00.000Z");
    mockFindMany.mockResolvedValue([
      { id: "job_stale", status: GenerationStatus.PENDING },
    ]);
    mockFindUnique.mockResolvedValue(createRefundJob({
      id: "job_stale",
    }));
    mockUpdateMany.mockResolvedValue({ count: 1 });

    await expect(
      failStalePendingGenerationJobs({
        now,
        olderThanMs: 60_000,
        userId: "user_1",
      }),
    ).resolves.toEqual({
      checked: 1,
      failed: 1,
      refundedCredits: 20,
    });
    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        OR: [
          {
            contractVersion: { lt: 1 },
            createdAt: {
              lt: new Date("2026-05-05T11:59:00.000Z"),
            },
            status: GenerationStatus.PENDING,
          },
          {
            contractVersion: { lt: 1 },
            lockedAt: {
              lt: new Date("2026-05-05T11:59:00.000Z"),
            },
            status: GenerationStatus.PROCESSING,
          },
          {
            attemptCount: 0,
            contractVersion: { gte: 1 },
            createdAt: {
              lt: new Date("2026-05-05T11:59:00.000Z"),
            },
            handoffState: "NOT_STARTED",
            nextAttemptAt: null,
            status: GenerationStatus.PENDING,
          },
        ],
        userId: "user_1",
      },
      select: {
        id: true,
        status: true,
      },
      orderBy: {
        createdAt: "asc",
      },
      take: 50,
    });
  });
});
