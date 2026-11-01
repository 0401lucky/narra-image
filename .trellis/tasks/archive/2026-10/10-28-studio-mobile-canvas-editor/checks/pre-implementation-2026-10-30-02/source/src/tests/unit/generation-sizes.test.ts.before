import {
  calculateImageSize,
  getAspectRatio,
  normalizeGenerationSize,
} from "@/lib/generation/sizes";

describe("生图尺寸规整", () => {
  it("支持 gpt-image-2 的高分辨率尺寸", () => {
    expect(normalizeGenerationSize("3840x2160")).toBe("3840x2160");
    expect(normalizeGenerationSize("2160x3840")).toBe("2160x3840");
  });

  it("把比例值转换为合法像素尺寸", () => {
    expect(normalizeGenerationSize("16:9")).toBe("1824x1024");
    expect(normalizeGenerationSize("9:16")).toBe("1024x1824");
  });

  it("把自定义像素规整到 16 的倍数和合法上限", () => {
    expect(normalizeGenerationSize("2050x1150")).toBe("2048x1152");
    expect(normalizeGenerationSize("5000x5000")).toBe("2880x2880");
  });

  it("按档位和比例计算尺寸", () => {
    expect(calculateImageSize("2K", "16:9")).toBe("2048x1152");
    expect(calculateImageSize("4K", "16:9")).toBe("3840x2160");
  });

  it("从像素尺寸得到展示比例", () => {
    expect(getAspectRatio("2048x1152")).toBe("2048 / 1152");
  });
});
