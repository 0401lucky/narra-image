import {
  mergeBuiltInProviderConfigInput,
  resolveBuiltInProviderConfig,
} from "@/lib/providers/built-in-provider-core";

describe("内置渠道配置", () => {
  it("存在后台配置时，优先使用后台配置", () => {
    const config = resolveBuiltInProviderConfig(
      {
        apiKey: "env-key",
        baseUrl: "https://env.example.com/v1",
        creditCost: 5,
        model: "gpt-image-1",
        models: [],
        name: "Env Provider",
      },
      {
        apiKey: "db-key",
        baseUrl: "https://db.example.com/v1",
        creditCost: 12,
        model: "gemini-2.5-flash-image",
        models: [],
        name: "DB Provider",
      },
    );

    expect(config).toEqual({
      apiKey: "db-key",
      baseUrl: "https://db.example.com/v1",
      creditCost: 12,
      model: "gemini-2.5-flash-image",
      models: [],
      name: "DB Provider",
    });
  });

  it("留空 API Key 时保留旧密钥，但允许更新其他字段", () => {
    const merged = mergeBuiltInProviderConfigInput(
      {
        apiKey: "",
        baseUrl: "https://new.example.com/v1",
        creditCost: 8,
        model: "gpt-image-1",
        models: [],
        name: "Studio New",
      },
      {
        apiKeyEncrypted: "encrypted-old-key",
        baseUrl: "https://old.example.com/v1",
        creditCost: 5,
        model: "old-model",
        models: [],
        name: "Studio Old",
      },
    );

    expect(merged).toEqual({
      apiKey: null,
      baseUrl: "https://new.example.com/v1",
      creditCost: 8,
      model: "gpt-image-1",
      models: [],
      name: "Studio New",
    });
  });
});
