import "server-only";

import { GenerationClientSource, GenerationStatus } from "@prisma/client";

import { calculateGenerationCost } from "@/lib/credits";
import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { assertApiRateLimit } from "@/lib/api-config";
import { ApiTimeoutError } from "@/lib/api-errors";
import { persistGeneratedImage } from "@/lib/storage/persist-generated-image";
import { failGenerationJobAndRefund } from "@/lib/generation/job-refund";
import {
  getActiveChannels,
  type ResolvedChannel,
} from "@/lib/providers/built-in-provider";
import type {
  GenerationModeration,
  GenerationOutputFormat,
  GenerationQuality,
  GenerationSizeToken,
  GenerationType,
} from "@/lib/types";

export type ExternalGenerationRequest = {
  count: number;
  generationType: GenerationType;
  model?: string | null;
  moderation: GenerationModeration;
  negativePrompt?: string | null;
  outputCompression?: number | null;
  outputFormat: GenerationOutputFormat;
  prompt: string;
  quality: GenerationQuality;
  seed?: number | null;
  size: GenerationSizeToken;
  sourceImages?: Array<{
    data: Buffer;
    fileName: string;
    mimeType: string;
  }>;
};

type ExternalGenerationUser = {
  credits: number;
  id: string;
};

type RunExternalGenerationInput = {
  apiKeyId: string;
  input: ExternalGenerationRequest;
  signal?: AbortSignal;
  user: ExternalGenerationUser;
};

type WaitForExternalGenerationInput = {
  apiKeyId: string;
  jobId: string;
  signal?: AbortSignal;
};

class ExternalGenerationTimeoutError extends ApiTimeoutError {
  constructor(jobId: string) {
    super(`生成任务 ${jobId} 等待超时，请稍后通过 /v1/generations/${jobId} 查询结果`);
    this.name = "ExternalGenerationTimeoutError";
  }
}

async function resolveApiChannel(model?: string | null): Promise<ResolvedChannel> {
  const channels = await getActiveChannels();
  if (channels.length === 0) {
    throw new Error("当前没有可用的内置渠道");
  }

  if (!model) {
    return channels[0];
  }

  const matched = channels.find((channel) =>
    channel.defaultModel === model || channel.models.includes(model),
  );
  if (!matched) {
    throw new Error("模型不可用，请先通过 /v1/models 查看可用模型");
  }

  return matched;
}

function externalGenerationWaitConfig() {
  const env = getEnv();
  return {
    pollIntervalMs: env.EXTERNAL_GENERATION_POLL_INTERVAL_MS,
    timeoutMs: env.EXTERNAL_GENERATION_WAIT_TIMEOUT_SECONDS * 1000,
  };
}

function wait(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) {
    return Promise.reject(new Error("请求已取消"));
  }

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("请求已取消"));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function waitForExternalGeneration({
  apiKeyId,
  jobId,
  signal,
}: WaitForExternalGenerationInput) {
  const { pollIntervalMs, timeoutMs } = externalGenerationWaitConfig();
  const deadline = Date.now() + timeoutMs;

  while (true) {
    if (signal?.aborted) {
      throw new Error("请求已取消");
    }

    const job = await db.generationJob.findFirst({
      where: {
        apiKeyId,
        clientSource: GenerationClientSource.API,
        id: jobId,
      },
      include: {
        images: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!job) {
      throw new Error("生成任务不存在");
    }
    if (job.status === GenerationStatus.SUCCEEDED) {
      return job;
    }
    if (job.status === GenerationStatus.FAILED) {
      throw new Error(job.errorMessage || "生成失败");
    }
    if (Date.now() >= deadline) {
      throw new ExternalGenerationTimeoutError(jobId);
    }

    await wait(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())), signal);
  }
}

export async function runExternalGeneration({
  apiKeyId,
  input,
  signal,
  user,
}: RunExternalGenerationInput) {
  let jobId: string | null = null;
  let handedToWorker = false;
  await assertApiRateLimit(apiKeyId);

  const builtInProvider = await resolveApiChannel(input.model);
  const cost = calculateGenerationCost({
    builtInCreditCost: builtInProvider.creditCost,
    providerMode: "built_in",
  });
  const sourceImages = input.sourceImages ?? [];
  const model = input.model || builtInProvider.defaultModel;
  const count = input.generationType === "image_to_image" ? 1 : input.count;

  try {
    const job = await db.$transaction(async (tx) => {
      const created = await tx.generationJob.create({
        data: {
          apiKeyId,
          clientSource: GenerationClientSource.API,
          count,
          creditsSpent: cost,
          generationType:
            input.generationType === "image_to_image"
              ? "IMAGE_TO_IMAGE"
              : "TEXT_TO_IMAGE",
          model,
          negativePrompt: input.negativePrompt ?? null,
          outputCompression: input.outputCompression ?? null,
          outputFormat: input.outputFormat,
          prompt: input.prompt,
          providerChannelId: builtInProvider.id,
          providerMode: "BUILT_IN",
          quality: input.quality,
          moderation: input.moderation,
          seed: input.seed ?? null,
          size: input.size,
          sourceImageUrls: [],
          status: GenerationStatus.PENDING,
          userId: user.id,
          workerManaged: false,
        },
        include: { images: true },
      });

      if (cost > 0) {
        const charged = await tx.user.updateMany({
          where: {
            credits: {
              gte: cost,
            },
            id: user.id,
          },
          data: {
            credits: {
              decrement: cost,
            },
          },
        });

        if (charged.count === 0) {
          throw new Error("积分不足，请联系管理员补充");
        }
      }

      return created;
    });
    jobId = job.id;

    const sourceImageUrls = await Promise.all(
      sourceImages.map((sourceImage) =>
        persistGeneratedImage({
          buffer: sourceImage.data,
          fileExtension: sourceImage.fileName.split(".").pop() || "png",
          mimeType: sourceImage.mimeType,
          userId: user.id,
        }),
      ),
    );
    if (sourceImageUrls.length > 0) {
      await db.generationJob.update({
        where: { id: job.id },
        data: {
          sourceImageUrls,
          workerManaged: true,
        },
      });
    } else {
      await db.generationJob.update({
        where: { id: job.id },
        data: { workerManaged: true },
      });
    }
    handedToWorker = true;

    return await waitForExternalGeneration({
      apiKeyId,
      jobId: job.id,
      signal,
    });
  } catch (error) {
    if (jobId && !handedToWorker) {
      await failGenerationJobAndRefund({
        errorMessage: error instanceof Error ? error.message : "生成失败",
        jobId,
      });
    }
    throw error;
  }
}
