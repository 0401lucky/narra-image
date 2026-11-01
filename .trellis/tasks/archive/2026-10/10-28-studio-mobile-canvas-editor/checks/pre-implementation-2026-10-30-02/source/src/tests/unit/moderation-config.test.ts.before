import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDecryptProviderSecret, mockFindUnique } = vi.hoisted(() => ({
  mockDecryptProviderSecret: vi.fn(),
  mockFindUnique: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: { moderationConfig: { findUnique: mockFindUnique } },
}));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    AUTH_SECRET: "unit-test-secret",
    MODERATION_AI_ENABLED: false,
    MODERATION_API_KEY: "",
    MODERATION_BASE_URL: "",
    MODERATION_ENABLED: false,
    MODERATION_MODEL: "text-moderation-latest",
    MODERATION_SENSITIVE_WORDS_ENABLED: true,
    MODERATION_THRESHOLD: 0.5,
  }),
}));
vi.mock("@/lib/providers/provider-secret", () => ({
  decryptProviderSecret: mockDecryptProviderSecret,
  encryptProviderSecret: vi.fn(),
}));

import {
  getModerationConfigMeta,
  resolveModerationConfig,
} from "@/lib/moderation/config";

describe("审核配置", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolveModerationConfig：DB 优先且解密 key", async () => {
    mockFindUnique.mockResolvedValue({
      aiApiKeyEncrypted: "enc:key",
      aiBaseUrl: "https://x.example/v1",
      aiEnabled: true,
      aiModel: "custom-model",
      aiThreshold: 0.7,
      isEnabled: true,
      scope: "default",
      sensitiveWordsEnabled: false,
      updatedAt: new Date("2026-09-01T00:00:00Z"),
    });
    mockDecryptProviderSecret.mockResolvedValue("plain-key");

    const cfg = await resolveModerationConfig();

    expect(cfg).toEqual({
      aiApiKey: "plain-key",
      aiBaseUrl: "https://x.example/v1",
      aiEnabled: true,
      aiModel: "custom-model",
      aiThreshold: 0.7,
      isEnabled: true,
      sensitiveWordsEnabled: false,
    });
    expect(mockDecryptProviderSecret).toHaveBeenCalledWith(
      "enc:key",
      "unit-test-secret",
    );
  });

  it("无 DB 行时回退 env 默认", async () => {
    mockFindUnique.mockResolvedValue(null);

    const cfg = await resolveModerationConfig();

    expect(cfg).toEqual({
      aiApiKey: null,
      aiBaseUrl: null,
      aiEnabled: false,
      aiModel: "text-moderation-latest",
      aiThreshold: 0.5,
      isEnabled: false,
      sensitiveWordsEnabled: true,
    });
  });

  it("getModerationConfigMeta 不透出明文或加密 key", async () => {
    mockFindUnique.mockResolvedValue({
      aiApiKeyEncrypted: "enc:key",
      aiBaseUrl: "https://x.example/v1",
      aiEnabled: true,
      aiModel: "custom-model",
      aiThreshold: 0.7,
      isEnabled: true,
      scope: "default",
      sensitiveWordsEnabled: false,
      updatedAt: new Date("2026-09-01T00:00:00Z"),
    });
    mockDecryptProviderSecret.mockResolvedValue("plain-key");

    const meta = await getModerationConfigMeta();

    expect(meta.aiConfigured).toBe(true);
    expect(meta).not.toHaveProperty("aiApiKey");
    expect(meta).not.toHaveProperty("aiApiKeyEncrypted");
    expect(JSON.stringify(meta)).not.toContain("plain-key");
    expect(JSON.stringify(meta)).not.toContain("enc:key");
    expect(meta.aiBaseUrl).toBe("https://x.example/v1");
  });
});