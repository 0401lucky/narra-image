import { serializeFeaturedVideo } from "@/lib/prisma-mappers";

describe("精选视频序列化", () => {
  it("输出封面、视频地址、点赞数与作者信息", () => {
    const result = serializeFeaturedVideo({
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      durationSeconds: 8,
      featuredAt: new Date("2026-05-02T00:00:00.000Z"),
      height: 720,
      id: "video_1",
      jobId: "job_1",
      posterUrl: "https://example.com/poster.jpg",
      reviewNote: null,
      reviewedAt: null,
      reviewedById: null,
      showPromptPublic: true,
      showcaseStatus: "FEATURED",
      submittedAt: null,
      url: "https://example.com/result.mp4",
      width: 1280,
      job: {
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        id: "job_1",
        model: "sora-2",
        negativePrompt: null,
        prompt: "海浪慢镜头",
        size: "1280x720",
        status: "SUCCEEDED",
        userId: "user_1",
        user: { avatarUrl: null, id: "user_1", nickname: "阿浪" },
      },
      _count: { likes: 3 },
      likes: [{ userId: "viewer_1" }],
    } as never);

    expect(result.id).toBe("video_1");
    expect(result.videoUrl).toBe("https://example.com/result.mp4");
    expect(result.posterUrl).toBe("https://example.com/poster.jpg");
    expect(result.durationSeconds).toBe(8);
    expect(result.likeCount).toBe(3);
    expect(result.likedByMe).toBe(true);
    expect(result.authorName).toBe("阿浪");
    expect(result.prompt).toBe("海浪慢镜头");
  });

  it("作者未公开提示词时回退占位文案", () => {
    const result = serializeFeaturedVideo({
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      durationSeconds: null,
      featuredAt: new Date("2026-05-02T00:00:00.000Z"),
      height: null,
      id: "video_2",
      jobId: "job_2",
      posterUrl: null,
      reviewNote: null,
      reviewedAt: null,
      reviewedById: null,
      showPromptPublic: false,
      showcaseStatus: "FEATURED",
      submittedAt: null,
      url: "https://example.com/2.mp4",
      width: null,
      job: {
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        id: "job_2",
        model: "sora-2",
        negativePrompt: null,
        prompt: "私密提示词",
        size: "1280x720",
        status: "SUCCEEDED",
        userId: "user_1",
        user: { avatarUrl: null, id: "user_1", nickname: null },
      },
      _count: { likes: 0 },
    } as never);

    expect(result.prompt).toBe("作者未公开提示词");
    expect(result.authorName).toBe("匿名创作者");
    expect(result.likedByMe).toBe(false);
  });
});
