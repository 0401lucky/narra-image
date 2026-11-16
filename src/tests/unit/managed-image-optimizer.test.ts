// @vitest-environment node

import { managedImageOptimizerRewrite } from "@/lib/storage/image-optimizer";

const token = "a".repeat(64);
const appUrl = "https://images.example.test/studio";
const image = `${appUrl}/media/images/${token}`;
const optimizer = (source: string) => `http://next:3000/_next/image?url=${encodeURIComponent(source)}&w=384&q=90`;

describe("managed image optimizer internal source", () => {
  it("rewrites only its exact public image origin/base path and preserves optimizer parameters", () => {
    const rewritten = managedImageOptimizerRewrite(optimizer(image), appUrl)!;
    expect(rewritten.origin).toBe("http://next:3000");
    expect(rewritten.pathname).toBe("/_next/image");
    expect(rewritten.searchParams.get("url")).toBe(`/studio/media/images/${token}`);
    expect(rewritten.searchParams.get("w")).toBe("384");
    expect(rewritten.searchParams.get("q")).toBe("90");
  });

  it.each([
    `https://foreign.example.test/studio/media/images/${token}`,
    `http://images.example.test/studio/media/images/${token}`,
    `https://images.example.test/media/images/${token}`,
    `${image}?download=1`, `${image}#fragment`, `${image}/`, image.toUpperCase(),
    `${appUrl}/media/images/%61${token.slice(1)}`,
    `${appUrl}/media/images/../images/${token}`,
    `${appUrl}/api/proxy-image?url=http://127.0.0.1`,
    `/studio/media/images/${token}`, "data:image/png;base64,AAAA", "not a URL",
  ])("leaves unrelated or noncanonical source unchanged: %s", (source) => {
    expect(managedImageOptimizerRewrite(optimizer(source), appUrl)).toBeNull();
  });

  it("does not choose one of several source parameters", () => {
    expect(managedImageOptimizerRewrite(`${optimizer(image)}&url=${encodeURIComponent(image)}`, appUrl)).toBeNull();
  });
  it("accepts Go URLs that retain own host casing and the default TLS port", () => {
    const source = `https://Images.example.test:443/studio/media/images/${token}`;
    expect(managedImageOptimizerRewrite(optimizer(source), "https://Images.example.test:443/studio")?.searchParams.get("url"))
      .toBe(`/studio/media/images/${token}`);
  });
});
