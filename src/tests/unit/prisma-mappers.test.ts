import { GenerationStatus, ShowcaseStatus } from "@prisma/client";

import { serializeFeaturedWork } from "@/lib/prisma-mappers";

describe("精选作品序列化", () => {
  const baseWork = {
    createdAt: new Date("2026-04-23T08:00:00.000Z"),
    featuredAt: new Date("2026-04-23T09:00:00.000Z"),
    id: "work_1",
    job: {
      createdAt: new Date("2026-04-23T07:00:00.000Z"),
      id: "job_1",
      model: "gpt-image-1",
      negativePrompt: null,
      prompt: "电影感夜景肖像",
      size: "1024x1536",
      status: GenerationStatus.SUCCEEDED,
      userId: "user_1",
    },
    jobId: "job_1",
    reviewNote: null,
    reviewedAt: null,
    reviewedBy: null,
    reviewedById: null,
    showcaseStatus: ShowcaseStatus.FEATURED,
    showPromptPublic: true,
    submittedAt: new Date("2026-04-23T08:30:00.000Z"),
    url: "https://example.com/work.png",
  };

  it("提示词允许公开时返回真实 prompt", () => {
    expect(serializeFeaturedWork(baseWork).prompt).toBe("电影感夜景肖像");
  });

  it("提示词隐藏时返回占位文案，避免首页泄露 prompt", () => {
    expect(
      serializeFeaturedWork({
        ...baseWork,
        showPromptPublic: false,
      }).prompt,
    ).toBe("作者未公开提示词");
  });
});
