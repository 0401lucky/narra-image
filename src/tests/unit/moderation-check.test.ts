import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, mockResolveConfig, mockMatchWords } = vi.hoisted(() => {
  const contentReview = { create: vi.fn() };
  const resolveConfig = vi.fn();
  const matchWords = vi.fn();
  return {
    mockDb: { contentReview },
    mockMatchWords: matchWords,
    mockResolveConfig: resolveConfig,
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/moderation/config", () => ({
  resolveModerationConfig: mockResolveConfig,
}));
vi.mock("@/lib/moderation/sensitive-words", () => ({
  matchSensitiveWords: mockMatchWords,
}));

import { checkGenerationInput } from "@/lib/moderation/check";

function baseConfig(overrides: Record<string, unknown> = {}) {
  return {
    aiApiKey: null,
    aiBaseUrl: null,
    aiEnabled: false,
    aiModel: "text-moderation-latest",
    aiThreshold: 0.5,
    isEnabled: true,
    sensitiveWordsEnabled: true,
    ...overrides,
  };
}

describe("内容审核 checkGenerationInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("审核未启用时直接放行", async () => {
    mockResolveConfig.mockResolvedValue(
      baseConfig({ isEnabled: false }),
    );

    const result = await checkGenerationInput({ prompt: "色情图片", userId: "u1" });

    expect(result.allowed).toBe(true);
    expect(mockMatchWords).not.toHaveBeenCalled();
    expect(mockDb.contentReview.create).not.toHaveBeenCalled();
  });

  it("敏感词命中时阻断并记录", async () => {
    mockResolveConfig.mockResolvedValue(baseConfig());
    mockMatchWords.mockReturnValue([{ category: "NSFW", word: "色情" }]);

    const result = await checkGenerationInput({
      negativePrompt: "no gore",
      prompt: "色情图片",
      userId: "u1",
    });

    expect(result.allowed).toBe(false);
    expect(mockDb.contentReview.create).toHaveBeenCalledWith({
      data: {
        category: "NSFW",
        hitWords: ["色情"],
        kind: "sensitive_word",
        negativePrompt: "no gore",
        prompt: "色情图片",
        userId: "u1",
      },
    });
  });

  it("AI 已配置且判定违规时阻断并记录 ai_moderation", async () => {
    mockResolveConfig.mockResolvedValue(
      baseConfig({ aiApiKey: "key", aiBaseUrl: "https://x/v1", aiEnabled: true }),
    );
    mockMatchWords.mockReturnValue([]);
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({
        results: [{ category_scores: { sexual: 0.9, hate: 0.1 }, flagged: false }],
      }),
      ok: true,
    });

    const result = await checkGenerationInput({ prompt: "some prompt", userId: "u1" });

    expect(result.allowed).toBe(false);
    expect(mockDb.contentReview.create).toHaveBeenCalledWith({
      data: {
        aiModel: "text-moderation-latest",
        aiScore: 0.9,
        category: "sexual",
        kind: "ai_moderation",
        negativePrompt: null,
        prompt: "some prompt",
        userId: "u1",
      },
    });
  });

  it("AI 判定通过时放行", async () => {
    mockResolveConfig.mockResolvedValue(
      baseConfig({ aiApiKey: "key", aiBaseUrl: "https://x/v1", aiEnabled: true }),
    );
    mockMatchWords.mockReturnValue([]);
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({
        results: [{ category_scores: { sexual: 0.1 }, flagged: false }],
      }),
      ok: true,
    });

    const result = await checkGenerationInput({ prompt: "a cute cat", userId: "u1" });

    expect(result.allowed).toBe(true);
    expect(mockDb.contentReview.create).not.toHaveBeenCalled();
  });

  it("AI 审核异常时放行并记录告警（降级）", async () => {
    mockResolveConfig.mockResolvedValue(
      baseConfig({ aiApiKey: "key", aiBaseUrl: "https://x/v1", aiEnabled: true }),
    );
    mockMatchWords.mockReturnValue([]);
    global.fetch = vi.fn().mockRejectedValue(new Error("timeout"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await checkGenerationInput({ prompt: "ok prompt", userId: "u1" });

    expect(result.allowed).toBe(true);
    expect(mockDb.contentReview.create).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("AI 未配置端点时跳过 AI（不调用 fetch）", async () => {
    mockResolveConfig.mockResolvedValue(
      baseConfig({ aiApiKey: null, aiBaseUrl: null, aiEnabled: true }),
    );
    mockMatchWords.mockReturnValue([]);

    const result = await checkGenerationInput({ prompt: "ok prompt", userId: "u1" });

    expect(result.allowed).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("均未命中时放行且不记录", async () => {
    mockResolveConfig.mockResolvedValue(baseConfig());
    mockMatchWords.mockReturnValue([]);

    const result = await checkGenerationInput({ prompt: "a cute cat", userId: "u1" });

    expect(result.allowed).toBe(true);
    expect(mockDb.contentReview.create).not.toHaveBeenCalled();
  });
});