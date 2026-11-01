import { cleanup, render, screen } from "@testing-library/react";

import { VideoStage } from "@/components/video/parts/video-stage";

const noop = () => {};

function pendingGeneration() {
  return {
    count: 1,
    createdAt: "2026-06-01T00:00:00.000Z",
    creditsSpent: 5,
    generationType: "text_to_video" as const,
    id: "job_v1",
    images: [],
    model: "agnes-video-v2.0",
    prompt: "一只猫在跳舞",
    providerMode: "built_in" as const,
    size: "1280x720",
    startedAt: "2026-06-01T00:00:00.000Z",
    status: "pending" as const,
  };
}

describe("视频舞台", () => {
  afterEach(() => {
    cleanup();
  });

  it("生成中（pending）时渲染进度条", () => {
    render(
      <VideoStage generation={pendingGeneration()} onDownload={noop} onRetry={noop} />,
    );

    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });
});
