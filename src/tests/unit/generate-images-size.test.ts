import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  editMock,
  generateMock,
  persistGeneratedImageMock,
  responsesCreateMock,
  toFileMock,
} = vi.hoisted(() => ({
  editMock: vi.fn(),
  generateMock: vi.fn(),
  persistGeneratedImageMock: vi.fn(async ({ url }: { url?: string }) => url ?? "persisted-image"),
  responsesCreateMock: vi.fn(),
  toFileMock: vi.fn(async () => "mock-file"),
}));

vi.mock("openai", () => ({
  __esModule: true,
  default: class MockOpenAI {
    images = {
      edit: editMock,
      generate: generateMock,
    };
    responses = {
      create: responsesCreateMock,
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

function responseStream(output: Array<{ result: string; type: string }>) {
  return (async function* () {
    for (const [index, item] of output.entries()) {
      yield {
        item,
        output_index: index,
        sequence_number: index + 1,
        type: "response.output_item.done",
      };
    }
    yield {
      response: { output },
      sequence_number: output.length + 1,
      type: "response.completed",
    };
  })();
}

describe("generateImages 的图片参数透传", () => {
  beforeEach(() => {
    generateMock.mockReset();
    editMock.mockReset();
    responsesCreateMock.mockReset();
    toFileMock.mockClear();
    persistGeneratedImageMock.mockClear();
  });

  it("文生图时原样透传高分辨率尺寸与输出参数", async () => {
    generateMock.mockResolvedValue({
      data: [{ url: "https://example.com/generated.png" }],
    });

    await generateImages({
      count: 1,
      customProvider: null,
      generationType: "text_to_image",
      model: "gpt-image-2",
      moderation: "low",
      outputCompression: 90,
      outputFormat: "webp",
      prompt: "电影感夜景肖像",
      providerMode: "built_in",
      quality: "high",
      size: "3840x2160",
      userId: "user-1",
    });

    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        moderation: "low",
        output_compression: 90,
        output_format: "webp",
        quality: "high",
        size: "3840x2160",
      }),
    );
  });

  it("文生图默认参数不额外打扰兼容渠道", async () => {
    generateMock.mockResolvedValue({
      data: [{ url: "https://example.com/generated.png" }],
    });

    await generateImages({
      count: 1,
      customProvider: null,
      generationType: "text_to_image",
      model: "gpt-image-2",
      prompt: "电影感夜景肖像",
      providerMode: "built_in",
      size: "auto",
      userId: "user-1",
    });

    const request = generateMock.mock.calls[0]?.[0];
    expect(request).toEqual(
      expect.objectContaining({
        model: "gpt-image-2",
        size: "auto",
      }),
    );
    expect(request).not.toHaveProperty("moderation");
    expect(request).not.toHaveProperty("output_format");
    expect(request).not.toHaveProperty("quality");
  });

  it("图生图时也原样透传像素尺寸和输出参数", async () => {
    editMock.mockResolvedValue({
      data: [{ url: "https://example.com/edited.png" }],
    });

    await generateImages({
      count: 1,
      customProvider: null,
      generationType: "image_to_image",
      model: "gpt-image-1",
      outputFormat: "jpeg",
      prompt: "把这张图调成胶片质感",
      providerMode: "built_in",
      quality: "medium",
      size: "2048x2048",
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
        output_format: "jpeg",
        quality: "medium",
        size: "2048x2048",
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

  it("从响应 item.size 字段提取实际生效尺寸", async () => {
    generateMock.mockResolvedValue({
      data: [{ size: "1024x1024", url: "https://example.com/generated.png" }],
    });

    const records = await generateImages({
      count: 1,
      customProvider: null,
      generationType: "text_to_image",
      model: "gpt-image-2",
      prompt: "降级测试",
      providerMode: "built_in",
      size: "3840x2160",
      userId: "user-1",
    });

    expect(records).toEqual([
      {
        actualHeight: 1024,
        actualSize: "1024x1024",
        actualWidth: 1024,
        url: "https://example.com/generated.png",
      },
    ]);
  });

  it("从 b64_json 嗅探 PNG 头部得到实际尺寸", async () => {
    // 构造一张 1024x768 的最小 PNG
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from([0x00, 0x00, 0x00, 0x0d]),
      Buffer.from("IHDR"),
      (() => {
        const data = Buffer.alloc(13);
        data.writeUInt32BE(1024, 0);
        data.writeUInt32BE(768, 4);
        data.writeUInt8(8, 8);
        return data;
      })(),
      Buffer.alloc(4),
    ]);
    generateMock.mockResolvedValue({
      data: [{ b64_json: png.toString("base64") }],
    });

    const records = await generateImages({
      count: 1,
      customProvider: null,
      generationType: "text_to_image",
      model: "gpt-image-2",
      prompt: "嗅探测试",
      providerMode: "built_in",
      size: "2048x2048",
      userId: "user-1",
    });

    expect(records[0]?.actualSize).toBe("1024x768");
    expect(records[0]?.actualWidth).toBe(1024);
    expect(records[0]?.actualHeight).toBe(768);
  });

  it("响应里没有任何尺寸线索时 actualSize 为 null", async () => {
    generateMock.mockResolvedValue({
      data: [{ url: "https://example.com/no-meta.png" }],
    });
    // fetch 失败时静默返回 null
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));

    try {
      const records = await generateImages({
        count: 1,
        customProvider: null,
        generationType: "text_to_image",
        model: "gpt-image-2",
        prompt: "缺省尺寸",
        providerMode: "built_in",
        size: "1024x1024",
        userId: "user-1",
      });
      expect(records[0]).toEqual({
        actualHeight: null,
        actualSize: null,
        actualWidth: null,
        url: "https://example.com/no-meta.png",
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("gpt-5 系列主线模型通过 Responses image_generation 工具生图", async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from([0x00, 0x00, 0x00, 0x0d]),
      Buffer.from("IHDR"),
      (() => {
        const data = Buffer.alloc(13);
        data.writeUInt32BE(1024, 0);
        data.writeUInt32BE(1024, 4);
        data.writeUInt8(8, 8);
        return data;
      })(),
      Buffer.alloc(4),
    ]);
    responsesCreateMock.mockImplementation(() =>
      responseStream([
        {
          result: png.toString("base64"),
          type: "image_generation_call",
        },
      ]),
    );

    const records = await generateImages({
      count: 2,
      customProvider: null,
      generationType: "text_to_image",
      model: "gpt-5.5",
      outputCompression: 80,
      outputFormat: "webp",
      prompt: "日漫风格晴天街景",
      providerMode: "built_in",
      quality: "high",
      size: "1024x1024",
      userId: "user-1",
    });

    expect(generateMock).not.toHaveBeenCalled();
    expect(responsesCreateMock).toHaveBeenCalledTimes(2);
    expect(responsesCreateMock).toHaveBeenCalledWith({
      input: "日漫风格晴天街景",
      model: "gpt-5.5",
      stream: true,
      tool_choice: { type: "image_generation" },
      tools: [
        {
          action: "generate",
          output_compression: 80,
          output_format: "webp",
          quality: "high",
          size: "1024x1024",
          type: "image_generation",
        },
      ],
    });
    expect(records).toHaveLength(2);
    expect(records[0]?.actualSize).toBe("1024x1024");
  });
});
