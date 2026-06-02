import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  GenerationStatus,
  GenerationType,
  ProviderMode,
  ShowcaseStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  GenerationAdminCard,
  GenerationAdminList,
  type GenerationAdminJob,
} from "@/components/admin/admin-actions";
import { getThumbUrl } from "@/lib/image-url";

const { mockRefresh } = vi.hoisted(() => ({
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mockRefresh,
  }),
}));

function createJob(input: Partial<GenerationAdminJob> = {}): GenerationAdminJob {
  const now = new Date("2026-05-05T12:00:00.000Z");
  const base: GenerationAdminJob = {
    attemptCount: 0,
    apiKeyId: null,
    clientSource: "WEB",
    completedAt: null,
    conversationId: null,
    count: 1,
    createdAt: now,
    creditsSpent: 20,
    durationSeconds: null,
    errorMessage: null,
    featuredAt: null,
    featuredById: null,
    generationType: GenerationType.TEXT_TO_IMAGE,
    aspectRatio: null,
    id: "job_1",
    images: [
      {
        createdAt: now,
        featuredAt: null,
        height: 1024,
        id: "image_1",
        jobId: "job_1",
        reviewNote: null,
        reviewedAt: null,
        reviewedById: null,
        showcaseStatus: ShowcaseStatus.PRIVATE,
        showPromptPublic: false,
        submittedAt: null,
        url: "https://example.com/image.png",
        width: 1024,
      },
    ],
    model: "gpt-image-2",
    moderation: "auto",
    negativePrompt: null,
    outputCompression: null,
    outputFormat: "png",
    prompt: "测试提示词",
    providerApiKeyEncrypted: null,
    providerBaseUrl: null,
    providerChannelId: null,
    providerLabel: null,
    providerMode: ProviderMode.BUILT_IN,
    providerModels: [],
    providerRemember: false,
    quality: "auto",
    seed: null,
    size: "1024x1024",
    sourceImageUrls: [],
    startedAt: null,
    status: GenerationStatus.SUCCEEDED,
    updatedAt: now,
    user: {
      email: "admin-target@example.com",
      nickname: null,
    },
    userId: "user_1",
    workerId: null,
    workerManaged: false,
    lockedAt: null,
  };
  return { ...base, ...input } as GenerationAdminJob;
}

describe("后台生成记录列表视图", () => {
  beforeEach(() => {
    mockRefresh.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({ data: { deleted: 1, ids: ["job_1"] } }),
        ok: true,
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("勾选记录后可以批量删除", async () => {
    const user = userEvent.setup();
    render(<GenerationAdminList jobs={[createJob()]} />);

    await user.click(screen.getAllByLabelText("选择生成记录 job_1")[0]);
    await user.click(screen.getByRole("button", { name: "批量删除" }));
    await user.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/admin/generations", {
        body: JSON.stringify({ ids: ["job_1"] }),
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
      });
    });
    expect(mockRefresh).toHaveBeenCalled();
    expect(screen.getByText("本页记录已清空。")).toBeInTheDocument();
  });

  it("列表视图展示并可放大图生图参考图", async () => {
    const user = userEvent.setup();
    render(
      <GenerationAdminList
        jobs={[
          createJob({
            generationType: GenerationType.IMAGE_TO_IMAGE,
            sourceImageUrls: ["https://example.com/source.png"],
          }),
        ]}
      />,
    );

    expect(screen.getByRole("columnheader", { name: "参考图" })).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "查看参考图 1" })[0]);

    const zoomedImage = screen.getByAltText("参考图大图");
    expect(zoomedImage).toHaveAttribute(
      "src",
      getThumbUrl("https://example.com/source.png", 1920, 90),
    );
    expect(screen.getByText("图生图上传参考图")).toBeInTheDocument();
  });

  it("列表视图点击生成图时放大图片而不是打开提示词", async () => {
    const user = userEvent.setup();
    render(<GenerationAdminList jobs={[createJob()]} />);

    await user.click(screen.getAllByRole("button", { name: "查看生成图片 job_1" })[0]);

    expect(screen.getByAltText("生成图片大图")).toHaveAttribute(
      "src",
      getThumbUrl("https://example.com/image.png", 1920, 90),
    );
    expect(screen.getByText("生成图片")).toBeInTheDocument();
    expect(screen.queryByText("完整提示词")).not.toBeInTheDocument();
  });

  it("卡片视图展示图生图参考图", async () => {
    const user = userEvent.setup();
    render(
      <GenerationAdminCard
        job={createJob({
          generationType: GenerationType.IMAGE_TO_IMAGE,
          sourceImageUrls: ["https://example.com/source-card.png"],
        })}
      />,
    );

    expect(screen.getByText("上传参考图")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "查看参考图 1" }));

    expect(screen.getByAltText("Zoomed")).toHaveAttribute(
      "src",
      "https://example.com/source-card.png",
    );
    expect(screen.getByAltText("Zoomed")).toHaveAttribute("draggable", "false");
    expect(screen.getByRole("button", { name: "关闭大图" })).toHaveClass(
      "bg-black/65",
      "text-white",
    );
  });
});
