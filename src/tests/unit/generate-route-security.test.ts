import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockConversationFindFirst,
  mockDbTransaction,
  mockDecryptProviderSecret,
  mockEncryptProviderSecret,
  mockFailGenerationJobAndRefund,
  mockGetBuiltInProviderConfig,
  mockGetChannelById,
  mockParseGenerateRequest,
  mockPersistGeneratedImage,
  mockRequireCurrentUserRecord,
  mockRequireTurnstile,
  mockSavedProviderFindUnique,
} = vi.hoisted(() => ({
  mockConversationFindFirst: vi.fn(),
  mockDbTransaction: vi.fn(),
  mockDecryptProviderSecret: vi.fn(),
  mockEncryptProviderSecret: vi.fn(),
  mockFailGenerationJobAndRefund: vi.fn(),
  mockGetBuiltInProviderConfig: vi.fn(),
  mockGetChannelById: vi.fn(),
  mockParseGenerateRequest: vi.fn(),
  mockPersistGeneratedImage: vi.fn(),
  mockRequireCurrentUserRecord: vi.fn(),
  mockRequireTurnstile: vi.fn(),
  mockSavedProviderFindUnique: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: mockDbTransaction,
    conversation: { findFirst: mockConversationFindFirst },
    savedProviderConfig: { findUnique: mockSavedProviderFindUnique },
  },
}));

vi.mock("@/lib/env", () => ({
  getEnv: () => ({ AUTH_SECRET: "unit-test-secret" }),
}));

vi.mock("@/lib/generation/parse-generate-request", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/generation/parse-generate-request")>();
  return {
    ...original,
    parseGenerateRequest: mockParseGenerateRequest,
  };
});

vi.mock("@/lib/credits", () => ({
  calculateGenerationCost: vi.fn(() => 5),
  hasEnoughCredits: vi.fn(() => true),
  resolveCreditCost: vi.fn(() => 5),
}));

vi.mock("@/lib/prisma-mappers", () => ({
  serializeGeneration: vi.fn((job) => job),
  toPrismaGenerationType: vi.fn((value) => value),
  toPrismaProviderMode: vi.fn((value) => value),
}));

vi.mock("@/lib/providers/built-in-provider", () => ({
  getBuiltInProviderConfig: mockGetBuiltInProviderConfig,
  getChannelById: mockGetChannelById,
}));

vi.mock("@/lib/providers/provider-secret", () => ({
  decryptProviderSecret: mockDecryptProviderSecret,
  encryptProviderSecret: mockEncryptProviderSecret,
}));

vi.mock("@/lib/auth/turnstile", () => ({
  requireTurnstile: mockRequireTurnstile,
}));

vi.mock("@/lib/server/current-user", () => ({
  requireCurrentUserRecord: mockRequireCurrentUserRecord,
}));

vi.mock("@/lib/storage/persist-generated-image", () => ({
  persistGeneratedImage: mockPersistGeneratedImage,
}));

vi.mock("@/lib/generation/job-refund", () => ({
  failGenerationJobAndRefund: mockFailGenerationJobAndRefund,
}));

import { POST } from "@/app/api/generate/route";

function buildRequestBody(overrides: Record<string, unknown> = {}) {
  const image = new File(["image"], "reference.png", { type: "image/png" });
  return {
    aspectRatio: null,
    channelId: undefined,
    conversationId: undefined,
    count: 1,
    customProvider: null,
    durationSeconds: null,
    generationType: "image_to_image",
    image,
    imageUrls: ["https://8.8.8.8/reference.png"],
    images: [image],
    model: "gpt-image-1",
    moderation: "auto",
    negativePrompt: null,
    outputCompression: null,
    outputFormat: "png",
    prompt: "测试生成请求",
    providerMode: "built_in",
    quality: "auto",
    replaceGenerationId: undefined,
    seed: null,
    size: "auto",
    turnstileToken: undefined,
    ...overrides,
  };
}

describe("生成接口安全校验顺序", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireCurrentUserRecord.mockResolvedValue({ credits: 100, id: "user_1" });
    mockGetBuiltInProviderConfig.mockResolvedValue({
      apiKey: "builtin-key",
      baseUrl: "https://provider.example.com/v1",
      creditCost: 5,
      id: "channel_1",
      model: "gpt-image-1",
      models: ["gpt-image-1"],
      name: "内置渠道",
      videoCreditCost: 20,
    });
    mockRequireTurnstile.mockResolvedValue(undefined);
  });

  it("参考图 URL 指向内网时在上传前拒绝", async () => {
    mockParseGenerateRequest.mockResolvedValue(buildRequestBody({
      imageUrls: ["http://127.0.0.1/private.png"],
    }));

    const response = await POST(new Request("https://example.com/api/generate", { method: "POST" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "参考图 URL仅支持公网 HTTP(S) 地址",
    });
    expect(mockPersistGeneratedImage).not.toHaveBeenCalled();
    expect(mockDbTransaction).not.toHaveBeenCalled();
  });

  it("自填渠道指向内网时在加密和上传前拒绝", async () => {
    mockParseGenerateRequest.mockResolvedValue(buildRequestBody({
      customProvider: {
        apiKey: "custom-key",
        baseUrl: "http://[::1]/v1",
        label: "自填渠道",
        model: "custom-model",
        models: ["custom-model"],
        remember: false,
      },
      model: "custom-model",
      providerMode: "custom",
    }));

    const response = await POST(new Request("https://example.com/api/generate", { method: "POST" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "自填渠道 Base URL仅支持公网 HTTP(S) 地址",
    });
    expect(mockEncryptProviderSecret).not.toHaveBeenCalled();
    expect(mockPersistGeneratedImage).not.toHaveBeenCalled();
  });

  it("已保存的自填渠道指向内网时同样拒绝", async () => {
    mockParseGenerateRequest.mockResolvedValue(buildRequestBody({
      customProvider: null,
      model: "custom-model",
      providerMode: "custom",
    }));
    mockSavedProviderFindUnique.mockResolvedValue({
      apiKeyEncrypted: "encrypted-key",
      baseUrl: "http://10.0.0.8/v1",
      label: "已保存渠道",
      model: "custom-model",
      models: ["custom-model"],
    });
    mockDecryptProviderSecret.mockResolvedValue("custom-key");

    const response = await POST(new Request("https://example.com/api/generate", { method: "POST" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "自填渠道 Base URL仅支持公网 HTTP(S) 地址",
    });
    expect(mockDecryptProviderSecret).toHaveBeenCalledWith(
      "encrypted-key",
      "unit-test-secret",
    );
    expect(mockEncryptProviderSecret).not.toHaveBeenCalled();
    expect(mockPersistGeneratedImage).not.toHaveBeenCalled();
  });

  it("无权访问的会话在上传参考图前拒绝", async () => {
    mockParseGenerateRequest.mockResolvedValue(buildRequestBody({
      conversationId: "conversation_other",
    }));
    mockConversationFindFirst.mockResolvedValue(null);

    const response = await POST(new Request("https://example.com/api/generate", { method: "POST" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "会话不存在或不属于当前用户",
    });
    expect(mockConversationFindFirst).toHaveBeenCalled();
    expect(mockPersistGeneratedImage).not.toHaveBeenCalled();
    expect(mockDbTransaction).not.toHaveBeenCalled();
  });
});
