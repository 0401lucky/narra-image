import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockBuiltInProviderConfigFindFirst,
  mockDecryptProviderSecret,
  mockProviderChannelCreate,
  mockProviderChannelFindFirst,
  mockProviderChannelFindMany,
} =
  vi.hoisted(() => ({
    mockBuiltInProviderConfigFindFirst: vi.fn(),
    mockDecryptProviderSecret: vi.fn(),
    mockProviderChannelCreate: vi.fn(),
    mockProviderChannelFindFirst: vi.fn(),
    mockProviderChannelFindMany: vi.fn(),
  }));

vi.mock("@/lib/db", () => ({
  db: {
    builtInProviderConfig: {
      findFirst: mockBuiltInProviderConfigFindFirst,
    },
    providerChannel: {
      create: mockProviderChannelCreate,
      findFirst: mockProviderChannelFindFirst,
      findMany: mockProviderChannelFindMany,
    },
  },
}));

vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    AUTH_SECRET: "unit-test-secret",
    BUILTIN_PROVIDER_VIDEO_CREDIT_COST: 22,
  }),
}));

vi.mock("@/lib/providers/provider-secret", () => ({
  decryptProviderSecret: mockDecryptProviderSecret,
}));

import { getChannelById, getChannelsForAdmin } from "@/lib/providers/built-in-provider";

describe("后台渠道列表", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDecryptProviderSecret.mockResolvedValue("decrypted-key");
    mockBuiltInProviderConfigFindFirst.mockResolvedValue(null);
  });

  it("按 ID 获取渠道时只查询启用渠道", async () => {
    mockProviderChannelFindFirst.mockResolvedValue(null);

    await expect(getChannelById("channel_disabled")).resolves.toBeNull();

    expect(mockProviderChannelFindFirst).toHaveBeenCalledWith({
      where: { id: "channel_disabled", isActive: true },
    });
    expect(mockDecryptProviderSecret).not.toHaveBeenCalled();
  });

  it("返回启用渠道并解密密钥", async () => {
    mockProviderChannelFindFirst.mockResolvedValue({
      apiKeyEncrypted: "encrypted-key",
      baseUrl: "https://provider.example.com/v1",
      creditCost: 6,
      defaultModel: "gpt-image-1",
      id: "channel_active",
      isActive: true,
      models: ["gpt-image-1"],
      name: "测试渠道",
      videoCreditCost: 26,
    });

    await expect(getChannelById("channel_active")).resolves.toMatchObject({
      apiKey: "decrypted-key",
      id: "channel_active",
    });
  });

  it("返回渠道的视频积分消耗", async () => {
    mockProviderChannelFindMany.mockResolvedValue([
      {
        apiKeyEncrypted: "encrypted-key",
        baseUrl: "https://provider.example.com/v1",
        creditCost: 6,
        defaultModel: "gpt-image-1",
        id: "channel_1",
        isActive: true,
        models: ["gpt-image-1"],
        name: "测试渠道",
        slug: "test-channel",
        sortOrder: 0,
        videoCreditCost: 26,
      },
    ]);

    await expect(getChannelsForAdmin()).resolves.toEqual([
      expect.objectContaining({
        creditCost: 6,
        id: "channel_1",
        videoCreditCost: 26,
      }),
    ]);
  });

  it("迁移旧配置时使用环境默认视频积分消耗", async () => {
    mockProviderChannelFindMany.mockResolvedValue([]);
    mockBuiltInProviderConfigFindFirst.mockResolvedValue({
      apiKeyEncrypted: "encrypted-key",
      baseUrl: "https://legacy.example.com/v1",
      creditCost: 5,
      model: "gpt-image-1",
      models: ["gpt-image-1"],
      name: "旧渠道",
    });
    mockProviderChannelCreate.mockResolvedValue({
      apiKeyEncrypted: "encrypted-key",
      baseUrl: "https://legacy.example.com/v1",
      creditCost: 5,
      defaultModel: "gpt-image-1",
      id: "channel_legacy",
      isActive: true,
      models: ["gpt-image-1"],
      name: "旧渠道",
      slug: "default",
      sortOrder: 0,
      videoCreditCost: 22,
    });

    await getChannelsForAdmin();

    expect(mockProviderChannelCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        videoCreditCost: 22,
      }),
    });
  });
});
