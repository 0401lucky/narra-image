// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

// service.ts 在模块加载时经 @/lib/db 调用 getEnv()，因此必须在动态导入前
// 设置必需环境变量（静态 import 会被提升，这里统一用顶层赋值 + 动态导入）。
Object.assign(process.env, {
  AUTH_SECRET: "unit-test-secret",
  DATABASE_URL: "postgresql://localhost/test",
  NODE_ENV: "development",
  WORKER_INTERNAL_URL: "http://127.0.0.1:8081",
  WORKER_METRICS_TOKEN: "metrics-token-1234",
});

type PromptSyncService = typeof import("@/lib/prompts/service");

async function loadService(): Promise<PromptSyncService> {
  return import("@/lib/prompts/service");
}

describe("提示词同步转发（Node → Worker internal 端点）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("syncAll 转发空 body 并带 Bearer token", async () => {
    const { syncAllPromptSources } = await loadService();
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ results: [{ count: 3, slug: "a", status: "SUCCESS" }] }),
      { status: 200 },
    ));
    vi.stubGlobal("fetch", fetchMock);

    const results = await syncAllPromptSources();
    expect(results).toEqual([{ count: 3, slug: "a", status: "SUCCESS" }]);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8081/internal/prompt-sync");
    expect(JSON.parse(String(init.body))).toEqual({});
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer metrics-token-1234",
    );
  });

  it("syncPromptSource 转发单来源 ID", async () => {
    const { syncPromptSource } = await loadService();
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ results: [{ count: 5, slug: "b", status: "SUCCESS" }] }),
      { status: 200 },
    ));
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncPromptSource("b");
    expect(result).toEqual({ count: 5, slug: "b", status: "SUCCESS" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ sourceId: "b" });
  });

  it("上游失败返回明确错误", async () => {
    const { syncAllPromptSources } = await loadService();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("boom", { status: 500 }),
    ));
    await expect(syncAllPromptSources()).rejects.toThrow("HTTP 500");
  });

  it("fetch 中止（超时）时透传错误", async () => {
    const { syncAllPromptSources } = await loadService();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(
      new DOMException("The operation was aborted.", "AbortError"),
    ));
    await expect(syncAllPromptSources()).rejects.toThrow("aborted");
  });
});
