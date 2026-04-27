import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  editMock,
  generateMock,
  persistGeneratedImageMock,
  toFileMock,
} = vi.hoisted(() => ({
  editMock: vi.fn(),
  generateMock: vi.fn(),
  persistGeneratedImageMock: vi.fn(async ({ url }: { url?: string }) => url ?? "persisted-image"),
  toFileMock: vi.fn(async () => "mock-file"),
}));

vi.mock("openai", () => ({
  __esModule: true,
  default: class MockOpenAI {
    images = {
      edit: editMock,
      generate: generateMock,
    };
  },
  toFile: toFileMock,
}));

vi.mock("@/lib/storage/persist-generated-image", () => ({
  persistGeneratedImage: persistGeneratedImageMock,
}));

vi.mock("@/lib/providers/built-in-provider", () => ({
  getBuiltInProviderConfig: vi.fn(async () => ({
    apiKey: "built-in-key",
    baseUrl: "https://example.com/v1",
    model: "built-in-model",
  })),
}));

vi.mock("@/lib/providers/resolve-provider", () => ({
  resolveGenerationProvider: vi.fn(({ builtIn }) => builtIn),
}));

import { generateImages } from "@/lib/providers/generate-images";

describe("generateImages 的 size 透传", () => {
  beforeEach(() => {
    generateMock.mockReset();
    editMock.mockReset();
    toFileMock.mockClear();
    persistGeneratedImageMock.mockClear();
  });

  it("文生图时原样透传新的比例 token", async () => {
    generateMock.mockResolvedValue({
      data: [{ url: "https://example.com/generated.png" }],
    });

    await generateImages({
      count: 1,
      customProvider: null,
      generationType: "text_to_image",
      model: "gpt-image-1",
      prompt: "电影感夜景肖像",
      providerMode: "built_in",
      size: "16:9",
      userId: "user-1",
    });

    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        size: "16:9",
      }),
    );
  });

  it("图生图时也原样透传新的比例 token", async () => {
    editMock.mockResolvedValue({
      data: [{ url: "https://example.com/edited.png" }],
    });

    await generateImages({
      count: 1,
      customProvider: null,
      generationType: "image_to_image",
      model: "gpt-image-1",
      prompt: "把这张图调成胶片质感",
      providerMode: "built_in",
      size: "3:4",
      sourceImage: {
        data: Buffer.from("fake-image"),
        fileName: "source.png",
        mimeType: "image/png",
      },
      userId: "user-1",
    });

    expect(editMock).toHaveBeenCalledWith(
      expect.objectContaining({
        image: ["mock-file"],
        size: "3:4",
      }),
    );
  });

  it("图生图支持多张参考图", async () => {
    editMock.mockResolvedValue({
      data: [{ url: "https://example.com/edited.png" }],
    });

    await generateImages({
      count: 1,
      customProvider: null,
      generationType: "image_to_image",
      model: "gpt-image-1",
      prompt: "融合角色和背景",
      providerMode: "built_in",
      size: "auto",
      sourceImages: [
        {
          data: Buffer.from("fake-image-a"),
          fileName: "source-a.png",
          mimeType: "image/png",
        },
        {
          data: Buffer.from("fake-image-b"),
          fileName: "source-b.png",
          mimeType: "image/png",
        },
      ],
      userId: "user-1",
    });

    expect(toFileMock).toHaveBeenCalledTimes(2);
    expect(editMock).toHaveBeenCalledWith(
      expect.objectContaining({
        image: ["mock-file", "mock-file"],
      }),
    );
  });
});
