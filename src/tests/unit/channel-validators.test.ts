import { describe, expect, it } from "vitest";

import { channelCreateSchema, channelUpdateSchema } from "@/lib/validators";

describe("渠道参数校验", () => {
  it("创建渠道时接受视频积分消耗", () => {
    const parsed = channelCreateSchema.parse({
      apiKey: "sk-test",
      baseUrl: "https://provider.example.com/v1",
      creditCost: 6,
      defaultModel: "gpt-image-1",
      models: ["gpt-image-1"],
      name: "测试渠道",
      slug: "test-channel",
      videoCreditCost: 24,
    });

    expect(parsed.videoCreditCost).toBe(24);
  });

  it("更新渠道时允许单独修改视频积分消耗", () => {
    const parsed = channelUpdateSchema.parse({
      videoCreditCost: 18,
    });

    expect(parsed).toEqual({ videoCreditCost: 18 });
  });
});
