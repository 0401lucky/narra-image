import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreate,
  mockEncryptProviderSecret,
  mockFindUnique,
  mockGetChannelsForAdmin,
  mockRequireAdminRecord,
  mockUpdate,
} = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockEncryptProviderSecret: vi.fn(),
  mockFindUnique: vi.fn(),
  mockGetChannelsForAdmin: vi.fn(),
  mockRequireAdminRecord: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    providerChannel: {
      create: mockCreate,
      findUnique: mockFindUnique,
      update: mockUpdate,
    },
  },
}));

vi.mock("@/lib/env", () => ({
  getEnv: () => ({ AUTH_SECRET: "unit-test-secret" }),
}));

vi.mock("@/lib/providers/built-in-provider", () => ({
  getChannelsForAdmin: mockGetChannelsForAdmin,
}));

vi.mock("@/lib/providers/provider-secret", () => ({
  encryptProviderSecret: mockEncryptProviderSecret,
}));

vi.mock("@/lib/server/current-user", () => ({
  requireAdminRecord: mockRequireAdminRecord,
}));

import { POST } from "@/app/api/admin/channels/route";
import { PATCH } from "@/app/api/admin/channels/[id]/route";

describe("后台渠道 API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEncryptProviderSecret.mockResolvedValue("encrypted-key");
    mockGetChannelsForAdmin.mockResolvedValue([]);
    mockRequireAdminRecord.mockResolvedValue({ id: "admin_1" });
  });

  it("创建渠道时写入视频积分消耗", async () => {
    const response = await POST(
      new Request("http://localhost/api/admin/channels", {
        method: "POST",
        body: JSON.stringify({
          apiKey: "sk-test",
          baseUrl: "https://provider.example.com/v1",
          creditCost: 7,
          defaultModel: "gpt-image-1",
          isActive: true,
          models: ["gpt-image-1"],
          name: "测试渠道",
          slug: "test-channel",
          sortOrder: 2,
          videoCreditCost: 28,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        creditCost: 7,
        videoCreditCost: 28,
      }),
    });
  });

  it("更新渠道时写入视频积分消耗", async () => {
    mockFindUnique.mockResolvedValue({ id: "channel_1" });

    const response = await PATCH(
      new Request("http://localhost/api/admin/channels/channel_1", {
        method: "PATCH",
        body: JSON.stringify({
          creditCost: 8,
          videoCreditCost: 32,
        }),
      }),
      { params: Promise.resolve({ id: "channel_1" }) },
    );

    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "channel_1" },
      data: expect.objectContaining({
        creditCost: 8,
        videoCreditCost: 32,
      }),
    });
  });
});
