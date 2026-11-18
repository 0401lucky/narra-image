import fs from "node:fs";
import path from "node:path";

import {
  GenerationClientSource,
  GenerationStatus,
  GenerationType,
  ProviderMode,
  Role,
} from "@prisma/client";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockChannelFindUnique,
  mockFailStalePendingGenerationJobs,
  mockJobCount,
  mockJobFindMany,
  mockJobFindUnique,
  mockRedeemBatchFindUnique,
  mockRedeemRedemptionFindMany,
  mockRequireAdminRecord,
} = vi.hoisted(() => ({
  mockChannelFindUnique: vi.fn(),
  mockFailStalePendingGenerationJobs: vi.fn(),
  mockJobCount: vi.fn(),
  mockJobFindMany: vi.fn(),
  mockJobFindUnique: vi.fn(),
  mockRedeemBatchFindUnique: vi.fn(),
  mockRedeemRedemptionFindMany: vi.fn(),
  mockRequireAdminRecord: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    generationJob: {
      count: mockJobCount,
      findMany: mockJobFindMany,
      findUnique: mockJobFindUnique,
    },
    providerChannel: {
      findUnique: mockChannelFindUnique,
    },
    redeemCodeBatch: {
      findUnique: mockRedeemBatchFindUnique,
    },
    redeemRedemption: {
      findMany: mockRedeemRedemptionFindMany,
    },
  },
}));

vi.mock("@/lib/server/current-user", () => ({
  requireAdminRecord: mockRequireAdminRecord,
}));

vi.mock("@/lib/generation/job-refund", () => ({
  failStalePendingGenerationJobs: mockFailStalePendingGenerationJobs,
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

import AdminGenerationsPage from "@/app/admin/generations/page";
import { GET as getGenerationDiagnostic } from "@/app/api/admin/generations/[id]/route";
import { GET as getRedeemBatchDetail } from "@/app/api/admin/redeem-codes/batches/[id]/route";
import { buildGenerationsFilterUrl } from "@/components/admin/generations/filter-url";

describe("Stage 3 排障抽屉接口与多维运维工具", () => {
  beforeEach(() => {
    mockChannelFindUnique.mockReset();
    mockFailStalePendingGenerationJobs.mockReset();
    mockJobCount.mockReset();
    mockJobFindMany.mockReset();
    mockJobFindUnique.mockReset();
    mockRedeemBatchFindUnique.mockReset();
    mockRedeemRedemptionFindMany.mockReset();
    mockRequireAdminRecord.mockReset();

    mockRequireAdminRecord.mockResolvedValue({
      avatarUrl: null,
      credits: 500,
      email: "admin@example.com",
      id: "admin_1",
      nickname: "Admin",
      role: Role.ADMIN,
    });
    mockJobCount.mockResolvedValue(0);
    mockJobFindMany.mockResolvedValue([]);
  });

  describe("GET /api/admin/generations/[id]", () => {
    it("返回只读排障详情与重试轨迹，且严禁查询任何加密密钥字段", async () => {
      mockJobFindUnique.mockResolvedValue({
        apiKey: { id: "ak_1", keyPrefix: "nr_live_99", name: "Prod Bot" },
        apiKeyId: "ak_1",
        aspectRatio: "16:9",
        attemptCount: 2,
        attempts: [
          {
            completedAt: new Date("2026-11-18T02:00:05.000Z"),
            createdAt: new Date("2026-11-18T02:00:00.000Z"),
            errorCode: "UPSTREAM_502",
            errorMessage: "Bad Gateway",
            id: "att_1",
            idempotencyKey: "idem_1",
            model: "sora-video-1",
            nextRetryAt: new Date("2026-11-18T02:00:10.000Z"),
            operation: "video.generate",
            ordinal: 1,
            providerChannelId: "ch_1",
            providerRequestId: "req_upstream_1",
            status: "FAILED",
            updatedAt: new Date("2026-11-18T02:00:05.000Z"),
            upstreamSubmittedAt: new Date("2026-11-18T02:00:01.000Z"),
            workerId: "worker-a",
          },
        ],
        cancelRequestedAt: null,
        clientSource: "API",
        completedAt: new Date("2026-11-18T02:00:20.000Z"),
        contractVersion: 1,
        conversationId: null,
        count: 1,
        createdAt: new Date("2026-11-18T01:59:59.000Z"),
        creditsSpent: 20,
        durationSeconds: 5,
        errorCode: "HANDOFF_UNKNOWN",
        errorMessage: "Worker lease expired after upstream submission",
        generationType: "TEXT_TO_VIDEO",
        handoffState: "UNKNOWN",
        id: "job_diag_1",
        images: [],
        lockedAt: null,
        model: "sora-video-1",
        moderation: "auto",
        negativePrompt: null,
        nextAttemptAt: null,
        outputCompression: null,
        outputFormat: "mp4",
        prompt: "A warm sunlit library",
        providerBaseUrl: null,
        providerChannelId: "ch_1",
        providerLabel: null,
        providerMode: "BUILT_IN",
        quality: "high",
        refundAppliedAt: null,
        seed: 42,
        size: "1280x720",
        sourceImageUrls: [],
        startedAt: new Date("2026-11-18T02:00:00.000Z"),
        status: "FAILED",
        updatedAt: new Date("2026-11-18T02:00:20.000Z"),
        user: {
          credits: 80,
          email: "user@example.com",
          id: "user_1",
          nickname: "小夏",
        },
        userId: "user_1",
        videos: [],
        workerId: "worker-a",
        workerManaged: true,
      });
      mockChannelFindUnique.mockResolvedValue({
        id: "ch_1",
        name: "主力视频渠道",
        slug: "video-main",
      });

      const response = await getGenerationDiagnostic(
        new Request("https://example.com"),
        { params: Promise.resolve({ id: "job_diag_1" }) },
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.job.id).toBe("job_diag_1");
      expect(body.data.job.handoffState).toBe("UNKNOWN");
      expect(body.data.job.channel).toEqual({
        id: "ch_1",
        name: "主力视频渠道",
        slug: "video-main",
      });
      expect(body.data.job.attempts).toHaveLength(1);
      expect(body.data.job.attempts[0].providerRequestId).toBe("req_upstream_1");

      const jobSelect = mockJobFindUnique.mock.calls[0]?.[0]?.select;
      expect(jobSelect.providerApiKeyEncrypted).toBeUndefined();
      const channelSelect = mockChannelFindUnique.mock.calls[0]?.[0]?.select;
      expect(channelSelect.apiKeyEncrypted).toBeUndefined();
    });

    it("任务不存在时返回 404", async () => {
      mockJobFindUnique.mockResolvedValue(null);

      const response = await getGenerationDiagnostic(
        new Request("https://example.com"),
        { params: Promise.resolve({ id: "ghost_job" }) },
      );

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({
        error: "生成任务不存在",
      });
    });
  });

  describe("GET /api/admin/redeem-codes/batches/[id]", () => {
    it("返回兑换码批次明细及核销用户流水", async () => {
      mockRedeemBatchFindUnique.mockResolvedValue({
        codes: [
          {
            code: "VIP-2026-A",
            id: "rc_1",
            isActive: true,
            maxRedemptions: 1,
            redeemedCount: 1,
          },
        ],
        id: "batch_1",
        isActive: true,
        title: "周年庆福利",
      });
      mockRedeemRedemptionFindMany.mockResolvedValue([
        {
          code: { code: "VIP-2026-A" },
          createdAt: new Date("2026-11-18T03:00:00.000Z"),
          id: "rr_1",
          rewardCredits: 100,
          user: { email: "lucky@example.com" },
        },
      ]);

      const response = await getRedeemBatchDetail(
        new Request("https://example.com"),
        { params: Promise.resolve({ id: "batch_1" }) },
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.codes).toHaveLength(1);
      expect(body.data.redemptions).toEqual([
        {
          code: "VIP-2026-A",
          createdAt: "2026-11-18T03:00:00.000Z",
          id: "rr_1",
          rewardCredits: 100,
          userEmail: "lucky@example.com",
        },
      ]);
    });
  });

  describe("AdminGenerationsPage 多维筛选扩展", () => {
    it("支持按 FAILED 状态、视频类型、API 来源与内置渠道组合排障检索", async () => {
      await AdminGenerationsPage({
        searchParams: Promise.resolve({
          mode: "BUILT_IN",
          source: "API",
          status: "FAILED",
          type: "TEXT_TO_VIDEO",
          view: "list",
        }),
      });

      expect(mockJobFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            videos: { orderBy: { createdAt: "asc" } },
          }),
          where: {
            AND: [
              { status: GenerationStatus.FAILED },
              { generationType: GenerationType.TEXT_TO_VIDEO },
              { clientSource: GenerationClientSource.API },
              { providerMode: ProviderMode.BUILT_IN },
            ],
          },
        }),
      );
    });

    it("服务端页面完整渲染视图切换链接且不从 use client 模块直接调用纯函数", async () => {
      const filterModuleSource = fs.readFileSync(
        path.resolve(process.cwd(), "src/components/admin/generations/filter-url.ts"),
        "utf8",
      );
      expect(filterModuleSource.trimStart().startsWith('"use client"')).toBe(false);
      expect(filterModuleSource.trimStart().startsWith("'use client'")).toBe(false);

      expect(
        buildGenerationsFilterUrl({
          mode: "BUILT_IN",
          page: 2,
          q: "sora",
          source: "API",
          status: "FAILED",
          type: "TEXT_TO_VIDEO",
          view: "card",
        }),
      ).toBe(
        "/admin/generations?view=card&page=2&q=sora&status=FAILED&type=TEXT_TO_VIDEO&source=API&mode=BUILT_IN",
      );

      const element = await AdminGenerationsPage({
        searchParams: Promise.resolve({
          mode: "BUILT_IN",
          page: "2",
          q: "sora",
          source: "API",
          status: "FAILED",
          type: "TEXT_TO_VIDEO",
          view: "list",
        }),
      });
      render(element);

      const cardLink = screen.getByRole("link", { name: "卡片" });
      expect(cardLink.getAttribute("href")).toBe(
        "/admin/generations?view=card&page=2&q=sora&status=FAILED&type=TEXT_TO_VIDEO&source=API&mode=BUILT_IN",
      );
    });
  });
});
