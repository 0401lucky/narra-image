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

import { GET } from "@/app/api/proxy-video/route";

function proxyRequest() {
  return new Request(
    "http://localhost/api/proxy-video?url=https%3A%2F%2Fcdn.example.com%2Fvideo.mp4",
  );
}

describe("视频代理接口", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentSession.mockResolvedValue({ userId: "user_1" });
  });

  it("校验 MP4 文件头并安全返回视频流", async () => {
    const mp4 = new Uint8Array([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
      0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x00, 0x00,
    ]);
    mockFetchPublicHttpUrl.mockResolvedValue(new Response(mp4));

    const response = await GET(proxyRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(mp4);
  });

  it("拒绝伪装成视频的内容", async () => {
    mockFetchPublicHttpUrl.mockResolvedValue(new Response("not-an-mp4"));

    const response = await GET(proxyRequest());

    expect(response.status).toBe(415);
  });

  it("根据 Content-Length 提前拒绝超大视频", async () => {
    mockFetchPublicHttpUrl.mockResolvedValue(new Response("x", {
      headers: { "content-length": String(513 * 1024 * 1024) },
    }));

    const response = await GET(proxyRequest());

    expect(response.status).toBe(413);
  });
});
