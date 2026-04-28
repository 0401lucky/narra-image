import "server-only";

import { z } from "zod";

const envSchema = z.object({
  APP_URL: z.string().default("http://localhost:3000"),
  AUTH_SECRET: z.string().min(10, "AUTH_SECRET 不能为空"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL 不能为空"),
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional().or(z.literal("")),
  BUILTIN_PROVIDER_API_KEY: z.string().optional().or(z.literal("")),
  BUILTIN_PROVIDER_BASE_URL: z.string().url().optional().or(z.literal("")),
  BUILTIN_PROVIDER_CREDIT_COST: z.coerce.number().int().positive().default(5),
  BUILTIN_PROVIDER_MODEL: z.string().default("gpt-image-2"),
  BUILTIN_PROVIDER_NAME: z.string().default("Studio"),
  ENABLE_LOCAL_IMAGE_FALLBACK: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  S3_ACCESS_KEY_ID: z.string().optional().or(z.literal("")),
  S3_BUCKET: z.string().optional().or(z.literal("")),
  S3_ENDPOINT: z.string().optional().or(z.literal("")),
  S3_PUBLIC_BASE_URL: z.string().optional().or(z.literal("")),
  S3_REGION: z.string().default("auto"),
  S3_SECRET_ACCESS_KEY: z.string().optional().or(z.literal("")),
});

let cachedEnv: z.infer<typeof envSchema> | null = null;

export function getEnv() {
  if (!cachedEnv) {
    cachedEnv = envSchema.parse(process.env);
  }

  return cachedEnv;
}
