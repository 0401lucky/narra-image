import { GenerationStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFailGenerationJobAndRefund,
  mockFindFirst,
  mockGetCurrentUserRecord,
} = vi.hoisted(() => ({
  mockFailGenerationJobAndRefund: vi.fn(),
  mockFindFirst: vi.fn(),
  mockGetCurrentUserRecord: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    generationJob: {
      findFirst: mockFindFirst,
    },
  },
}));

vi.mock("@/lib/generation/job-refund", () => ({
  failGenerationJobAndRefund: mockFailGenerationJobAndRefund,
  failStalePendingGenerationJobs: vi.fn(),
}));

vi.mock("@/lib/server/current-user", () => ({
  getCurrentUserRecord: mockGetCurrentUserRecord,
}));

import { DELETE } from "@/app/api/me/generations/[id]/route";

const failedJob = {
  aspectRatio: null,
  completedAt: new Date("2026-04-23T08:01:00.000Z"),
  conversationId: null,
  count: 1,
  createdAt: new Date("2026-04-23T08:00:00.000Z"),
  creditsSpent: 0,
  durationSeconds: null,
  errorMessage: "用户取消生成，已退还预扣积分。",
  featuredAt: null,
  generationType: "TEXT_TO_IMAGE",
  id: "job_1",
  images: [],
  model: "gpt-image-2",
  moderation: "auto",
  negativePrompt: null,
  outputCompression: null,
  outputFormat: "png",
  prompt: "测试提示词",
  providerBaseUrl: null,
  providerChannelId: null,
  providerLabel: null,
  providerMode: "BUILT_IN",
  quality: "auto",
  seed: null,
  size: "1024x1024",
  sourceImageUrls: [],
  status: GenerationStatus.FAILED,
  updatedAt: new Date("2026-04-23T08:01:00.000Z"),
  userId: "user_1",
  videos: [],
};

describe("用户生成任务取消接口", () => {
  beforeEach(() => {
    mockFailGenerationJobAndRefund.mockReset();
    mockFindFirst.mockReset();
    mockGetCurrentUserRecord.mockReset();
  });

  it("取消自己的待处理任务时调用退款逻辑", async () => {
    mockGetCurrentUserRecord.mockResolvedValue({ id: "user_1" });
    mockFindFirst
      .mockResolvedValueOnce({
        id: "job_1",
        status: GenerationStatus.PENDING,
      })
      .mockResolvedValueOnce(failedJob);
    mockFailGenerationJobAndRefund.mockResolvedValue({
      refundedCredits: 5,
      updated: true,
    });

    const response = await DELETE(new Request("https://example.com"), {
      params: Promise.resolve({ id: "job_1" }),
    });

    expect(response.status).toBe(200);
    expect(mockFailGenerationJobAndRefund).toHaveBeenCalledWith({
      allowedStatuses: [GenerationStatus.PENDING],
      errorMessage: "用户取消生成，已退还预扣积分。",
      jobId: "job_1",
    });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        generation: {
          creditsSpent: 0,
          id: "job_1",
          status: "failed",
        },
        refundedCredits: 5,
      },
    });
  });

  it("处理中的任务不能取消或退款", async () => {
    mockGetCurrentUserRecord.mockResolvedValue({ id: "user_1" });
    mockFindFirst.mockResolvedValue({
      id: "job_processing",
      status: GenerationStatus.PROCESSING,
    });

    const response = await DELETE(new Request("https://example.com"), {
      params: Promise.resolve({ id: "job_processing" }),
    });

    expect(response.status).toBe(409);
    expect(mockFailGenerationJobAndRefund).not.toHaveBeenCalled();
  });

  it("取消时状态发生竞态变化会返回冲突且不读取结果", async () => {
    mockGetCurrentUserRecord.mockResolvedValue({ id: "user_1" });
    mockFindFirst.mockResolvedValueOnce({
      id: "job_1",
      status: GenerationStatus.PENDING,
    });
    mockFailGenerationJobAndRefund.mockResolvedValue({
      refundedCredits: 0,
      updated: false,
    });

    const response = await DELETE(new Request("https://example.com"), {
      params: Promise.resolve({ id: "job_1" }),
    });

    expect(response.status).toBe(409);
    expect(mockFindFirst).toHaveBeenCalledTimes(1);
  });

  it("已成功任务不能取消", async () => {
    mockGetCurrentUserRecord.mockResolvedValue({ id: "user_1" });
    mockFindFirst.mockResolvedValue({
      id: "job_done",
      status: GenerationStatus.SUCCEEDED,
    });

    const response = await DELETE(new Request("https://example.com"), {
      params: Promise.resolve({ id: "job_done" }),
    });

    expect(response.status).toBe(409);
    expect(mockFailGenerationJobAndRefund).not.toHaveBeenCalled();
  });
});
