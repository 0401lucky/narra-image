import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDownloadExternalImage,
  mockFindGeneration,
  mockGetActiveChannels,
  mockRequireApiUser,
  mockRunExternalGeneration,
} = vi.hoisted(() => ({
  mockDownloadExternalImage: vi.fn(),
  mockFindGeneration: vi.fn(),
  mockGetActiveChannels: vi.fn(),
  mockRequireApiUser: vi.fn(),
  mockRunExternalGeneration: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    generationJob: {
      findFirst: mockFindGeneration,
    },
  },
}));

vi.mock("@/lib/external-api/source-images", () => ({
  downloadExternalImage: mockDownloadExternalImage,
}));

vi.mock("@/lib/server/api-auth", () => ({
  requireApiUser: mockRequireApiUser,
}));

vi.mock("@/lib/generation/external-api", () => ({
  runExternalGeneration: mockRunExternalGeneration,
}));

vi.mock("@/lib/providers/built-in-provider", () => ({
  getActiveChannels: mockGetActiveChannels,
}));

import { POST as chatPost } from "@/app/v1/chat/completions/route";
import { GET as generationGet } from "@/app/v1/generations/[id]/route";
import { POST as imageEditPost } from "@/app/v1/images/edits/route";
import { POST as imagePost } from "@/app/v1/images/generations/route";
import { GET as modelsGet } from "@/app/v1/models/route";
import { GET as rootModelsGet } from "@/app/models/route";
import { POST as rootImagePost } from "@/app/images/generations/route";

const auth = {
  apiKey: {
    id: "key_1",
    keyPrefix: "narra_sk_test",
    name: "测试 Key",
  },
  user: {
    avatarUrl: null,
    credits: 500,
    email: "user@example.com",
    id: "user_1",
    nickname: null,
    role: "user" as const,
  },
};

const completedJob = {
  createdAt: new Date("2026-05-05T12:00:00.000Z"),
  id: "job_1",
  images: [
    {
      height: 1024,
      url: "https://example.com/out.png",
      width: 1024,
    },
  ],
  model: "gpt-image-2",
};
const imageBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function jsonRequest(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    body: JSON.stringify(body),
    headers: {
      Authorization: "Bearer narra_sk_test",
      "Content-Type": "application/json",
    },
    method: "POST",
  });
}

function kelivoJsonRequest(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    body: JSON.stringify(body),
    headers: {
      Authorization: "Bearer narra_sk_test",
      "Content-Type": "application/json",
      "User-Agent": "Kelivo",
    },
    method: "POST",
  });
}

function multipartRequest(path: string, formData: FormData) {
  const req = new Request(`http://localhost${path}`, {
    body: formData,
    headers: {
      Authorization: "Bearer narra_sk_test",
    },
    method: "POST",
  });
  req.formData = async () => formData;
  return req;
}

describe("OpenAI 兼容外部 API", () => {
  beforeEach(() => {
    mockDownloadExternalImage.mockReset();
    mockFindGeneration.mockReset();
    mockGetActiveChannels.mockReset();
    mockRequireApiUser.mockReset();
    mockRunExternalGeneration.mockReset();
    mockDownloadExternalImage.mockResolvedValue({
      data: Buffer.from([1, 2, 3]),
      fileName: "source-1.png",
      mimeType: "image/png",
    });
    mockRequireApiUser.mockResolvedValue(auth);
    mockRunExternalGeneration.mockResolvedValue(completedJob);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(imageBytes, {
          headers: {
            "content-length": String(imageBytes.length),
            "content-type": "image/png",
          },
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("/v1/images/generations 返回图片生成结果", async () => {
    const response = await imagePost(
      jsonRequest("/v1/images/generations", {
        prompt: "测试提示词",
        size: "1024x1024",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      created: 1777982400,
      data: [
        {
          height: 1024,
          url: "https://example.com/out.png",
          width: 1024,
        },
      ],
      generation_id: "job_1",
    });
    expect(mockRunExternalGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKeyId: "key_1",
        input: expect.objectContaining({
          generationType: "text_to_image",
          prompt: "测试提示词",
        }),
      }),
    );
  });

  it("/v1/images/generations 支持 Cherry Studio 常用的 b64_json 返回", async () => {
    const response = await imagePost(
      jsonRequest("/v1/images/generations", {
        prompt: "测试提示词",
        response_format: "b64_json",
        size: "1024x1024",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      created: 1777982400,
      data: [
        {
          b64_json: imageBytes.toString("base64"),
          height: 1024,
          url: "https://example.com/out.png",
          width: 1024,
        },
      ],
      generation_id: "job_1",
    });
    expect(fetch).toHaveBeenCalledWith("https://example.com/out.png");
  });

  it("/v1/images/edits 支持 Kelivo 的远程参考图 JSON 请求", async () => {
    const response = await imageEditPost(
      jsonRequest("/v1/images/edits", {
        images: [{ image_url: "https://example.com/source.png" }],
        model: "gpt-image-2",
        prompt: "把背景改成蓝色",
        response_format: "url",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      created: 1777982400,
      data: [
        {
          height: 1024,
          url: "https://example.com/out.png",
          width: 1024,
        },
      ],
      generation_id: "job_1",
    });
    expect(mockDownloadExternalImage).toHaveBeenCalledWith(
      "https://example.com/source.png",
      0,
    );
    expect(mockRunExternalGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          generationType: "image_to_image",
          prompt: "把背景改成蓝色",
          sourceImages: [
            {
              data: Buffer.from([1, 2, 3]),
              fileName: "source-1.png",
              mimeType: "image/png",
            },
          ],
        }),
      }),
    );
  });

  it("/v1/images/edits 对 Kelivo 请求提前发送 JSON 保活", async () => {
    let finishGeneration: (job: typeof completedJob) => void = () => {};
    mockRunExternalGeneration.mockReturnValue(
      new Promise<typeof completedJob>((resolve) => {
        finishGeneration = resolve;
      }),
    );

    const response = await imageEditPost(
      kelivoJsonRequest("/v1/images/edits", {
        images: [{ image_url: "https://example.com/source.png" }],
        model: "gpt-image-2",
        prompt: "改成赛博朋克色调",
        response_format: "url",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");

    const reader = response.body?.getReader();
    expect(reader).toBeTruthy();
    const decoder = new TextDecoder();
    const firstChunk = await reader!.read();
    expect(decoder.decode(firstChunk.value)).toBe(" \n");

    finishGeneration(completedJob);

    let rest = "";
    while (true) {
      const chunk = await reader!.read();
      if (chunk.done) break;
      rest += decoder.decode(chunk.value);
    }

    expect(JSON.parse(rest.trim())).toEqual({
      created: 1777982400,
      data: [
        {
          height: 1024,
          url: "https://example.com/out.png",
          width: 1024,
        },
      ],
      generation_id: "job_1",
    });
  });

  it("/v1/images/edits 支持 Kelivo 的 multipart image[] 上传", async () => {
    const formData = new FormData();
    formData.append("model", "gpt-image-2");
    formData.append("prompt", "改成胶片质感");
    formData.append("image[]", new File([new Uint8Array([7, 8, 9])], "source.png", {
      type: "image/png",
    }));

    const response = await imageEditPost(
      multipartRequest("/v1/images/edits", formData),
    );

    expect(response.status).toBe(200);
    expect(mockRunExternalGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          generationType: "image_to_image",
          prompt: "改成胶片质感",
          sourceImages: [
            {
              data: Buffer.from([7, 8, 9]),
              fileName: "source.png",
              mimeType: "image/png",
            },
          ],
        }),
      }),
    );
  });

  it("根路径别名兼容未填写 /v1 的客户端", async () => {
    const imageResponse = await rootImagePost(
      jsonRequest("/images/generations", {
        prompt: "根路径文生图",
      }),
    );

    expect(imageResponse.status).toBe(200);

    mockGetActiveChannels.mockResolvedValue([
      {
        defaultModel: "gpt-image-2",
        models: ["gpt-image-2"],
      },
    ]);

    const modelsResponse = await rootModelsGet(
      new Request("http://localhost/models", {
        headers: { Authorization: "Bearer narra_sk_test" },
      }),
    );

    expect(modelsResponse.status).toBe(200);
    await expect(modelsResponse.json()).resolves.toEqual({
      data: [
        { id: "gpt-image-2", object: "model", owned_by: "narra-image" },
      ],
      object: "list",
    });
  });

  it("/v1/chat/completions 将最后一条 user 消息转成生图请求", async () => {
    const response = await chatPost(
      jsonRequest("/v1/chat/completions", {
        messages: [
          { role: "system", content: "你是图片生成器" },
          { role: "user", content: "画一张海报" },
        ],
        model: "narra-image",
      }),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.object).toBe("chat.completion");
    expect(json.choices[0].message.content).toContain("https://example.com/out.png");
    expect(json.usage).toEqual({
      completion_tokens: 0,
      prompt_tokens: 0,
      total_tokens: 0,
    });
    expect(mockRunExternalGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          generationType: "text_to_image",
          prompt: "画一张海报",
        }),
      }),
    );
  });

  it("/v1/chat/completions 兼容 stream=true 的客户端", async () => {
    const response = await chatPost(
      jsonRequest("/v1/chat/completions", {
        messages: [{ role: "user", content: "画一张流式兼容测试图" }],
        model: "narra-image",
        stream: true,
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const text = await response.text();
    expect(text).toContain('"object":"chat.completion.chunk"');
    expect(text).toContain("https://example.com/out.png");
    expect(text).toContain("data: [DONE]");
    expect(mockRunExternalGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          prompt: "画一张流式兼容测试图",
        }),
      }),
    );
  });

  it("/v1/chat/completions 支持 image_url 参考图并转为图生图", async () => {
    const response = await chatPost(
      jsonRequest("/v1/chat/completions", {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "按这张图改成手绘风" },
              { type: "image_url", image_url: { url: "https://example.com/source.png" } },
            ],
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    expect(mockDownloadExternalImage).toHaveBeenCalledWith(
      "https://example.com/source.png",
      0,
    );
    expect(mockRunExternalGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          generationType: "image_to_image",
          sourceImages: [
            {
              data: Buffer.from([1, 2, 3]),
              fileName: "source-1.png",
              mimeType: "image/png",
            },
          ],
        }),
      }),
    );
  });

  it("/v1/models 返回内置渠道模型列表", async () => {
    mockGetActiveChannels.mockResolvedValue([
      {
        defaultModel: "gpt-image-2",
        models: ["gpt-image-2", "seedream"],
      },
    ]);

    const response = await modelsGet(
      new Request("http://localhost/v1/models", {
        headers: { Authorization: "Bearer narra_sk_test" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [
        { id: "gpt-image-2", object: "model", owned_by: "narra-image" },
        { id: "seedream", object: "model", owned_by: "narra-image" },
      ],
      object: "list",
    });
  });

  it("/v1/generations/:id 只查询当前 API Key 创建的任务", async () => {
    mockFindGeneration.mockResolvedValue({
      createdAt: new Date("2026-05-05T12:00:00.000Z"),
      errorMessage: null,
      id: "job_1",
      images: [
        {
          height: 1024,
          id: "img_1",
          url: "https://example.com/out.png",
          width: 1024,
        },
      ],
      model: "gpt-image-2",
      status: "SUCCEEDED",
    });

    const response = await generationGet(
      new Request("http://localhost/v1/generations/job_1", {
        headers: { Authorization: "Bearer narra_sk_test" },
      }),
      { params: Promise.resolve({ id: "job_1" }) },
    );

    expect(response.status).toBe(200);
    expect(mockFindGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          apiKeyId: "key_1",
          clientSource: "API",
          id: "job_1",
        }),
      }),
    );
    await expect(response.json()).resolves.toEqual({
      created: 1777982400,
      error: null,
      id: "job_1",
      images: [
        {
          height: 1024,
          id: "img_1",
          url: "https://example.com/out.png",
          width: 1024,
        },
      ],
      model: "gpt-image-2",
      object: "image.generation",
      status: "succeeded",
    });
  });
});
