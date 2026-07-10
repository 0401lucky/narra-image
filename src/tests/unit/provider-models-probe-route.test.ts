import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDecryptProviderSecret,
  mockFetchOpenAICompatibleModelIds,
  mockFindFirst,
  mockFindUnique,
  mockRequireAdminRecord,
  mockRequireCurrentUserRecord,
} = vi.hoisted(() => ({
  mockDecryptProviderSecret: vi.fn(),
  mockFetchOpenAICompatibleModelIds: vi.fn(),
  mockFindFirst: vi.fn(),
  mockFindUnique: vi.fn(),
  mockRequireAdminRecord: vi.fn(),
  mockRequireCurrentUserRecord: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    providerChannel: {
      findUnique: mockFindUnique,
    },
    savedProviderConfig: {
      findFirst: mockFindFirst,
    },
  },
}));

vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    AUTH_SECRET: "unit-test-secret",
    BUILTIN_PROVIDER_API_KEY: "site-secret-key",
  }),
}));

vi.mock("@/lib/providers/model-catalog", () => ({
  fetchOpenAICompatibleModelIds: mockFetchOpenAICompatibleModelIds,
  looksLikeImageModel: (id: string) => id.includes("image"),
}));

vi.mock("@/lib/providers/provider-secret", () => ({
  decryptProviderSecret: mockDecryptProviderSecret,
}));

vi.mock("@/lib/server/current-user", () => ({
  requireAdminRecord: mockRequireAdminRecord,
  requireCurrentUserRecord: mockRequireCurrentUserRecord,
}));

import { POST } from "@/app/api/provider-models/probe/route";

describe("模型探测接口", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDecryptProviderSecret.mockResolvedValue("decrypted-channel-key");
    mockFetchOpenAICompatibleModelIds.mockResolvedValue(["qwen-image", "qwen-video"]);
    mockFindFirst.mockResolvedValue(null);
    mockFindUnique.mockResolvedValue({
      apiKeyEncrypted: "encrypted-channel-key",
      baseUrl: "https://saved-channel.example.com/v1",
    });
    mockRequireAdminRecord.mockResolvedValue({ id: "admin_1" });
    mockRequireCurrentUserRecord.mockResolvedValue({ id: "admin_1" });
  });

  it("编辑已有后台渠道时复用已保存密钥拉取模型", async () => {
    const response = await POST(
      new Request("http://localhost/api/provider-models/probe", {
        method: "POST",
        body: JSON.stringify({
          baseUrl: "https://provider.example.com/v1",
          channelId: "channel_1",
        }),
      }),
    );

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mockRequireAdminRecord).toHaveBeenCalled();
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: "channel_1" },
      select: { apiKeyEncrypted: true, baseUrl: true },
    });
    expect(mockDecryptProviderSecret).toHaveBeenCalledWith(
      "encrypted-channel-key",
      "unit-test-secret",
    );
    expect(mockFetchOpenAICompatibleModelIds).toHaveBeenCalledWith({
      apiKey: "decrypted-channel-key",
      baseUrl: "https://saved-channel.example.com/v1",
    });
    expect(payload.data.models).toEqual([
      { id: "qwen-image", imageLikely: true },
      { id: "qwen-video", imageLikely: false },
    ]);
  });

  it("普通用户没有自有密钥时不会回退使用站点内置密钥", async () => {
    const response = await POST(
      new Request("http://localhost/api/provider-models/probe", {
        method: "POST",
        body: JSON.stringify({
          baseUrl: "https://attacker.example.com/v1",
        }),
      }),
    );

    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain("自己的 API Key");
    expect(mockFetchOpenAICompatibleModelIds).not.toHaveBeenCalled();
  });
});
