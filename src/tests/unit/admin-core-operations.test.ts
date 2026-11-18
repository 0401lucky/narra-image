import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFindUniqueUser,
  mockGeneratedVideoUpdate,
  mockGenerationImageUpdate,
  mockGetAdminShellSummary,
  mockGetVideoMutationTarget,
  mockGetWorkMutationTarget,
  mockRequireAdminRecord,
  mockRevalidateTag,
} = vi.hoisted(() => ({
  mockFindUniqueUser: vi.fn(),
  mockGeneratedVideoUpdate: vi.fn(),
  mockGenerationImageUpdate: vi.fn(),
  mockGetAdminShellSummary: vi.fn(),
  mockGetVideoMutationTarget: vi.fn(),
  mockGetWorkMutationTarget: vi.fn(),
  mockRequireAdminRecord: vi.fn(),
  mockRevalidateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidateTag: mockRevalidateTag,
}));

vi.mock("@/lib/db", () => ({
  db: {
    generatedVideo: {
      update: mockGeneratedVideoUpdate,
    },
    generationImage: {
      update: mockGenerationImageUpdate,
    },
    user: {
      findUnique: mockFindUniqueUser,
    },
  },
}));

vi.mock("@/lib/server/current-user", () => ({
  requireAdminRecord: mockRequireAdminRecord,
}));

vi.mock("@/lib/server/admin-overview", () => ({
  getAdminShellSummary: mockGetAdminShellSummary,
}));

vi.mock("@/lib/server/works", () => ({
  getVideoMutationTarget: mockGetVideoMutationTarget,
  getWorkMutationTarget: mockGetWorkMutationTarget,
}));

import { GET as getSystemStatus } from "@/app/api/admin/system-status/route";
import { GET as getUserDetail } from "@/app/api/admin/users/[id]/route";
import { POST as batchReviewWorks } from "@/app/api/admin/works/batch-review/route";

describe("Stage 2 后台核心运营接口", () => {
  beforeEach(() => {
    mockFindUniqueUser.mockReset();
    mockGeneratedVideoUpdate.mockReset();
    mockGenerationImageUpdate.mockReset();
    mockGetAdminShellSummary.mockReset();
    mockGetVideoMutationTarget.mockReset();
    mockGetWorkMutationTarget.mockReset();
    mockRequireAdminRecord.mockReset();
    mockRevalidateTag.mockReset();
  });

  describe("GET /api/admin/users/[id]", () => {
    it("返回 360° 用户档案且不查询或泄漏敏感哈希字段", async () => {
      mockRequireAdminRecord.mockResolvedValue({ id: "admin_1" });
      mockFindUniqueUser.mockResolvedValue({
        _count: {
          apiKeys: 1,
          canvases: 2,
          checkInRecords: 3,
          contentReviews: 0,
          generations: 5,
          likedWorks: 4,
          redeemRedemptions: 1,
        },
        apiKeys: [
          {
            _count: { generations: 2 },
            createdAt: new Date("2026-11-18T00:00:00.000Z"),
            id: "key_1",
            keyPrefix: "nr_live_abc",
            lastUsedAt: null,
            name: "测试密钥",
            revokedAt: null,
          },
        ],
        avatarUrl: null,
        bannedAt: null,
        checkInRecords: [
          {
            createdAt: new Date("2026-11-18T00:00:00.000Z"),
            dateKey: "2026-11-18",
            id: "ci_1",
            rewardCredits: 10,
          },
        ],
        createdAt: new Date("2026-11-10T00:00:00.000Z"),
        credits: 120,
        email: "creator@example.com",
        generations: [
          {
            createdAt: new Date("2026-11-18T01:00:00.000Z"),
            creditsSpent: 5,
            errorMessage: null,
            generationType: "TEXT_TO_IMAGE",
            id: "job_1",
            images: [],
            model: "gemini-2.5-flash-image",
            prompt: "A warm studio portrait",
            status: "SUCCEEDED",
          },
        ],
        id: "user_1",
        inviteUsed: {
          batch: { title: "内测首批" },
          code: "INV-001",
          note: "VIP",
        },
        nickname: "阿明",
        oauthProvider: "github",
        redeemRedemptions: [
          {
            code: { code: "GIFT-100" },
            createdAt: new Date("2026-11-15T00:00:00.000Z"),
            id: "red_1",
            rewardCredits: 100,
          },
        ],
        role: "USER",
      });

      const response = await getUserDetail(new Request("https://example.com"), {
        params: Promise.resolve({ id: "user_1" }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.user.email).toBe("creator@example.com");
      expect(body.data.user.role).toBe("user");
      expect(body.data.user.apiKeys[0]).toEqual({
        createdAt: "2026-11-18T00:00:00.000Z",
        generationCount: 2,
        id: "key_1",
        keyPrefix: "nr_live_abc",
        lastUsedAt: null,
        name: "测试密钥",
        status: "active",
      });

      const queryArgs = mockFindUniqueUser.mock.calls[0]?.[0];
      expect(queryArgs.select.passwordHash).toBeUndefined();
      expect(queryArgs.select.apiKeys.select.keyHash).toBeUndefined();
    });

    it("用户不存在时返回 404", async () => {
      mockRequireAdminRecord.mockResolvedValue({ id: "admin_1" });
      mockFindUniqueUser.mockResolvedValue(null);

      const response = await getUserDetail(new Request("https://example.com"), {
        params: Promise.resolve({ id: "missing" }),
      });

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: "用户不存在" });
    });
  });

  describe("POST /api/admin/works/batch-review", () => {
    it("支持图片与视频混合批量审核，跳过非法状态流转并触发缓存刷新", async () => {
      mockRequireAdminRecord.mockResolvedValue({ id: "admin_1" });
      mockGetWorkMutationTarget.mockImplementation(async (id: string) => {
        if (id === "img_pending") {
          return {
            featuredAt: null,
            id: "img_pending",
            showcaseStatus: "PENDING",
          };
        }
        if (id === "img_already_featured") {
          return {
            featuredAt: new Date("2026-11-17T00:00:00.000Z"),
            id: "img_already_featured",
            showcaseStatus: "FEATURED",
          };
        }
        return null;
      });
      mockGetVideoMutationTarget.mockResolvedValue({
        featuredAt: null,
        id: "vid_pending",
        showcaseStatus: "PENDING",
      });
      mockGenerationImageUpdate.mockResolvedValue({});
      mockGeneratedVideoUpdate.mockResolvedValue({});

      const response = await batchReviewWorks(
        new Request("https://example.com/api/admin/works/batch-review", {
          body: JSON.stringify({
            action: "approve_feature",
            items: [
              { id: "img_pending", mediaType: "image" },
              { id: "vid_pending", mediaType: "video" },
              { id: "img_already_featured", mediaType: "image" },
              { id: "img_missing", mediaType: "image" },
            ],
            reviewNote: "精选合集",
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data).toEqual({
        skippedCount: 2,
        skippedIds: ["img_already_featured", "img_missing"],
        updatedCount: 2,
        updatedIds: ["img_pending", "vid_pending"],
      });
      expect(mockGenerationImageUpdate).toHaveBeenCalledTimes(1);
      expect(mockGeneratedVideoUpdate).toHaveBeenCalledTimes(1);
      expect(mockRevalidateTag).toHaveBeenCalledWith("featured-works", "max");
    });
  });

  describe("GET /api/admin/system-status", () => {
    it("返回后台顶栏与侧栏实时摘要指标", async () => {
      mockRequireAdminRecord.mockResolvedValue({ id: "admin_1" });
      mockGetAdminShellSummary.mockResolvedValue({
        activeChannelCount: 2,
        dbOk: true,
        failed24hCount: 0,
        handoffUnknownCount: 1,
        moderationBlocked24hCount: 3,
        pendingWorksCount: 5,
      });

      const response = await getSystemStatus();
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.summary.pendingWorksCount).toBe(5);
      expect(body.data.summary.handoffUnknownCount).toBe(1);
    });

    it("非管理员请求返回 403", async () => {
      mockRequireAdminRecord.mockRejectedValue(new Error("未授权"));

      const response = await getSystemStatus();
      expect(response.status).toBe(403);
    });
  });
});
