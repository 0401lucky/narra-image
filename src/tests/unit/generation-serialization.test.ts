import { GenerationStatus, ProviderMode } from "@prisma/client";

import { serializeGeneration } from "@/lib/prisma-mappers";

describe("生成记录序列化", () => {
  it("返回生成类型和来源图信息，供前后台统一展示", () => {
    const result = serializeGeneration({
      count: 1,
      completedAt: new Date("2026-04-23T08:01:15.000Z"),
      createdAt: new Date("2026-04-23T08:00:00.000Z"),
      creditsSpent: 5,
      errorMessage: null,
      featuredAt: null,
      featuredById: null,
      generationType: "IMAGE_TO_IMAGE",
      id: "job_1",
      images: [
        {
          createdAt: new Date("2026-04-23T08:01:00.000Z"),
          featuredAt: null,
          id: "image_1",
          jobId: "job_1",
          reviewNote: null,
          reviewedAt: null,
          reviewedById: null,
          showcaseStatus: "PRIVATE",
          showPromptPublic: false,
          submittedAt: null,
          url: "https://example.com/result.png",
        },
      ],
      model: "gpt-image-1",
      negativePrompt: null,
      prompt: "把这张图调成胶片质感",
      providerMode: ProviderMode.BUILT_IN,
      size: "参考图",
      sourceImageUrls: [
        "https://example.com/source-a.png",
        "https://example.com/source-b.png",
      ],
      startedAt: new Date("2026-04-23T08:00:02.000Z"),
      status: GenerationStatus.SUCCEEDED,
      updatedAt: new Date("2026-04-23T08:02:00.000Z"),
      userId: "user_1",
    } as never);

    expect(result.generationType).toBe("image_to_image");
    expect(result.sourceImageUrl).toBe("https://example.com/source-a.png");
    expect(result.sourceImageUrls).toEqual([
      "https://example.com/source-a.png",
      "https://example.com/source-b.png",
    ]);
    expect(result.startedAt).toBe("2026-04-23T08:00:02.000Z");
    expect(result.completedAt).toBe("2026-04-23T08:01:15.000Z");
    expect(result.durationMs).toBe(75_000);
  });

  it("返回视频结果和视频参数，供视频工作区展示", () => {
    const result = serializeGeneration({
      count: 1,
      completedAt: new Date("2026-04-23T08:01:15.000Z"),
      createdAt: new Date("2026-04-23T08:00:00.000Z"),
      creditsSpent: 20,
      errorMessage: null,
      featuredAt: null,
      featuredById: null,
      generationType: "TEXT_TO_VIDEO",
      id: "job_v1",
      images: [],
      videos: [
        {
          createdAt: new Date("2026-04-23T08:01:00.000Z"),
          durationSeconds: 8,
          featuredAt: null,
          height: 720,
          id: "video_1",
          jobId: "job_v1",
          posterUrl: "https://example.com/poster.jpg",
          reviewNote: null,
          reviewedAt: null,
          reviewedById: null,
          showcaseStatus: "PRIVATE",
          showPromptPublic: false,
          submittedAt: null,
          url: "https://example.com/result.mp4",
          width: 1280,
        },
      ],
      aspectRatio: "16:9",
      durationSeconds: 8,
      model: "sora-2",
      negativePrompt: null,
      prompt: "海浪拍打礁石的慢镜头",
      providerMode: ProviderMode.BUILT_IN,
      size: "1280x720",
      sourceImageUrls: [],
      startedAt: new Date("2026-04-23T08:00:02.000Z"),
      status: GenerationStatus.SUCCEEDED,
      updatedAt: new Date("2026-04-23T08:02:00.000Z"),
      userId: "user_1",
    } as never);

    expect(result.generationType).toBe("text_to_video");
    expect(result.aspectRatio).toBe("16:9");
    expect(result.durationSeconds).toBe(8);
    expect(result.videos).toHaveLength(1);
    expect(result.videos[0]).toEqual({
      durationSeconds: 8,
      height: 720,
      id: "video_1",
      posterUrl: "https://example.com/poster.jpg",
      url: "https://example.com/result.mp4",
      width: 1280,
    });
  });
});
