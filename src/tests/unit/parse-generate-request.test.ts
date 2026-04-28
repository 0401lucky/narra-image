import { parseGenerateRequest } from "@/lib/generation/parse-generate-request";

describe("生成请求解析", () => {
  it("解析 JSON 文生图请求", async () => {
    const request = new Request("https://example.com/api/generate", {
      body: JSON.stringify({
        count: 1,
        generationType: "text_to_image",
        model: "gpt-image-1",
        prompt: "电影感夜景肖像",
        providerMode: "built_in",
        size: "1024x1024",
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    const result = await parseGenerateRequest(request);

    expect(result.generationType).toBe("text_to_image");
    expect(result.image).toBeNull();
    expect(result.prompt).toBe("电影感夜景肖像");
    expect(result.size).toBe("1024x1024");
  });

  it("解析 JSON 文生图请求时把比例 token 规整成像素尺寸", async () => {
    const request = new Request("https://example.com/api/generate", {
      body: JSON.stringify({
        count: 1,
        generationType: "text_to_image",
        model: "gpt-image-1",
        prompt: "电影感夜景肖像",
        providerMode: "built_in",
        size: "16:9",
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    const result = await parseGenerateRequest(request);

    expect(result.size).toBe("1824x1024");
  });

  it("解析 JSON 文生图请求时兼容旧像素值", async () => {
    const request = new Request("https://example.com/api/generate", {
      body: JSON.stringify({
        count: 1,
        generationType: "text_to_image",
        model: "gpt-image-1",
        prompt: "电影感夜景肖像",
        providerMode: "built_in",
        size: "1536x1024",
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    const result = await parseGenerateRequest(request);

    expect(result.size).toBe("1536x1024");
  });

  it("解析 form-data 图生图请求并提取参考图", async () => {
    const formData = new FormData();
    formData.append("generationType", "image_to_image");
    formData.append("model", "gpt-image-1");
    formData.append("prompt", "把这张图调成胶片质感");
    formData.append("providerMode", "built_in");
    formData.append("size", "9:16");
    formData.append("image", new File(["fake-image"], "source.png", { type: "image/png" }));

    const result = await parseGenerateRequest(formData);

    expect(result.generationType).toBe("image_to_image");
    expect(result.image?.name).toBe("source.png");
    expect(result.images).toHaveLength(1);
    expect(result.count).toBe(1);
    expect(result.size).toBe("1024x1824");
  });

  it("解析 JSON 文生图请求时保留高分辨率与输出参数", async () => {
    const request = new Request("https://example.com/api/generate", {
      body: JSON.stringify({
        count: 1,
        generationType: "text_to_image",
        model: "gpt-image-2",
        moderation: "low",
        outputCompression: 82,
        outputFormat: "webp",
        prompt: "电影感夜景肖像",
        providerMode: "built_in",
        quality: "high",
        size: "3840x2160",
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    const result = await parseGenerateRequest(request);

    expect(result.model).toBe("gpt-image-2");
    expect(result.size).toBe("3840x2160");
    expect(result.quality).toBe("high");
    expect(result.outputFormat).toBe("webp");
    expect(result.outputCompression).toBe(82);
    expect(result.moderation).toBe("low");
  });

  it("解析 form-data 图生图请求时支持多张参考图", async () => {
    const formData = new FormData();
    formData.append("generationType", "image_to_image");
    formData.append("model", "gpt-image-1");
    formData.append("prompt", "融合两张参考图的角色和背景");
    formData.append("providerMode", "built_in");
    formData.append("referenceImages", new File(["fake-image-a"], "source-a.png", { type: "image/png" }));
    formData.append("referenceImages", new File(["fake-image-b"], "source-b.png", { type: "image/png" }));

    const result = await parseGenerateRequest(formData);

    expect(result.images.map((image) => image.name)).toEqual(["source-a.png", "source-b.png"]);
    expect(result.image?.name).toBe("source-a.png");
  });

  it("图生图 form-data 未传 size 时默认使用 auto", async () => {
    const formData = new FormData();
    formData.append("generationType", "image_to_image");
    formData.append("model", "gpt-image-1");
    formData.append("prompt", "把这张图调成胶片质感");
    formData.append("providerMode", "built_in");
    formData.append("image", new File(["fake-image"], "source.png", { type: "image/png" }));

    const result = await parseGenerateRequest(formData);

    expect(result.size).toBe("auto");
  });

  it("图生图缺少参考图时直接报错", async () => {
    const formData = new FormData();
    formData.append("generationType", "image_to_image");
    formData.append("model", "gpt-image-1");
    formData.append("prompt", "把这张图调成胶片质感");
    formData.append("providerMode", "built_in");

    await expect(parseGenerateRequest(formData)).rejects.toThrow("请先上传参考图");
  });

  it("图生图参考图超过 16 张时报错", async () => {
    const formData = new FormData();
    formData.append("generationType", "image_to_image");
    formData.append("model", "gpt-image-1");
    formData.append("prompt", "融合大量参考图");
    formData.append("providerMode", "built_in");
    Array.from({ length: 17 }, (_, index) => {
      formData.append("referenceImages", new File(["fake-image"], `source-${index}.png`, { type: "image/png" }));
    });

    await expect(parseGenerateRequest(formData)).rejects.toThrow("参考图最多支持 16 张");
  });
});
