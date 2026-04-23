import { GenerationStatus, ProviderMode } from "@prisma/client";

import { serializeGeneration } from "@/lib/prisma-mappers";

describe("生成记录序列化", () => {
  it("返回生成类型和来源图信息，供前后台统一展示", () => {
    const result = serializeGeneration({
      count: 1,
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
      sourceImageUrl: "https://example.com/source.png",
      status: GenerationStatus.SUCCEEDED,
      updatedAt: new Date("2026-04-23T08:02:00.000Z"),
      userId: "user_1",
    } as never);

    expect(result.generationType).toBe("image_to_image");
    expect(result.sourceImageUrl).toBe("https://example.com/source.png");
  });
});
