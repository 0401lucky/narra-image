import { GenerationStatus, ShowcaseStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindMany } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    generationImage: {
      findMany: mockFindMany,
    },
  },
}));

import { listFeaturedWorksPage } from "@/lib/server/works";

function createFeaturedRecord(id: string, featuredAt: string) {
  return {
    createdAt: new Date("2026-04-23T08:00:00.000Z"),
    featuredAt: new Date(featuredAt),
    id,
    job: {
      createdAt: new Date("2026-04-23T07:00:00.000Z"),
      id: `job_${id}`,
      model: "gpt-image-1",
      negativePrompt: null,
      prompt: `prompt-${id}`,
      size: "1024x1024",
      status: GenerationStatus.SUCCEEDED,
      user: {
        avatarUrl: null,
        id: `user_${id}`,
        nickname: `作者-${id}`,
      },
      userId: `user_${id}`,
    },
    jobId: `job_${id}`,
    reviewNote: null,
    reviewedAt: null,
    reviewedBy: null,
    reviewedById: null,
    showcaseStatus: ShowcaseStatus.FEATURED,
    showPromptPublic: true,
    submittedAt: new Date("2026-04-23T08:30:00.000Z"),
    url: `https://example.com/${id}.png`,
  };
}

describe("首页精选分页查询", () => {
  beforeEach(() => {
    mockFindMany.mockReset();
  });

  it("首屏查询按页大小下推 SQL，take 为 limit+1", async () => {
    mockFindMany.mockResolvedValueOnce(
      Array.from({ length: 24 }, (_, index) =>
        createFeaturedRecord(
          `work_${String(index + 1).padStart(3, "0")}`,
          `2026-04-${String(24 - Math.floor(index / 4)).padStart(2, "0")}T12:00:00.000Z`,
        ),
      ),
    );

    await listFeaturedWorksPage();

    expect(mockFindMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        orderBy: [{ featuredAt: "desc" }, { id: "desc" }],
        take: 25,
        where: {
          featuredAt: {
            not: null,
          },
          showcaseStatus: ShowcaseStatus.FEATURED,
        },
      }),
    );
  });

  it("带 cursor 时把 (featuredAt, id) 条件下推到 where", async () => {
    mockFindMany.mockResolvedValueOnce([
      createFeaturedRecord("work_108", "2026-04-24T10:00:00.000Z"),
    ]);

    const cursorFeaturedAt = "2026-04-25T10:00:00.000Z";
    const result = await listFeaturedWorksPage({
      cursor: Buffer.from(
        JSON.stringify({
          featuredAt: cursorFeaturedAt,
          id: "work_109",
        }),
      ).toString("base64url"),
      limit: 24,
    });

    expect(mockFindMany).toHaveBeenCalledTimes(1);
    const call = mockFindMany.mock.calls[0][0];
    expect(call.take).toBe(25);
    expect(call.where).toMatchObject({
      showcaseStatus: ShowcaseStatus.FEATURED,
      featuredAt: { not: null },
      OR: [
        { featuredAt: { lt: new Date(cursorFeaturedAt) } },
        { featuredAt: new Date(cursorFeaturedAt), id: { lt: "work_109" } },
      ],
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.id).toBe("work_108");
    expect(result.hasMore).toBe(false);
  });

  it("hasMore 为 true 时返回 nextCursor", async () => {
    mockFindMany.mockResolvedValueOnce(
      Array.from({ length: 25 }, (_, index) =>
        createFeaturedRecord(
          `work_${String(index + 1).padStart(3, "0")}`,
          `2026-04-${String(25 - index).padStart(2, "0")}T12:00:00.000Z`,
        ),
      ),
    );

    const result = await listFeaturedWorksPage({ limit: 24 });

    expect(result.items).toHaveLength(24);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBeTruthy();
  });
});
