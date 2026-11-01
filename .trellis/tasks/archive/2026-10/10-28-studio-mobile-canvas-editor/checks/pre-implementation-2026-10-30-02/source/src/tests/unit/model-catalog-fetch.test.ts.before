import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFetchPublicHttpUrl } = vi.hoisted(() => ({
  mockFetchPublicHttpUrl: vi.fn(),
}));

vi.mock("@/lib/server/safe-remote-url", () => ({
  fetchPublicHttpUrl: mockFetchPublicHttpUrl,
}));

import { fetchOpenAICompatibleModelIds } from "@/lib/providers/model-catalog";

describe("模型列表远程请求", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockFetchPublicHttpUrl.mockReset();
  });

  it("通过固定公网连接请求模型列表", async () => {
    mockFetchPublicHttpUrl.mockResolvedValue(
      Response.json({ data: [{ id: "text-model" }, { id: "qwen-image" }] }),
    );

    const result = await fetchOpenAICompatibleModelIds({
      apiKey: "user-owned-key",
      baseUrl: "https://provider.example.com/v1?ignored=true",
    });

    expect(mockFetchPublicHttpUrl).toHaveBeenCalledWith(
      "https://provider.example.com/v1/models",
      expect.objectContaining({
        headers: {
          Accept: "application/json",
          Authorization: "Bearer user-owned-key",
        },
      }),
    );
    expect(result).toEqual(["qwen-image", "text-model"]);
  });

  it("地址校验失败时拒绝请求", async () => {
    mockFetchPublicHttpUrl.mockRejectedValueOnce(new Error("不允许访问内网地址"));

    await expect(fetchOpenAICompatibleModelIds({
      apiKey: "must-not-leak",
      baseUrl: "http://127.0.0.1:8080/v1",
    })).rejects.toThrow("不允许访问内网地址");
  });

  it("没有 Content-Length 时仍会流式拒绝超大响应", async () => {
    mockFetchPublicHttpUrl.mockResolvedValue(
      new Response("x".repeat(2 * 1024 * 1024 + 1)),
    );

    await expect(fetchOpenAICompatibleModelIds({
      apiKey: "user-owned-key",
      baseUrl: "https://provider.example.com/v1",
    })).rejects.toThrow("模型列表响应过大");
  });
});
