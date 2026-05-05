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
  return {
    apiKeyId: null,
    clientSource: "WEB",
    conversationId: null,
    count: 1,
    createdAt: now,
    creditsSpent: 20,
    errorMessage: null,
    featuredAt: null,
    featuredById: null,
    generationType: GenerationType.TEXT_TO_IMAGE,
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
    providerMode: ProviderMode.BUILT_IN,
    quality: "auto",
    size: "1024x1024",
    sourceImageUrls: [],
    status: GenerationStatus.SUCCEEDED,
    updatedAt: now,
    user: {
      email: "admin-target@example.com",
    },
    userId: "user_1",
    ...input,
  };
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

    await user.click(screen.getByLabelText("选择生成记录 job_1"));
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
    await user.click(screen.getByRole("button", { name: "查看参考图 1" }));

    const zoomedImage = screen.getByAltText("参考图大图");
    expect(zoomedImage).toHaveAttribute("src", "https://example.com/source.png");
    expect(screen.getByText("图生图上传参考图")).toBeInTheDocument();
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
  });
});
