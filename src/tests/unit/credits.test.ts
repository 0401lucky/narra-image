import {
  calculateGenerationCost,
  hasEnoughCredits,
  resolveCreditCost,
  shouldChargeCredits,
} from "@/lib/credits";

describe("积分规则", () => {
  it("内置渠道按张扣费（默认 1 张扣 5 积分，4 张扣 20 积分）", () => {
    expect(
      calculateGenerationCost({
        providerMode: "built_in",
        builtInCreditCost: 5,
      }),
    ).toBe(5);
    expect(
      calculateGenerationCost({
        providerMode: "built_in",
        builtInCreditCost: 5,
        count: 4,
      }),
    ).toBe(20);
  });

  it("自填渠道无论张数均不扣积分", () => {
    expect(
      calculateGenerationCost({
        providerMode: "custom",
        builtInCreditCost: 5,
        count: 4,
      }),
    ).toBe(0);
  });

  it("只有内置渠道需要扣积分", () => {
    expect(shouldChargeCredits("built_in")).toBe(true);
    expect(shouldChargeCredits("custom")).toBe(false);
  });

  it("积分不足时禁止内置渠道生成（含多张总价校验）", () => {
    expect(
      hasEnoughCredits({
        providerMode: "built_in",
        credits: 4,
        builtInCreditCost: 5,
      }),
    ).toBe(false);
    expect(
      hasEnoughCredits({
        providerMode: "built_in",
        credits: 15,
        builtInCreditCost: 5,
        count: 4,
      }),
    ).toBe(false);
    expect(
      hasEnoughCredits({
        providerMode: "built_in",
        credits: 20,
        builtInCreditCost: 5,
        count: 4,
      }),
    ).toBe(true);
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
