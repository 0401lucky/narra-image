import {
  calculateGenerationCost,
  hasEnoughCredits,
  resolveCreditCost,
  shouldChargeCredits,
} from "@/lib/credits";

describe("积分规则", () => {
  it("内置渠道默认每次扣 5 积分", () => {
    expect(
      calculateGenerationCost({
        providerMode: "built_in",
        builtInCreditCost: 5,
      }),
    ).toBe(5);
  });

  it("自填渠道不扣积分", () => {
    expect(
      calculateGenerationCost({
        providerMode: "custom",
        builtInCreditCost: 5,
      }),
    ).toBe(0);
  });

  it("只有内置渠道需要扣积分", () => {
    expect(shouldChargeCredits("built_in")).toBe(true);
    expect(shouldChargeCredits("custom")).toBe(false);
  });

  it("积分不足时禁止内置渠道生成", () => {
    expect(
      hasEnoughCredits({
        providerMode: "built_in",
        credits: 4,
        builtInCreditCost: 5,
      }),
    ).toBe(false);
  });

  it("视频生成类型取视频单价，图片类型取图片单价", () => {
    expect(
      resolveCreditCost({ generationType: "text_to_video", imageCreditCost: 5, videoCreditCost: 20 }),
    ).toBe(20);
    expect(
      resolveCreditCost({ generationType: "image_to_video", imageCreditCost: 5, videoCreditCost: 20 }),
    ).toBe(20);
    expect(
      resolveCreditCost({ generationType: "text_to_image", imageCreditCost: 5, videoCreditCost: 20 }),
    ).toBe(5);
    expect(
      resolveCreditCost({ generationType: "image_to_image", imageCreditCost: 5, videoCreditCost: 20 }),
    ).toBe(5);
  });
});
