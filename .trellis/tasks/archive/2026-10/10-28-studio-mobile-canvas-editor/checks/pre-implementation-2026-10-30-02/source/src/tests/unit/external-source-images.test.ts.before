import { afterEach, describe, expect, it, vi } from "vitest";

import { downloadExternalImage } from "@/lib/external-api/source-images";

describe("外部参考图下载安全", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("拒绝本地或内网地址", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      downloadExternalImage("http://127.0.0.1/private.png"),
    ).rejects.toThrow("内网或保留地址");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("拒绝 IPv6 本地地址", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      downloadExternalImage("http://[::1]/private.png"),
    ).rejects.toThrow("内网或保留地址");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("拒绝重定向到本地地址", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        headers: { location: "http://127.0.0.1/private.png" },
        status: 302,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      downloadExternalImage("https://93.184.216.34/source.png"),
    ).rejects.toThrow("内网或保留地址");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("接收合法图片响应并生成文件信息", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: {
          "content-length": "3",
          "content-type": "image/png",
        },
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const image = await downloadExternalImage("https://93.184.216.34/source.png");

    expect(image.fileName).toBe("source-1.png");
    expect(image.mimeType).toBe("image/png");
    expect(image.data).toEqual(Buffer.from([1, 2, 3]));
  });

  it("允许公网 IPv6 图片地址", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1]), {
        headers: {
          "content-length": "1",
          "content-type": "image/webp",
        },
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const image = await downloadExternalImage("https://[2606:4700:4700::1111]/source.webp");

    expect(image.fileName).toBe("source-1.webp");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
