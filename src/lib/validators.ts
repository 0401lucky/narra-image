import { z } from "zod";

import {
  adminWorkReviewActions,
  userWorkShowcaseActions,
} from "@/lib/work-showcase";

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
  prompt: z.string().trim().min(2, "提示词至少 2 个字符").max(2000),
  providerMode: z.enum(["built_in", "custom"]).default("built_in"),
  seed: z.number().int().positive().optional().nullable(),
  size: z.string().trim().min(1).default("1024x1024"),
});

export const inviteCreateSchema = z.object({
  note: z.string().trim().max(120).optional().nullable(),
  count: z.number().int().min(1).max(100).default(1),
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
