import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFetchPublicHttpUrl, mockGetCurrentSession } = vi.hoisted(() => ({
  mockFetchPublicHttpUrl: vi.fn(),
  mockGetCurrentSession: vi.fn(),
}));

vi.mock("@/lib/server/current-user", () => ({
  getCurrentSession: mockGetCurrentSession,
}));

vi.mock("@/lib/server/safe-remote-url", () => ({
  fetchPublicHttpUrl: mockFetchPublicHttpUrl,
}));

import { GET } from "@/app/api/proxy-image/route";

function proxyRequest() {
  return new Request(
    "http://localhost/api/proxy-image?url=https%3A%2F%2Fcdn.example.com%2Fimage",
  );
}

describe("图片代理接口", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockGetCurrentSession.mockResolvedValue({ userId: "user_1" });
    mockFetchPublicHttpUrl.mockReset();
  });

  it("只按文件签名返回图片并附加下载与防嗅探响应头", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    mockFetchPublicHttpUrl.mockResolvedValue(
      new Response(png, { headers: { "content-type": "text/html" } }),
    );

    const response = await GET(proxyRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(mockFetchPublicHttpUrl).toHaveBeenCalledWith(
      "https://cdn.example.com/image",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("拒绝伪装成图片的 HTML", async () => {
    mockFetchPublicHttpUrl.mockResolvedValue(
      new Response("<script>alert(1)</script>", {
        headers: { "content-type": "image/png" },
      }),
    );

    const response = await GET(proxyRequest());

    expect(response.status).toBe(415);
  });

  it("根据 Content-Length 提前拒绝超大响应", async () => {
    mockFetchPublicHttpUrl.mockResolvedValue(
      new Response("x", { headers: { "content-length": String(21 * 1024 * 1024) } }),
    );

    const response = await GET(proxyRequest());

    expect(response.status).toBe(413);
  });
});
