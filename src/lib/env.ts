import "server-only";

import { z } from "zod";

const PUBLIC_AUTH_SECRETS = new Set([
  "change-me",
  "changeme",
  "replace-this-secret",
  "replace-with-strong-random-string-at-least-10-chars",
]);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().default("http://localhost:3000"),
  AUTH_SECRET: z.string().trim().min(10, "AUTH_SECRET 至少需要 10 位"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL 不能为空"),
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional().or(z.literal("")),
  BOOTSTRAP_INVITE_CODE: z.string().trim().optional().or(z.literal("")),
  BUILTIN_PROVIDER_API_KEY: z.string().optional().or(z.literal("")),
  BUILTIN_PROVIDER_BASE_URL: z.string().url().optional().or(z.literal("")),
  BUILTIN_PROVIDER_CREDIT_COST: z.coerce.number().int().positive().default(5),
  BUILTIN_PROVIDER_VIDEO_CREDIT_COST: z.coerce.number().int().positive().default(20),
  BUILTIN_PROVIDER_MODEL: z.string().default("gpt-image-2"),
  BUILTIN_PROVIDER_NAME: z.string().default("Studio"),
  ENABLE_LOCAL_IMAGE_FALLBACK: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  EXTERNAL_GENERATION_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  EXTERNAL_GENERATION_WAIT_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(900),
  S3_ACCESS_KEY_ID: z.string().optional().or(z.literal("")),
  S3_BUCKET: z.string().optional().or(z.literal("")),
  S3_ENDPOINT: z.string().optional().or(z.literal("")),
  S3_PUBLIC_BASE_URL: z.string().optional().or(z.literal("")),
  S3_REGION: z.string().default("auto"),
  S3_SECRET_ACCESS_KEY: z.string().optional().or(z.literal("")),
}).superRefine((env, ctx) => {
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
});

let cachedEnv: z.infer<typeof envSchema> | null = null;

export function getEnv() {
  if (!cachedEnv) {
    cachedEnv = envSchema.parse(process.env);
  }

  return cachedEnv;
}
