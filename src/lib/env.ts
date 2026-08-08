import "server-only";

import { z } from "zod";

const PUBLIC_AUTH_SECRETS = new Set([
  "change-me",
  "changeme",
  "replace-me",
  "replace-this-secret",
  "replace-with-strong-random-string-at-least-10-chars",
]);

const TRUE_ENV_VALUES = new Set(["1", "true", "yes"]);
const FALSE_ENV_VALUES = new Set(["0", "false", "no"]);
const ENCODED_CREDENTIAL_COMPONENT = /^(?:[A-Za-z0-9._~-]|%[0-9A-Fa-f]{2})*$/;
const DEFAULT_APP_URL = "http://localhost:3000";

function booleanEnv(defaultValue: boolean) {
  return z.preprocess((rawValue) => {
    if (rawValue === undefined || rawValue === null || rawValue === "") {
      return defaultValue;
    }
    if (typeof rawValue === "boolean") {
      return rawValue;
    }
    if (typeof rawValue === "string") {
      const normalized = rawValue.trim().toLowerCase();
      if (TRUE_ENV_VALUES.has(normalized)) return true;
      if (FALSE_ENV_VALUES.has(normalized)) return false;
    }
    return rawValue;
  }, z.boolean());
}

function integerEnv(defaultValue: number, minimum = 1, maximum = 2_147_483_647) {
  return z.preprocess(
    (rawValue) => rawValue === undefined || rawValue === null || rawValue === ""
      ? defaultValue
      : rawValue,
    z.coerce.number().int().min(minimum).max(maximum),
  );
}

function optionalString() {
  return z.string().trim().optional().default("");
}

function optionalUrl() {
  return z.union([z.literal(""), z.string().url()]).optional().default("");
}

function isLocalAppUrl(rawValue: string) {
  const hostname = new URL(rawValue).hostname
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  return hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

function validateDatabaseUrl(rawValue: string, ctx: z.RefinementCtx) {
  let parsed: URL;
  try {
    parsed = new URL(rawValue);
  } catch {
    ctx.addIssue({
      code: "custom",
      message: "DATABASE_URL 必须是完整的 PostgreSQL URL",
    });
    return;
  }

  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    ctx.addIssue({
      code: "custom",
      message: "DATABASE_URL 仅支持 postgres:// 或 postgresql://",
    });
  }
  if (!parsed.hostname) {
    ctx.addIssue({
      code: "custom",
      message: "DATABASE_URL 必须包含数据库主机",
    });
  }
  if (!parsed.pathname || parsed.pathname === "/") {
    ctx.addIssue({
      code: "custom",
      message: "DATABASE_URL 必须包含数据库名称",
    });
  }
  if (parsed.hash) {
    ctx.addIssue({
      code: "custom",
      message: "DATABASE_URL 不允许包含 URL fragment",
    });
  }

  const authorityStart = rawValue.indexOf("://") + 3;
  const authorityEndOffset = rawValue.slice(authorityStart).search(/[/?#]/);
  const authorityEnd = authorityEndOffset === -1
    ? rawValue.length
    : authorityStart + authorityEndOffset;
  const authority = rawValue.slice(authorityStart, authorityEnd);
  const lastAt = authority.lastIndexOf("@");
  if (lastAt === -1) return;

  const rawUserInfo = authority.slice(0, lastAt);
  const separator = rawUserInfo.indexOf(":");
  const rawUsername = separator === -1 ? rawUserInfo : rawUserInfo.slice(0, separator);
  const rawPassword = separator === -1 ? "" : rawUserInfo.slice(separator + 1);
  if (
    rawUserInfo.slice(separator + 1).includes(":") ||
    rawUserInfo.includes("@") ||
    !ENCODED_CREDENTIAL_COMPONENT.test(rawUsername) ||
    !ENCODED_CREDENTIAL_COMPONENT.test(rawPassword)
  ) {
    ctx.addIssue({
      code: "custom",
      message: "DATABASE_URL 用户名和密码中的特殊字符必须进行百分号编码",
    });
  }
}

const databaseUrlSchema = z.string().trim().min(1, "DATABASE_URL 不能为空")
  .superRefine(validateDatabaseUrl);

const workerInternalUrlSchema = z.string().trim().url()
  .transform((rawValue, ctx) => {
    const parsed = new URL(rawValue);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      ctx.addIssue({
        code: "custom",
        message: "WORKER_INTERNAL_URL 仅支持 HTTP(S)",
      });
      return z.NEVER;
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      ctx.addIssue({
        code: "custom",
        message: "WORKER_INTERNAL_URL 不允许包含凭证、查询参数或 fragment",
      });
      return z.NEVER;
    }
    return rawValue.replace(/\/+$/, "");
  });

const appUrlSchema = z.string().trim().url().superRefine((rawValue, ctx) => {
  const protocol = new URL(rawValue).protocol;
  if (protocol !== "http:" && protocol !== "https:") {
    ctx.addIssue({
      code: "custom",
      message: "APP_URL 仅支持 HTTP(S)",
    });
  }
});

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.preprocess(
    (rawValue) => typeof rawValue === "string" && rawValue.trim() === ""
      ? undefined
      : rawValue,
    appUrlSchema.optional(),
  ),
  AUTH_SECRET: z.string().trim().min(10, "AUTH_SECRET 至少需要 10 位"),
  DATABASE_URL: databaseUrlSchema,
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional().or(z.literal("")),
  BOOTSTRAP_INVITE_CODE: optionalString(),
  BUILTIN_PROVIDER_API_KEY: optionalString(),
  BUILTIN_PROVIDER_BASE_URL: optionalUrl(),
  BUILTIN_PROVIDER_CREDIT_COST: integerEnv(5),
  BUILTIN_PROVIDER_MODEL: z.string().trim().min(1).default("gpt-image-2"),
  BUILTIN_PROVIDER_NAME: z.string().trim().min(1).default("Studio"),
  BUILTIN_PROVIDER_VIDEO_CREDIT_COST: integerEnv(20),
  BUILTIN_PROVIDER_VIDEO_MODEL: z.string().trim().min(1).default("sora-2"),
  DATABASE_READY_ATTEMPTS: integerEnv(180, 1, 10_000),
  DATABASE_READY_DELAY_MS: integerEnv(2_000, 100, 60_000),
  ENABLE_EMBEDDED_WORKER: booleanEnv(true),
  ENABLE_LOCAL_IMAGE_FALLBACK: booleanEnv(true),
  EXTERNAL_GENERATION_POLL_INTERVAL_MS: integerEnv(1_000, 1, 60_000),
  EXTERNAL_GENERATION_WAIT_TIMEOUT_SECONDS: integerEnv(900, 1, 86_400),
  GATEWAY_ENABLED: booleanEnv(false),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  S3_ACCESS_KEY_ID: optionalString(),
  S3_BUCKET: optionalString(),
  S3_ENDPOINT: optionalUrl(),
  S3_PUBLIC_BASE_URL: optionalUrl(),
  S3_REGION: z.string().trim().min(1).default("auto"),
  S3_SECRET_ACCESS_KEY: optionalString(),
  WORKER_COMMAND: z.string().trim().min(1).default("./narra-worker"),
  WORKER_CONCURRENCY: integerEnv(2, 1, 256),
  WORKER_CONTRACTS_V1_ENABLED: booleanEnv(false),
  WORKER_HTTP_ADDR: z.string().trim().min(1).default("127.0.0.1:8081"),
  WORKER_INTERNAL_URL: workerInternalUrlSchema.default("http://127.0.0.1:8081"),
  WORKER_JOB_TIMEOUT_SECONDS: integerEnv(900, 1, 86_400),
  WORKER_MAX_ACTIVE_PER_USER: integerEnv(1, 1, 1_000),
  WORKER_MAX_ATTEMPTS: integerEnv(2, 1, 100),
  WORKER_METRICS_TOKEN: z.union([
    z.literal(""),
    z.string().trim().min(16, "WORKER_METRICS_TOKEN 至少需要 16 位"),
  ]).optional().default(""),
  WORKER_METRICS_WINDOW_MINUTES: integerEnv(1_440, 1, 525_600),
  WORKER_POLL_INTERVAL_MS: integerEnv(1_000, 10, 60_000),
  WORKER_READINESS_REQUIRED: booleanEnv(true),
  WORKER_READINESS_TIMEOUT_MS: integerEnv(2_000, 100, 30_000),
  WORKER_READY_POLL_INTERVAL_MS: integerEnv(1_000, 100, 30_000),
  WORKER_READY_TIMEOUT_MS: integerEnv(60_000, 1_000, 600_000),
  WORKER_RETRY_BASE_DELAY_MS: integerEnv(1_000, 1, 3_600_000),
  WORKER_RUNTIME_MODE: z.enum(["embedded", "dedicated"]).optional(),
  WORKER_SHUTDOWN_GRACE_SECONDS: integerEnv(30, 1, 3_600),
  WORKER_SHUTDOWN_HARD_TIMEOUT_SECONDS: integerEnv(10, 1, 300),
  WORKER_VIDEO_POLL_INTERVAL_MS: integerEnv(5_000, 100, 60_000),
}).superRefine((env, ctx) => {
  if (env.NODE_ENV === "production" && !env.APP_URL) {
    ctx.addIssue({
      code: "custom",
      message: "生产环境 APP_URL 必须显式配置",
      path: ["APP_URL"],
    });
  } else if (
    env.NODE_ENV === "production" &&
    env.APP_URL &&
    isLocalAppUrl(env.APP_URL)
  ) {
    ctx.addIssue({
      code: "custom",
      message: "生产环境 APP_URL 不能使用 localhost 或 loopback 地址",
      path: ["APP_URL"],
    });
  }

  if (PUBLIC_AUTH_SECRETS.has(env.AUTH_SECRET.toLowerCase())) {
    ctx.addIssue({
      code: "custom",
      message: "AUTH_SECRET 不能使用公开占位值",
      path: ["AUTH_SECRET"],
    });
  }

  if (env.NODE_ENV === "production" && env.AUTH_SECRET.length < 32) {
    ctx.addIssue({
      code: "custom",
      message: "生产环境 AUTH_SECRET 至少需要 32 位",
      path: ["AUTH_SECRET"],
    });
  }
}).transform((env) => ({
  ...env,
  APP_URL: env.APP_URL ?? DEFAULT_APP_URL,
}));

export type RuntimeEnvironment = z.infer<typeof envSchema>;

let cachedEnv: RuntimeEnvironment | null = null;

export function parseEnv(input: NodeJS.ProcessEnv = process.env) {
  return envSchema.parse(input);
}

export function getEnv() {
  if (!cachedEnv) {
    cachedEnv = parseEnv();
  }

  return cachedEnv;
}
