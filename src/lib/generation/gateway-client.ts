import "server-only";

import { createHmac, randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { calculateGenerationCost } from "@/lib/credits";
import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { assertApiRateLimit } from "@/lib/api-config";
import { persistGeneratedImage } from "@/lib/storage/persist-generated-image";
import {
  generationChannelModelSnapshot,
  getGenerationChannelForModel,
  type ResolvedChannel,
} from "@/lib/providers/built-in-provider";
import {
  GATEWAY_ENDPOINT_PATHS,
  GATEWAY_SCHEMA_VERSION,
  GATEWAY_SIGNATURE_HEADER,
  GATEWAY_API_KEY_HEADER,
  type GatewayEndpoint,
} from "@/lib/generation/gateway-contract";
import type {
  GenerationModeration,
  GenerationOutputFormat,
  GenerationQuality,
  GenerationSizeToken,
} from "@/lib/types";
import type { ExternalGenerationRequest } from "@/lib/generation/external-api";

/**
 * Next → Go 内部生成网关的薄代理。
 *
 * Next 保留：API Key 认证、限流、输入/媒体校验、渠道解析、积分预扣、
 * 参考图上传与传输层 keep-alive。Go 保留：envelope 防御校验、任务创建、
 * 等待/超时语义与 OpenAI JSON/SSE 格式化。
 * 契约见 contracts/gateway/v1/envelope.json。
 */

export type { GatewayEndpoint } from "@/lib/generation/gateway-contract";

export function isGatewayEnabled() {
  return getEnv().GATEWAY_ENABLED;
}

function gatewaySignature(secret: string, body: string) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function gatewayBaseUrl() {
  return getEnv().WORKER_INTERNAL_URL.replace(/\/+$/, "");
}

export function gatewayJobId() {
  return randomUUID();
}

type GatewayPayload = {
  count: number;
  generationType: "TEXT_TO_IMAGE" | "IMAGE_TO_IMAGE";
  model: string;
  prompt: string;
  negativePrompt?: string | null;
  moderation: GenerationModeration;
  outputCompression?: number | null;
  outputFormat: GenerationOutputFormat;
  quality: GenerationQuality;
  seed?: number | null;
  size: GenerationSizeToken;
  responseFormat?: string;
  stream?: boolean;
};

type RunThroughGatewayInput = {
  apiKeyId: string;
  userId: string;
  endpoint: GatewayEndpoint;
  jobId: string;
  creditsSpent: number;
  provider: {
    channelId: string;
    channelModels: string[];
    defaultModel: string;
    providerMode: string;
  };
  sourceImageUrls: string[];
  payload: GatewayPayload;
  signal?: AbortSignal;
};

/**
 * 预扣积分（与 legacy runExternalGeneration 的扣费语义一致）。
 * 网关模式下由 Next 完成扣费，Go 只把 creditsSpent 写入 job 记录。
 */
async function prechargeCredits(userId: string, cost: number) {
  if (cost <= 0) return;
  const charged = await db.user.updateMany({
    where: { credits: { gte: cost }, id: userId },
    data: { credits: { decrement: cost } },
  });
  if (charged.count === 0) {
    throw new Error("积分不足，请联系管理员补充");
  }
}

async function refundCredits(userId: string, amount: number) {
  if (amount <= 0) return;
  await db.user.update({
    where: { id: userId },
    data: { credits: { increment: amount } },
  });
}

/** 查询 job 是否已存在且属于该 API Key；用于补偿退款的不确定状态判定。 */
async function gatewayJobBelongsTo(jobId: string, apiKeyId: string) {
  const job = await db.generationJob.findUnique({
    where: { id: jobId },
    select: { apiKeyId: true },
  });
  return job?.apiKeyId === apiKeyId;
}

function openAiErrorResponse(
  status: number,
  code: string,
  message: string,
  generationId?: string,
) {
  const type =
    status === 504 || status === 502
      ? "server_error"
      : status === 401
        ? "authentication_error"
        : "invalid_request_error";
  const body: Record<string, unknown> = {
    error: { code, message, type },
  };
  if (generationId) {
    body.generation_id = generationId;
  }
  return NextResponse.json(body, { status });
}

async function uploadSourceImages(
  sourceImages: NonNullable<ExternalGenerationRequest["sourceImages"]>,
  userId: string,
) {
  return Promise.all(
    sourceImages.map((sourceImage) =>
      persistGeneratedImage({
        buffer: sourceImage.data,
        fileExtension: sourceImage.fileName.split(".").pop() || "png",
        mimeType: sourceImage.mimeType,
        userId,
      }),
    ),
  );
}

/**
 * 构造版本化 envelope 并转发到 Go 网关。
 * 失败时按不确定状态补偿：job 已存在则不退款（任务在跑，可查询），
 * 否则退款并返回 OpenAI 兼容错误。成功时原样返回 Go 的 Response（JSON 或 SSE）。
 */
export async function runThroughGateway(
  input: RunThroughGatewayInput,
): Promise<Response> {
  const env = getEnv();
  const envelope = {
    schemaVersion: GATEWAY_SCHEMA_VERSION,
    endpoint: input.endpoint,
    jobId: input.jobId,
    issuedAt: new Date().toISOString(),
    auth: { apiKeyId: input.apiKeyId, userId: input.userId },
    billing: { creditsSpent: input.creditsSpent, charged: true },
    provider: input.provider,
    sourceImageUrls: input.sourceImageUrls,
    payload: input.payload,
  };
  const body = JSON.stringify(envelope);
  const signature = gatewaySignature(env.AUTH_SECRET, body);

  let response: Response;
  try {
    response = await fetch(`${gatewayBaseUrl()}${GATEWAY_ENDPOINT_PATHS[input.endpoint]}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [GATEWAY_SIGNATURE_HEADER]: signature,
      },
      body,
      signal: input.signal,
      cache: "no-store",
    });
  } catch (error) {
    if (input.signal?.aborted) {
      throw error;
    }
    // 连接失败/网关不可用：查 DB 决定是否退款。
    const belongs = await gatewayJobBelongsTo(input.jobId, input.apiKeyId);
    if (!belongs) {
      await refundCredits(input.userId, input.creditsSpent);
      return openAiErrorResponse(502, "GATEWAY_UNAVAILABLE", "生成网关暂不可用", input.jobId);
    }
    return openAiErrorResponse(
      504,
      "GENERATION_WAIT_TIMEOUT",
      "等待生成结果超时，请稍后通过 /v1/generations/" + input.jobId + " 查询",
      input.jobId,
    );
  }

  if (!response.ok) {
    // Go 明确失败：按不确定状态判定是否退款（504 超时时 job 已创建，不退款）。
    const belongs = await gatewayJobBelongsTo(input.jobId, input.apiKeyId);
    if (!belongs) {
      await refundCredits(input.userId, input.creditsSpent);
    }
  }
  return response;
}

/**
 * 外部生成 API 的网关模式入口：限流 → 渠道解析 → 计价 → 预扣 →
 * 参考图上传 → 转发。返回可直接返回给客户端的 Response。
 */
export async function runExternalGenerationViaGateway(input: {
  apiKeyId: string;
  input: ExternalGenerationRequest;
  signal?: AbortSignal;
  user: { credits: number; id: string };
  endpoint: GatewayEndpoint;
  responseFormat?: string;
  stream?: boolean;
}): Promise<Response> {
  await assertApiRateLimit(input.apiKeyId);

  const env = getEnv();
  const requestedModel = input.input.model?.trim() || env.BUILTIN_PROVIDER_MODEL;
  const provider: ResolvedChannel = await getGenerationChannelForModel(requestedModel);
  const cost = calculateGenerationCost({
    builtInCreditCost: provider.creditCost,
    providerMode: "built_in",
  });
  const model = input.input.model || provider.defaultModel;
  const count = input.input.generationType === "image_to_image" ? 1 : input.input.count;

  let charged = false;
  try {
    await prechargeCredits(input.user.id, cost);
    charged = true;

    const sourceImageUrls = input.input.sourceImages?.length
      ? await uploadSourceImages(input.input.sourceImages, input.user.id)
      : [];

    return await runThroughGateway({
      apiKeyId: input.apiKeyId,
      userId: input.user.id,
      endpoint: input.endpoint,
      jobId: gatewayJobId(),
      creditsSpent: cost,
      provider: {
        channelId: provider.id,
        channelModels: generationChannelModelSnapshot(provider),
        defaultModel: provider.defaultModel,
        providerMode: "BUILT_IN",
      },
      sourceImageUrls,
      payload: {
        count,
        generationType:
          input.input.generationType === "image_to_image"
            ? "IMAGE_TO_IMAGE"
            : "TEXT_TO_IMAGE",
        model,
        prompt: input.input.prompt,
        negativePrompt: input.input.negativePrompt ?? null,
        moderation: input.input.moderation,
        outputCompression: input.input.outputCompression ?? null,
        outputFormat: input.input.outputFormat,
        quality: input.input.quality,
        seed: input.input.seed ?? null,
        size: input.input.size,
        responseFormat: input.responseFormat,
        stream: input.stream,
      },
      signal: input.signal,
    });
  } catch (error) {
    // 预扣后、转发前失败（如参考图上传失败）需补偿退款。
    if (charged) {
      await refundCredits(input.user.id, cost);
    }
    throw error;
  }
}

/** generations 查询的网关转发；返回可直接返回给客户端的 Response。 */
export async function forwardGenerationQuery(input: {
  apiKeyId: string;
  jobId: string;
}): Promise<Response> {
  const env = getEnv();
  const jobId = input.jobId;
  const signature = gatewaySignature(env.AUTH_SECRET, jobId);
  try {
    return await fetch(
      `${gatewayBaseUrl()}/internal/gateway/v1/generations/${encodeURIComponent(jobId)}`,
      {
        headers: {
          [GATEWAY_SIGNATURE_HEADER]: signature,
          [GATEWAY_API_KEY_HEADER]: input.apiKeyId,
        },
        cache: "no-store",
      },
    );
  } catch {
    return openAiErrorResponse(502, "GATEWAY_UNAVAILABLE", "生成网关暂不可用", jobId);
  }
}
