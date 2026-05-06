import { GenerationStatus, Role } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCount,
  mockFailStalePendingGenerationJobs,
  mockFindMany,
  mockRequireAdminRecord,
} = vi.hoisted(() => ({
  mockCount: vi.fn(),
  mockFailStalePendingGenerationJobs: vi.fn(),
  mockFindMany: vi.fn(),
  mockRequireAdminRecord: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    generationJob: {
      count: mockCount,
      findMany: mockFindMany,
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
}));

import AdminGenerationsPage from "@/app/admin/generations/page";

describe("后台生成记录页面", () => {
  beforeEach(() => {
    mockCount.mockReset();
    mockFailStalePendingGenerationJobs.mockReset();
    mockFindMany.mockReset();
    mockRequireAdminRecord.mockReset();

    mockCount.mockResolvedValue(0);
    mockFindMany.mockResolvedValue([]);
    mockRequireAdminRecord.mockResolvedValue({
      avatarUrl: null,
      credits: 100,
      email: "admin@example.com",
      id: "admin_1",
      nickname: null,
      role: Role.ADMIN,
    });
  });

  it("按关键词过滤用户昵称、邮箱和生成任务字段", async () => {
    await AdminGenerationsPage({
      searchParams: Promise.resolve({
        page: "2",
        q: " Alice ",
        view: "list",
      }),
    });

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          user: {
            select: {
              email: true,
              nickname: true,
            },
          },
        }),
        skip: 20,
        take: 20,
        where: {
          OR: [
            { id: { contains: "Alice", mode: "insensitive" } },
            { model: { contains: "Alice", mode: "insensitive" } },
            { prompt: { contains: "Alice", mode: "insensitive" } },
            { userId: { contains: "Alice", mode: "insensitive" } },
            {
              user: {
                is: {
                  OR: [
                    { email: { contains: "Alice", mode: "insensitive" } },
                    { nickname: { contains: "Alice", mode: "insensitive" } },
                  ],
                },
              },
            },
          ],
          status: {
            in: [GenerationStatus.SUCCEEDED, GenerationStatus.PENDING],
          },
        },
      }),
    );
  });
});
