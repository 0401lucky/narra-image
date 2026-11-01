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
    vi.stubEnv("APP_URL", "https://narra.example.com");
    vi.stubEnv("DATABASE_URL", "postgresql://localhost/test");
    vi.stubEnv("AUTH_SECRET", "replace-with-strong-random-string-at-least-10-chars");

    await expect(loadEnv()).rejects.toThrow("AUTH_SECRET 不能使用公开占位值");
  });

  it("生产环境要求至少 32 位 AUTH_SECRET", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "https://narra.example.com");
    vi.stubEnv("DATABASE_URL", "postgresql://localhost/test");
    vi.stubEnv("AUTH_SECRET", "unit-test-secret");

    await expect(loadEnv()).rejects.toThrow("生产环境 AUTH_SECRET 至少需要 32 位");
  });

  it("测试环境兼容已有的短测试密钥", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DATABASE_URL", "postgresql://localhost/test");
    vi.stubEnv("AUTH_SECRET", "unit-test-secret");

    await expect(loadEnv()).resolves.toMatchObject({
      APP_URL: "http://localhost:3000",
      AUTH_SECRET: "unit-test-secret",
    });
  });

  it("生产环境要求显式配置 APP_URL", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgresql://localhost/test");
    vi.stubEnv("AUTH_SECRET", "a-production-secret-that-is-longer-than-32-chars");

    await expect(loadEnv()).rejects.toThrow("生产环境 APP_URL 必须显式配置");
  });

  it.each([
    "http://localhost:3000",
    "http://app.localhost:3000",
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
    "http://0.0.0.0:3000",
  ])("生产环境拒绝本地 APP_URL：%s", async (appUrl) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", appUrl);
    vi.stubEnv("DATABASE_URL", "postgresql://localhost/test");
    vi.stubEnv("AUTH_SECRET", "a-production-secret-that-is-longer-than-32-chars");

    await expect(loadEnv()).rejects.toThrow(
      "生产环境 APP_URL 不能使用 localhost 或 loopback 地址",
    );
  });

  it("生产环境接受显式公网 HTTP(S) APP_URL", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "https://narra.example.com");
    vi.stubEnv("DATABASE_URL", "postgresql://localhost/test");
    vi.stubEnv("AUTH_SECRET", "a-production-secret-that-is-longer-than-32-chars");

    await expect(loadEnv()).resolves.toMatchObject({
      APP_URL: "https://narra.example.com",
    });
  });

  it("接受已百分号编码的完整 PostgreSQL URL", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "https://narra.example.com");
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://narra:p%40%3A%23%3F%2F@localhost:5432/narra?schema=public",
    );
    vi.stubEnv("AUTH_SECRET", "a-production-secret-that-is-longer-than-32-chars");

    await expect(loadEnv()).resolves.toMatchObject({
      DATABASE_URL:
        "postgresql://narra:p%40%3A%23%3F%2F@localhost:5432/narra?schema=public",
    });
  });

  it("拒绝未编码的数据库凭证特殊字符", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DATABASE_URL", "postgresql://narra:p@ss@localhost:5432/narra");
    vi.stubEnv("AUTH_SECRET", "unit-test-secret");

    await expect(loadEnv()).rejects.toThrow(
      "DATABASE_URL 用户名和密码中的特殊字符必须进行百分号编码",
    );
  });

  it("统一解析 readiness 布尔值与默认值", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DATABASE_URL", "postgresql://localhost/test");
    vi.stubEnv("AUTH_SECRET", "unit-test-secret");
    vi.stubEnv("WORKER_READINESS_REQUIRED", "no");

    await expect(loadEnv()).resolves.toMatchObject({
      WORKER_INTERNAL_URL: "http://127.0.0.1:8081",
      WORKER_READINESS_REQUIRED: false,
      WORKER_READINESS_TIMEOUT_MS: 2000,
    });
  });

  it("限制 Worker readiness 单次请求超时", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DATABASE_URL", "postgresql://localhost/test");
    vi.stubEnv("AUTH_SECRET", "unit-test-secret");
    vi.stubEnv("WORKER_READINESS_TIMEOUT_MS", "99");

    await expect(loadEnv()).rejects.toThrow("Too small");
  });

  it("拒绝带凭证的 Worker 内部地址", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DATABASE_URL", "postgresql://localhost/test");
    vi.stubEnv("AUTH_SECRET", "unit-test-secret");
    vi.stubEnv("WORKER_INTERNAL_URL", "http://user:secret@worker:8081");

    await expect(loadEnv()).rejects.toThrow(
      "WORKER_INTERNAL_URL 不允许包含凭证、查询参数或 fragment",
    );
  });
});
