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
    mockFindUnique.mockResolvedValue({
      creditsSpent: 20,
      id: "job_1",
      status: GenerationStatus.PENDING,
      userId: "user_1",
    });
    mockUpdateMany.mockResolvedValue({ count: 1 });

    await expect(
      failGenerationJobAndRefund({
        errorMessage: "渠道超时",
        jobId: "job_1",
      }),
    ).resolves.toEqual({
      refundedCredits: 20,
      updated: true,
    });
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: {
        creditsSpent: 20,
        id: "job_1",
        status: {
          not: GenerationStatus.SUCCEEDED,
        },
      },
      data: {
        creditsSpent: 0,
        errorMessage: "渠道超时",
        status: GenerationStatus.FAILED,
      },
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
    mockFindUnique.mockResolvedValue({
      creditsSpent: 20,
      id: "job_done",
      status: GenerationStatus.SUCCEEDED,
      userId: "user_1",
    });

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

  it("只清理超过宽限时间的 pending 任务", async () => {
    const now = new Date("2026-05-05T12:00:00.000Z");
    mockFindMany.mockResolvedValue([{ id: "job_stale" }]);
    mockFindUnique.mockResolvedValue({
      creditsSpent: 20,
      id: "job_stale",
      status: GenerationStatus.PENDING,
      userId: "user_1",
    });
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
        createdAt: {
          lt: new Date("2026-05-05T11:59:00.000Z"),
        },
        status: GenerationStatus.PENDING,
        userId: "user_1",
      },
      select: {
        id: true,
      },
      orderBy: {
        createdAt: "asc",
      },
      take: 50,
    });
  });
});
