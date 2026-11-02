import { getThumbSrcSet, getThumbUrl, normalizeImageUrl } from "@/lib/image-url";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("图片缩略 URL", () => {
  it("默认绕过当前自建图片域名，避免 Next Image 因保留地址拒绝代理", () => {
    const url = "http://image.204152.xyz/user/result.png";

    expect(getThumbUrl(url, 640)).toBe("https://image.204152.xyz/user/result.png");
    expect(getThumbSrcSet(url, [256, 640])).toBe("");
  });

  it("upgrades the verified legacy CDN without changing path or signed query bytes", () => {
    const source = "HTTP://IMAGE.204152.XYZ/user/a%2fb.png?token=A%2fb+Z&part=2#preview";

    expect(normalizeImageUrl(source)).toBe(
      "https://IMAGE.204152.XYZ/user/a%2fb.png?token=A%2fb+Z&part=2#preview",
    );
  });

  it.each([
    "https://image.204152.xyz/user/result.png",
    "http://image.204152.xyz.evil.invalid/user/result.png",
    "http://image.204152.xyz@evil.invalid/user/result.png",
    "http://image.204152.xyz:8080/user/result.png",
    "http://image.204152.xyz:80/user/result.png",
    "http://other.invalid/user/result.png",
    "/local/result.png",
    "data:image/png;base64,dGVzdA==",
    "blob:https://unit.invalid/preview",
    "not a URL",
  ])("leaves unrelated origins and local previews unchanged: %s", (source) => {
    expect(normalizeImageUrl(source)).toBe(source);
  });

  it("does not assume custom optimizer-bypass hosts support HTTPS", () => {
    vi.stubEnv("NEXT_PUBLIC_IMAGE_OPTIMIZER_BYPASS_HOSTS", "other.invalid");
    const source = "http://other.invalid/result.png";

    expect(getThumbUrl(source, 640)).toBe(source);
    expect(getThumbSrcSet(source, [256, 640])).toBe("");
    expect(getThumbUrl("http://image.204152.xyz/user/result.png", 640)).toBe(
      "/_next/image?url=https%3A%2F%2Fimage.204152.xyz%2Fuser%2Fresult.png&w=640&q=75",
    );
  });

  it("其他远程图片继续走 Next Image 优化", () => {
    expect(getThumbUrl("https://example.com/result.png", 640)).toBe(
      "/_next/image?url=https%3A%2F%2Fexample.com%2Fresult.png&w=640&q=75",
    );
  });

  it("preserves optimizer widths and quality for other HTTP image origins", () => {
    expect(getThumbSrcSet("http://other.invalid/result.png", [640, 1080], 90)).toBe(
      "/_next/image?url=http%3A%2F%2Fother.invalid%2Fresult.png&w=640&q=90 640w, /_next/image?url=http%3A%2F%2Fother.invalid%2Fresult.png&w=1080&q=90 1080w",
    );
  });

  it.each([
    "data:image/png;base64,dGVzdA==",
    "blob:https://unit.invalid/preview",
    "/_next/image?url=%2Flocal.png&w=640&q=75",
  ])("does not rewrap previews or already optimized URLs: %s", (source) => {
    expect(getThumbUrl(source, 640)).toBe(source);
  });
});
