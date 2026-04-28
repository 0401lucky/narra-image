import { z } from "zod";

import type { GenerationSizeToken } from "@/lib/types";
import { normalizeGenerationSize as normalizeGenerationSizeValue } from "@/lib/generation/sizes";
import { adminWorkReviewActions, userWorkShowcaseActions } from "@/lib/work-showcase";

function normalizeGenerationSize(value: string, ctx: z.RefinementCtx): GenerationSizeToken {
  const normalized = normalizeGenerationSizeValue(value);

  if (normalized) {
    return normalized;
  }

  ctx.addIssue({
    code: "custom",
    message: "尺寸仅支持 auto、比例或合法像素值",
  });

  return z.NEVER;
}

export const generationSizeSchema = z.string()
  .trim()
  .min(1)
  .transform((value, ctx) => normalizeGenerationSize(value, ctx))
  .default("auto");

export const generationQualitySchema = z.enum(["auto", "low", "medium", "high"]).default("auto");
export const generationOutputFormatSchema = z.enum(["png", "jpeg", "webp"]).default("png");
export const generationModerationSchema = z.enum(["auto", "low"]).default("auto");
export const generationOutputCompressionSchema = z.number().int().min(0).max(100).optional().nullable();

export const registerSchema = z.object({
  email: z.email("请输入正确的邮箱"),
  inviteCode: z.string().trim().default(""),
  password: z.string().min(8, "密码至少 8 位"),
});

export const loginSchema = z.object({
  email: z.email("请输入正确的邮箱"),
  password: z.string().min(8, "密码至少 8 位"),
});

export const providerConfigSchema = z.object({
  apiKey: z.string().trim().min(1, "请输入 API Key"),
  baseUrl: z.url("请输入正确的 Base URL"),
  label: z.string().trim().max(40).optional().nullable(),
  model: z.string().trim().min(1, "请输入模型名"),
  models: z.array(z.string()).default([]),
  remember: z.boolean().default(false),
});

export const generateSchema = z.object({
  count: z.number().int().min(1).max(4).default(1),
  customProvider: providerConfigSchema.optional().nullable(),
  generationType: z.enum(["text_to_image", "image_to_image"]).default("text_to_image"),
  model: z.string().trim().min(1, "请选择模型"),
  negativePrompt: z.string().trim().max(1000).optional().nullable(),
  outputCompression: generationOutputCompressionSchema,
  outputFormat: generationOutputFormatSchema,
  prompt: z.string().trim().min(2, "提示词至少 2 个字符").max(2000),
  providerMode: z.enum(["built_in", "custom"]).default("built_in"),
  quality: generationQualitySchema,
  moderation: generationModerationSchema,
  seed: z.number().int().positive().optional().nullable(),
  size: generationSizeSchema,
}).transform((value) => ({
  ...value,
  outputCompression:
    value.outputFormat === "png"
      ? null
      : value.outputCompression ?? 100,
}));

export const inviteCreateSchema = z.object({
  note: z.string().trim().max(120).optional().nullable(),
  count: z.number().int().min(1).max(100).default(1),
  isPublic: z.boolean().default(false),
});

export const redeemCodeCreateSchema = z.object({
  code: z.string().trim().max(40).optional().nullable(),
  count: z.number().int().min(1).max(100).default(1),
  isActive: z.boolean().default(true),
  maxRedemptions: z.number().int().min(1).max(100000).default(1),
  mode: z.enum(["single_use", "shared"]).default("single_use"),
  note: z.string().trim().max(120).optional().nullable(),
  rewardCredits: z.number().int().min(1).max(100000),
});

export const redeemCodeToggleSchema = z.object({
  isActive: z.boolean(),
});

export const redeemCodeClaimSchema = z.object({
  code: z.string().trim().min(1, "请输入兑换码").max(40, "兑换码最多 40 个字符"),
});

export const creditUpdateSchema = z.object({
  amount: z.number().int().min(-10000).max(10000),
});

export const builtInProviderConfigSchema = z.object({
  apiKey: z.string().trim(),
  baseUrl: z.url("请输入正确的 Base URL"),
  creditCost: z.number().int().min(1).max(10000),
  model: z.string().trim().min(1, "请输入模型名"),
  models: z.array(z.string()).default([]),
  name: z.string().trim().min(1, "请输入渠道名称").max(40),
});

export const channelCreateSchema = z.object({
  apiKey: z.string().trim().min(1, "请输入 API Key"),
  baseUrl: z.url("请输入正确的 Base URL"),
  creditCost: z.number().int().min(0).max(10000).default(5),
  defaultModel: z.string().trim().min(1, "请输入默认模型名"),
  isActive: z.boolean().default(true),
  models: z.array(z.string()).default([]),
  name: z.string().trim().min(1, "请输入渠道名称").max(40),
  slug: z.string().trim().min(1, "请输入渠道标识").max(40).regex(/^[a-z0-9-]+$/, "仅允许小写字母、数字和连字符"),
  sortOrder: z.number().int().default(0),
});

export const channelUpdateSchema = z.object({
  apiKey: z.string().trim().optional(),
  baseUrl: z.url("请输入正确的 Base URL").optional(),
  creditCost: z.number().int().min(0).max(10000).optional(),
  defaultModel: z.string().trim().min(1).optional(),
  isActive: z.boolean().optional(),
  models: z.array(z.string()).optional(),
  name: z.string().trim().min(1).max(40).optional(),
  sortOrder: z.number().int().optional(),
});

export const providerProbeSchema = z.object({
  apiKey: z.string().trim().optional().nullable(),
  baseUrl: z.url("请输入正确的 Base URL"),
});

export const workShowcaseUpdateSchema = z.object({
  action: z.enum(userWorkShowcaseActions),
  showPromptPublic: z.boolean().optional(),
});

export const adminWorkReviewSchema = z.object({
  action: z.enum(adminWorkReviewActions),
  reviewNote: z.string().trim().max(300, "审核备注最多 300 个字符").optional().nullable(),
});

export const benefitConfigSchema = z.object({
  checkInReward: z.number().int().min(1).max(10000),
});

export const profileUpdateSchema = z.object({
  avatarUrl: z.string().url("头像地址格式不正确").optional().nullable(),
  nickname: z
    .string()
    .trim()
    .min(2, "昵称至少 2 个字符")
    .max(20, "昵称最多 20 个字符")
    .optional()
    .nullable(),
});
