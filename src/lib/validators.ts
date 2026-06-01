import { z } from "zod";

import { GENERATION_PROMPT_MAX_LENGTH } from "@/lib/generation/limits";

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
  turnstileToken: z.string().optional(),
});

export const loginSchema = z.object({
  email: z.email("请输入正确的邮箱"),
  password: z.string().min(8, "密码至少 8 位"),
  turnstileToken: z.string().optional(),
});

export const inviteClaimSchema = z.object({
  turnstileToken: z.string().optional(),
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
  generationType: z
    .enum(["text_to_image", "image_to_image", "text_to_video", "image_to_video"])
    .default("text_to_image"),
  model: z.string().trim().min(1, "请选择模型"),
  negativePrompt: z.string().trim().max(1000).optional().nullable(),
  outputCompression: generationOutputCompressionSchema,
  outputFormat: generationOutputFormatSchema,
  prompt: z.string().trim().min(2, "提示词至少 2 个字符").max(GENERATION_PROMPT_MAX_LENGTH),
  providerMode: z.enum(["built_in", "custom"]).default("built_in"),
  quality: generationQualitySchema,
  moderation: generationModerationSchema,
  seed: z.number().int().positive().optional().nullable(),
  durationSeconds: z.number().int().min(1).max(60).optional().nullable(),
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]).optional().nullable(),
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
  mediaType: z.enum(["image", "video"]).default("image"),
  showPromptPublic: z.boolean().optional(),
});

export const adminWorkReviewSchema = z.object({
  action: z.enum(adminWorkReviewActions),
  mediaType: z.enum(["image", "video"]).default("image"),
  reviewNote: z.string().trim().max(300, "审核备注最多 300 个字符").optional().nullable(),
});

export const adminGenerationBulkDeleteSchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1, "请选择要删除的生成记录").max(100, "单次最多删除 100 条生成记录"),
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

export const apiKeyCreateSchema = z.object({
  name: z.string().trim().min(1, "请输入 API Key 名称").max(40, "名称最多 40 个字符"),
});

export const apiConfigUpdateSchema = z.object({
  isEnabled: z.boolean().optional(),
  requestsPerDay: z.number().int().min(1).max(100000).optional(),
  requestsPerMinute: z.number().int().min(1).max(1000).optional(),
});

export const externalImageGenerationSchema = z.object({
  count: z.number().int().min(1).max(4).optional(),
  model: z.string().trim().min(1).max(100).optional(),
  moderation: generationModerationSchema.optional(),
  n: z.number().int().min(1).max(4).optional(),
  negative_prompt: z.string().trim().max(1000).optional().nullable(),
  negativePrompt: z.string().trim().max(1000).optional().nullable(),
  output_compression: generationOutputCompressionSchema,
  output_format: generationOutputFormatSchema.optional(),
  outputCompression: generationOutputCompressionSchema,
  outputFormat: generationOutputFormatSchema.optional(),
  prompt: z.string().trim().min(2, "提示词至少 2 个字符").max(GENERATION_PROMPT_MAX_LENGTH),
  quality: generationQualitySchema.optional(),
  response_format: z.enum(["url", "b64_json"]).optional(),
  seed: z.number().int().positive().optional().nullable(),
  size: generationSizeSchema.optional(),
}).transform((value) => {
  const outputFormat = value.outputFormat ?? value.output_format ?? "png";
  return {
    count: value.count ?? value.n ?? 1,
    model: value.model,
    moderation: value.moderation ?? "auto",
    negativePrompt: value.negativePrompt ?? value.negative_prompt ?? null,
    outputCompression:
      outputFormat === "png"
        ? null
        : value.outputCompression ?? value.output_compression ?? 100,
    outputFormat,
    prompt: value.prompt,
    quality: value.quality ?? "auto",
    responseFormat: value.response_format ?? "url",
    seed: value.seed ?? null,
    size: value.size ?? "auto",
  };
});

export const externalImageEditSchema = externalImageGenerationSchema;

const chatTextPartSchema = z.object({
  text: z.string().max(GENERATION_PROMPT_MAX_LENGTH),
  type: z.literal("text"),
});

const chatImagePartSchema = z.object({
  image_url: z.union([
    z.string().url(),
    z.object({
      url: z.string().url(),
    }),
  ]),
  type: z.literal("image_url"),
});

export const externalChatCompletionSchema = z.object({
  messages: z.array(z.object({
    content: z.union([
      z.string().max(GENERATION_PROMPT_MAX_LENGTH),
      z.array(z.union([chatTextPartSchema, chatImagePartSchema])).max(12),
    ]),
    role: z.string(),
  })).min(1, "messages 不能为空").max(20, "messages 最多 20 条"),
  model: z.string().trim().max(100).optional(),
  n: z.number().int().min(1).max(4).optional(),
  quality: generationQualitySchema.optional(),
  size: generationSizeSchema.optional(),
  stream: z.boolean().optional(),
});

export const externalResponsesSchema = z.object({
  input: z.unknown(),
  model: z.string().trim().min(1).max(100).optional(),
  previous_response_id: z.string().trim().optional().nullable(),
  stream: z.boolean().optional(),
  tool_choice: z.unknown().optional(),
  tools: z.unknown().optional(),
});
