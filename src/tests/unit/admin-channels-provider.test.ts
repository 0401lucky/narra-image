import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockBuiltInProviderConfigFindFirst, mockProviderChannelCreate, mockProviderChannelFindMany } =
  vi.hoisted(() => ({
    mockBuiltInProviderConfigFindFirst: vi.fn(),
    mockProviderChannelCreate: vi.fn(),
    mockProviderChannelFindMany: vi.fn(),
  }));

vi.mock("@/lib/db", () => ({
  db: {
    builtInProviderConfig: {
      findFirst: mockBuiltInProviderConfigFindFirst,
    },
    providerChannel: {
      create: mockProviderChannelCreate,
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

import { getChannelsForAdmin } from "@/lib/providers/built-in-provider";

describe("后台渠道列表", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuiltInProviderConfigFindFirst.mockResolvedValue(null);
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
