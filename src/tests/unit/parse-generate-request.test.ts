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
  });

  it("解析 form-data 图生图请求并提取参考图", async () => {
    const formData = new FormData();
    formData.append("generationType", "image_to_image");
    formData.append("model", "gpt-image-1");
    formData.append("prompt", "把这张图调成胶片质感");
    formData.append("providerMode", "built_in");
    formData.append("image", new File(["fake-image"], "source.png", { type: "image/png" }));

    const result = await parseGenerateRequest(formData);

    expect(result.generationType).toBe("image_to_image");
    expect(result.image?.name).toBe("source.png");
    expect(result.count).toBe(1);
  });

  it("图生图缺少参考图时直接报错", async () => {
    const formData = new FormData();
    formData.append("generationType", "image_to_image");
    formData.append("model", "gpt-image-1");
    formData.append("prompt", "把这张图调成胶片质感");
    formData.append("providerMode", "built_in");

    await expect(parseGenerateRequest(formData)).rejects.toThrow("请先上传参考图");
  });
});
