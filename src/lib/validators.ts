import { z } from "zod";

import { GENERATION_PROMPT_MAX_LENGTH } from "@/lib/generation/limits";

import type { GenerationSizeToken } from "@/lib/types";
import type { SerializedFeaturedWork } from "@/lib/prisma-mappers";
import { normalizeGenerationSize as normalizeGenerationSizeValue } from "@/lib/generation/sizes";
import { adminWorkReviewActions, userWorkShowcaseActions } from "@/lib/work-showcase";
import {
  CANVAS_ERRORS,
  CANVAS_CLIENT_ID_PATTERN,
  CANVAS_IMPORT_IMAGE_TYPES,
  CANVAS_LIMITS,
  canvasJsonByteLength,
} from "@/lib/canvas/contracts";
import { validateCanvasGraphV1, validateCanvasRunReferencesV1 } from "@/lib/canvas/graph";

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
  videoCreditCost: z.number().int().min(0).max(10000).default(20),
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
  videoCreditCost: z.number().int().min(0).max(10000).optional(),
});

export const providerProbeSchema = z.object({
  apiKey: z.string().trim().optional().nullable(),
  baseUrl: z.url("请输入正确的 Base URL"),
  channelId: z.string().trim().optional().nullable(),
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

export const canvasCanonicalIdSchema = z.string().max(CANVAS_LIMITS.canonicalIdCharacters).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "画布资源标识不正确");
export const canvasClientIdSchema = z.uuid("画布标识必须是 UUID").regex(CANVAS_CLIENT_ID_PATTERN, "画布标识必须是标准 UUID").transform((value) => value.toLowerCase());
const canvasResultNodeIdSchema = z.string().max(CANVAS_LIMITS.canonicalIdCharacters + "result:".length).regex(/^result:[A-Za-z0-9][A-Za-z0-9._:-]*$/, "结果节点标识不正确");
export const canvasNodeIdSchema = z.union([canvasClientIdSchema, canvasResultNodeIdSchema]);
export const canvasPositionSchema = z.object({ x: z.number(), y: z.number() }).strict();
export const canvasViewportSchema = canvasPositionSchema.extend({ zoom: z.number().positive("缩放值必须为正数") }).strict();

const canvasParameterShape = {
  providerMode: z.enum(["built_in", "custom"]).default("built_in"),
  channelId: canvasCanonicalIdSchema.nullable().default(null),
  model: z.string().trim().min(1, "请选择模型").max(200),
  size: generationSizeSchema,
  quality: generationQualitySchema,
  outputFormat: generationOutputFormatSchema,
  outputCompression: generationOutputCompressionSchema,
  moderation: generationModerationSchema,
  count: z.number().int().min(1).max(CANVAS_LIMITS.textOutputCount).default(1),
  negativePrompt: z.string().trim().max(1000).nullable().default(null),
  seed: z.number().int().positive().max(2147483647).nullable().default(null),
};

export const canvasGenerationParametersSchema = z.object(canvasParameterShape).strict().transform((value) => ({
  ...value,
  outputCompression: value.outputFormat === "png" ? null : value.outputCompression ?? 100,
}));
export const canvasRunParametersSchema = z.object({
  ...canvasParameterShape,
  generationType: z.enum(["text_to_image", "image_to_image"]),
}).strict().transform((value) => ({
  ...value,
  outputCompression: value.outputFormat === "png" ? null : value.outputCompression ?? 100,
}));

export const canvasImportedSourceSchema = z.object({ kind: z.literal("imported"), assetId: canvasCanonicalIdSchema }).strict();
export const canvasLocalSourceSchema = z.object({ kind: z.literal("local"), blobId: canvasClientIdSchema, uploadId: canvasClientIdSchema }).strict();
const canvasPromptNodeSchema = z.object({ id: canvasClientIdSchema, kind: z.literal("prompt"), position: canvasPositionSchema, text: z.string().max(GENERATION_PROMPT_MAX_LENGTH) }).strict();
const canvasReferenceNodeSchema = z.object({ id: canvasClientIdSchema, kind: z.literal("reference"), position: canvasPositionSchema, source: canvasImportedSourceSchema }).strict();
const canvasLocalReferenceNodeSchema = canvasReferenceNodeSchema.extend({ source: z.discriminatedUnion("kind", [canvasImportedSourceSchema, canvasLocalSourceSchema]) }).strict();
const canvasGenerationNodeSchema = z.object({ id: canvasClientIdSchema, kind: z.literal("generation"), position: canvasPositionSchema, parameters: canvasGenerationParametersSchema }).strict();
const canvasResultNodeSchema = z.object({ id: canvasResultNodeIdSchema, kind: z.literal("result"), position: canvasPositionSchema, jobId: canvasCanonicalIdSchema, imageId: canvasCanonicalIdSchema, runId: canvasClientIdSchema.optional() }).strict();
export const canvasNodeSchema = z.discriminatedUnion("kind", [canvasPromptNodeSchema, canvasReferenceNodeSchema, canvasGenerationNodeSchema, canvasResultNodeSchema]);
export const canvasLocalNodeSchema = z.discriminatedUnion("kind", [canvasPromptNodeSchema, canvasLocalReferenceNodeSchema, canvasGenerationNodeSchema, canvasResultNodeSchema]);
const canvasEdgeShape = { id: canvasClientIdSchema, source: canvasNodeIdSchema, target: canvasNodeIdSchema };
export const canvasEdgeSchema = z.discriminatedUnion("kind", [
  z.object({ ...canvasEdgeShape, kind: z.literal("prompt-input") }).strict(),
  z.object({ ...canvasEdgeShape, kind: z.literal("image-input"), ordinal: z.number().int().min(1).max(CANVAS_LIMITS.referencesPerRun) }).strict(),
  z.object({ ...canvasEdgeShape, kind: z.literal("output-provenance") }).strict(),
]);
export const canvasAcceptedRunBindingSchema = z.object({ runId: canvasClientIdSchema, nodeId: canvasClientIdSchema, jobId: canvasCanonicalIdSchema, outputsHandled: z.boolean() }).strict();
const canvasSceneShape = {
  schemaVersion: z.literal(1, { error: CANVAS_ERRORS.CANVAS_VERSION_UNSUPPORTED.userMessage }),
  edges: z.array(canvasEdgeSchema).max(CANVAS_LIMITS.sceneEdges),
  viewport: canvasViewportSchema,
  runBindings: z.array(canvasAcceptedRunBindingSchema).max(CANVAS_LIMITS.sceneNodes),
};
function validateCanvasScene(value: z.infer<typeof canvasLocalSceneObjectSchema>, context: z.RefinementCtx) {
  if (canvasJsonByteLength(value) > CANVAS_LIMITS.sceneBytes) context.addIssue({ code: "custom", message: CANVAS_ERRORS.CANVAS_LIMIT_EXCEEDED.userMessage });
  for (const problem of validateCanvasGraphV1(value)) context.addIssue({ code: "custom", path: problem.path, message: problem.message });
}
const canvasSceneObjectSchema = z.object({ ...canvasSceneShape, nodes: z.array(canvasNodeSchema).max(CANVAS_LIMITS.sceneNodes) }).strict();
const canvasLocalSceneObjectSchema = z.object({ ...canvasSceneShape, nodes: z.array(canvasLocalNodeSchema).max(CANVAS_LIMITS.sceneNodes) }).strict();
export const canvasSceneSchema = canvasSceneObjectSchema.superRefine(validateCanvasScene);
export const canvasLocalSceneSchema = canvasLocalSceneObjectSchema.superRefine(validateCanvasScene);

const canvasRunReferenceBase = { sourceNodeId: canvasClientIdSchema, ordinal: z.number().int().min(1).max(CANVAS_LIMITS.referencesPerRun) };
const canvasImportedRunReferenceSchema = z.object({ ...canvasRunReferenceBase, kind: z.literal("imported"), assetId: canvasCanonicalIdSchema }).strict();
const canvasResultRunReferenceSchema = z.object({ ...canvasRunReferenceBase, sourceNodeId: canvasResultNodeIdSchema, kind: z.literal("result"), jobId: canvasCanonicalIdSchema, imageId: canvasCanonicalIdSchema }).strict();
const canvasBlobRunReferenceSchema = z.object({ ...canvasRunReferenceBase, kind: z.literal("local"), blobId: canvasClientIdSchema, uploadId: canvasClientIdSchema }).strict();
export const canvasRunReferenceSchema = z.discriminatedUnion("kind", [canvasImportedRunReferenceSchema, canvasResultRunReferenceSchema]);
export const canvasLocalRunReferenceSchema = z.discriminatedUnion("kind", [canvasImportedRunReferenceSchema, canvasResultRunReferenceSchema, canvasBlobRunReferenceSchema]);
const canvasRunPromptSchema = z.object({ sourceNodeId: canvasClientIdSchema, text: z.string().trim().min(2, CANVAS_ERRORS.CANVAS_PROMPT_REQUIRED.userMessage).max(GENERATION_PROMPT_MAX_LENGTH) }).strict();
export const canvasRunInputSchema = z.object({ prompt: canvasRunPromptSchema, references: z.array(canvasRunReferenceSchema).max(CANVAS_LIMITS.referencesPerRun) }).strict().superRefine((value, context) => {
  for (const problem of validateCanvasRunReferencesV1(value.references)) context.addIssue({ code: "custom", path: problem.path, message: problem.message });
}).transform((value) => ({ ...value, references: [...value.references].sort((a, b) => a.ordinal - b.ordinal) }));
export const canvasRunSchema = z.object({ canvasId: canvasClientIdSchema, nodeId: canvasClientIdSchema, runId: canvasClientIdSchema, input: canvasRunInputSchema, parameters: canvasRunParametersSchema }).strict().superRefine((value, context) => {
  if (value.input.prompt.sourceNodeId === value.nodeId || value.input.references.some((reference) => reference.sourceNodeId === value.nodeId || reference.sourceNodeId === value.input.prompt.sourceNodeId)) context.addIssue({ code: "custom", message: CANVAS_ERRORS.CANVAS_INVALID_CONNECTION.userMessage });
  const imageInput = value.input.references.length > 0;
  if (value.parameters.generationType !== (imageInput ? "image_to_image" : "text_to_image") || (imageInput && (value.parameters.count !== CANVAS_LIMITS.imageOutputCount || value.parameters.negativePrompt !== null || value.parameters.seed !== null))) context.addIssue({ code: "custom", path: ["parameters"], message: "参考图生成仅支持单张输出及图片编辑参数" });
  if (canvasJsonByteLength(value) > CANVAS_LIMITS.runSnapshotBytes) context.addIssue({ code: "custom", message: CANVAS_ERRORS.CANVAS_LIMIT_EXCEEDED.userMessage });
});
export const canvasTransientRequestFieldsSchema = z.object({
  turnstileToken: z.string().trim().max(4096).optional(),
  customProvider: z.object({
    apiKey: z.string().trim().min(1).max(4096),
    baseUrl: z.url().max(2048),
    label: z.string().trim().max(40).optional().nullable(),
    model: z.string().trim().min(1).max(200),
    models: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
    remember: z.boolean().default(false),
  }).strict().optional().nullable(),
}).strict();
export const canvasGenerateRequestSchema = canvasTransientRequestFieldsSchema.extend({ canvasRun: canvasRunSchema }).strict().superRefine((value, context) => {
  if (canvasJsonByteLength(value) > CANVAS_LIMITS.runBodyBytes) context.addIssue({ code: "custom", message: CANVAS_ERRORS.CANVAS_LIMIT_EXCEEDED.userMessage });
});

export const canvasLocalRunProjectionSchema = z.object({
  canvasId: canvasClientIdSchema,
  nodeId: canvasClientIdSchema,
  runId: canvasClientIdSchema,
  prompt: canvasRunPromptSchema,
  references: z.array(canvasLocalRunReferenceSchema).max(CANVAS_LIMITS.referencesPerRun),
  params: canvasGenerationParametersSchema,
}).strict().superRefine((value, context) => {
  for (const problem of validateCanvasRunReferencesV1(value.references)) context.addIssue({ code: "custom", path: problem.path, message: problem.message });
  if (value.prompt.sourceNodeId === value.nodeId || value.references.some((reference) => reference.sourceNodeId === value.nodeId || reference.sourceNodeId === value.prompt.sourceNodeId)) context.addIssue({ code: "custom", message: CANVAS_ERRORS.CANVAS_INVALID_CONNECTION.userMessage });
});
const canvasOutboxShape = { storageVersion: z.literal(1), ownerId: canvasCanonicalIdSchema, canvasId: canvasClientIdSchema, nodeId: canvasClientIdSchema, runId: canvasClientIdSchema, projection: canvasLocalRunProjectionSchema };
export const canvasRunOutboxSchema = z.discriminatedUnion("phase", [
  z.object({ ...canvasOutboxShape, phase: z.enum(["prepared", "uncertain", "rejected"]), jobId: z.null() }).strict(),
  z.object({ ...canvasOutboxShape, phase: z.literal("accepted"), jobId: canvasCanonicalIdSchema }).strict(),
]).superRefine((value, context) => {
  if (value.canvasId !== value.projection.canvasId || value.nodeId !== value.projection.nodeId || value.runId !== value.projection.runId) context.addIssue({ code: "custom", message: CANVAS_ERRORS.CANVAS_ORIGIN_MISMATCH.userMessage });
});

export const canvasTitleSchema = z.string().trim().min(1, "请输入画布名称").max(CANVAS_LIMITS.titleCharacters);
export const canvasRevisionSchema = z.number().int().min(0).max(2147483646);
export const canvasCreateSchema = z.object({ id: canvasClientIdSchema, title: canvasTitleSchema }).strict();
export const canvasRenameSchema = z.object({ title: canvasTitleSchema, expectedRevision: canvasRevisionSchema }).strict();
export const canvasDeleteSchema = z.object({ expectedRevision: canvasRevisionSchema }).strict();
export const canvasSnapshotSchema = z.object({ expectedRevision: canvasRevisionSchema, saveId: canvasClientIdSchema, scene: canvasSceneSchema }).strict().superRefine((value, context) => {
  if (canvasJsonByteLength(value) > CANVAS_LIMITS.snapshotBodyBytes) context.addIssue({ code: "custom", message: CANVAS_ERRORS.CANVAS_LIMIT_EXCEEDED.userMessage });
});
export const canvasPageQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(CANVAS_LIMITS.maximumPageSize).default(CANVAS_LIMITS.defaultPageSize), cursor: z.string().max(2048).regex(/^[A-Za-z0-9_-]+$/).optional() }).strict();
export const canvasKeysetCursorPayloadSchema = z.object({ schemaVersion: z.literal(1), ownerId: canvasCanonicalIdSchema, scope: z.enum(["canvas", "conversation"]), parentId: canvasCanonicalIdSchema.nullable(), at: z.iso.datetime(), id: canvasCanonicalIdSchema }).strict();
export const canvasUploadDeclarationSchema = z.object({ uploadId: canvasClientIdSchema, byteLength: z.number().int().positive().max(CANVAS_LIMITS.importBytes), mimeType: z.enum(CANVAS_IMPORT_IMAGE_TYPES as [string, ...string[]]), sha256: z.string().regex(/^[a-f0-9]{64}$/, "文件摘要必须为 SHA-256") }).strict();
export const canvasRuntimeResolveSchema = z.object({
  canvasId: canvasClientIdSchema,
  runBindings: z.array(canvasAcceptedRunBindingSchema).max(CANVAS_LIMITS.runtimeIdSlots).default([]),
  runIds: z.array(canvasClientIdSchema).max(CANVAS_LIMITS.runtimeIdSlots).default([]),
  jobIds: z.array(canvasCanonicalIdSchema).max(CANVAS_LIMITS.runtimeIdSlots).default([]),
  imageIds: z.array(canvasCanonicalIdSchema).max(CANVAS_LIMITS.runtimeIdSlots).default([]),
  assetIds: z.array(canvasCanonicalIdSchema).max(CANVAS_LIMITS.runtimeIdSlots).default([]),
}).strict().superRefine((value, context) => {
  const slots = new Set([
    ...value.runBindings.map((binding) => `run:${binding.runId}`),
    ...value.runIds.map((id) => `run:${id}`),
    ...value.jobIds.map((id) => `job:${id}`),
    ...value.imageIds.map((id) => `image:${id}`),
    ...value.assetIds.map((id) => `asset:${id}`),
  ]);
  if (slots.size > CANVAS_LIMITS.runtimeIdSlots) context.addIssue({ code: "custom", message: CANVAS_ERRORS.CANVAS_LIMIT_EXCEEDED.userMessage });
}).transform((value) => ({ ...value, runIds: [...new Set(value.runIds)], jobIds: [...new Set(value.jobIds)], imageIds: [...new Set(value.imageIds)], assetIds: [...new Set(value.assetIds)] }));

export const canvasMetadataDtoSchema = z.object({ id: canvasClientIdSchema, title: canvasTitleSchema, revision: canvasRevisionSchema, lastSavedAt: z.iso.datetime().nullable(), hasSavedSnapshot: z.boolean(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() }).strict();
export const canvasDocumentDtoSchema = z.object({ canvas: canvasMetadataDtoSchema, scene: canvasSceneSchema.nullable() }).strict().superRefine((value, context) => {
  if (value.canvas.hasSavedSnapshot !== (value.scene !== null) || (value.scene !== null && value.canvas.lastSavedAt === null)) context.addIssue({ code: "custom", message: "画布快照状态不一致" });
});
export const canvasMetadataPageDtoSchema = z.object({ canvases: z.array(canvasMetadataDtoSchema).max(CANVAS_LIMITS.maximumPageSize), nextCursor: z.string().max(2048).nullable() }).strict();
export const canvasSaveReceiptDtoSchema = z.object({ canvas: canvasMetadataDtoSchema, saveId: canvasClientIdSchema, sceneHash: z.string().regex(/^[a-f0-9]{64}$/), acknowledgedRevision: canvasRevisionSchema }).strict();
export const canvasAssetDtoSchema = z.object({ id: canvasCanonicalIdSchema, uploadId: canvasClientIdSchema, state: z.enum(["UPLOADING", "READY", "QUARANTINED", "DELETING", "DELETED"]), byteLength: z.number().int().positive().max(CANVAS_LIMITS.importBytes), mimeType: z.enum(CANVAS_IMPORT_IMAGE_TYPES as [string, ...string[]]), sha256: z.string().regex(/^[a-f0-9]{64}$/), readyAt: z.iso.datetime().nullable(), url: z.string().nullable() }).strict();
export const canvasWorkerCapabilitySchema = z.object({ version: z.literal(1), schema: z.literal("ready"), storage: z.literal("unversioned"), gc: z.literal("running") }).strict();

// 游标内容由服务端解释；客户端只检查传输形状，不另建排序/解码规则。
export const featuredCursorResponseSchema = z.string().min(1).max(2048)
  .regex(/^[A-Za-z0-9_-]+$/, "精选作品游标格式不正确");

export const featuredWorkResponseSchema = z.object({
  authorAvatar: z.string().nullable(),
  authorName: z.string(),
  featuredAt: z.iso.datetime().nullable(),
  id: z.string().min(1),
  image: z.string().min(1),
  likeCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  likedByMe: z.boolean(),
  prompt: z.string(),
  showPromptPublic: z.boolean().default(false),
  size: z.string(),
  title: z.string(),
}) satisfies z.ZodType<SerializedFeaturedWork>;

export const featuredPageResponseSchema = z.object({
  hasMore: z.boolean(),
  items: z.array(featuredWorkResponseSchema),
  nextCursor: featuredCursorResponseSchema.nullable(),
}).refine((page) => page.hasMore === (page.nextCursor !== null), {
  message: "精选作品分页信息不完整",
  path: ["nextCursor"],
});

export const workLikeResponseSchema = z.object({
  data: z.object({
    likeCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    liked: z.boolean(),
  }),
});
