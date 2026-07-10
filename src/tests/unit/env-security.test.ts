import { afterEach, describe, expect, it, vi } from "vitest";

async function loadEnv() {
  vi.resetModules();
  return (await import("@/lib/env")).getEnv();
}

describe("环境变量安全校验", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("生产环境拒绝公开 AUTH_SECRET 占位值", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgresql://localhost/test");
    vi.stubEnv("AUTH_SECRET", "replace-with-strong-random-string-at-least-10-chars");

    await expect(loadEnv()).rejects.toThrow("AUTH_SECRET 不能使用公开占位值");
  });

  it("生产环境要求至少 32 位 AUTH_SECRET", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgresql://localhost/test");
    vi.stubEnv("AUTH_SECRET", "unit-test-secret");

    await expect(loadEnv()).rejects.toThrow("生产环境 AUTH_SECRET 至少需要 32 位");
  });

  it("测试环境兼容已有的短测试密钥", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DATABASE_URL", "postgresql://localhost/test");
    vi.stubEnv("AUTH_SECRET", "unit-test-secret");

    await expect(loadEnv()).resolves.toMatchObject({ AUTH_SECRET: "unit-test-secret" });
  });
});
