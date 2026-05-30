import { getThumbSrcSet, getThumbUrl } from "@/lib/image-url";

describe("图片缩略 URL", () => {
  it("默认绕过当前自建图片域名，避免 Next Image 因保留地址拒绝代理", () => {
    const url = "http://image.204152.xyz/user/result.png";

    expect(getThumbUrl(url, 640)).toBe(url);
    expect(getThumbSrcSet(url, [256, 640])).toBe("");
  });

  it("其他远程图片继续走 Next Image 优化", () => {
    expect(getThumbUrl("https://example.com/result.png", 640)).toBe(
      "/_next/image?url=https%3A%2F%2Fexample.com%2Fresult.png&w=640&q=75",
    );
  });
});
