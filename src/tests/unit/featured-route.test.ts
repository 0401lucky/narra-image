import { describe, expect, it, vi } from "vitest";

const { mockListFeaturedWorksPage } = vi.hoisted(() => ({
  mockListFeaturedWorksPage: vi.fn(),
}));

vi.mock("@/lib/server/works", () => ({
  listFeaturedWorksPage: mockListFeaturedWorksPage,
}));

vi.mock("@/lib/server/current-user", () => ({
  getCurrentUserRecord: vi.fn(async () => null),
}));

import { GET } from "@/app/api/works/featured/route";

describe("首页精选接口", () => {
  it("返回 items、nextCursor 和 hasMore，并透传 cursor 与 limit", async () => {
    mockListFeaturedWorksPage.mockResolvedValue({
      hasMore: true,
      items: [
        {
          authorAvatar: null,
          authorName: "作者-A",
          featuredAt: "2026-04-25T10:00:00.000Z",
          id: "work_1",
          image: "https://example.com/work_1.png",
          likeCount: 0,
          likedByMe: false,
          prompt: "电影感夜景",
          title: "gpt-image-1",
        },
      ],
      nextCursor: "next-cursor-token",
    });

    const response = await GET(
      new Request("https://example.com/api/works/featured?cursor=cursor_1&limit=24"),
    );

    expect(mockListFeaturedWorksPage).toHaveBeenCalledWith({
      cursor: "cursor_1",
      limit: 24,
      viewerId: undefined,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      hasMore: true,
      items: [
        {
          authorAvatar: null,
          authorName: "作者-A",
          featuredAt: "2026-04-25T10:00:00.000Z",
          id: "work_1",
          image: "https://example.com/work_1.png",
          likeCount: 0,
          likedByMe: false,
          prompt: "电影感夜景",
          title: "gpt-image-1",
        },
      ],
      nextCursor: "next-cursor-token",
    });
  });
});
