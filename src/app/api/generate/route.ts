import { GenerationStatus } from "@prisma/client";

import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import {
  GenerationContractError,
  channelSupportsModel,
  generationContractWriteFields,
  normalizeProviderModels,
} from "@/lib/generation/contracts";
import { parseGenerateRequest } from "@/lib/generation/parse-generate-request";
import { calculateGenerationCost, hasEnoughCredits, resolveCreditCost } from "@/lib/credits";
import {
  serializeGeneration,
  toPrismaGenerationType,
  toPrismaProviderMode,
} from "@/lib/prisma-mappers";
import {
  generationChannelModelSnapshot,
  getGenerationChannelById,
  getGenerationChannelForModel,
} from "@/lib/providers/built-in-provider";
import { decryptProviderSecret, encryptProviderSecret } from "@/lib/providers/provider-secret";
import { requireTurnstile } from "@/lib/auth/turnstile";
import { requireCurrentUserRecord } from "@/lib/server/current-user";
import { checkGenerationInput } from "@/lib/moderation/check";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/server/http";
import { assertPublicHttpUrl } from "@/lib/server/safe-remote-url";
import { persistGeneratedImage } from "@/lib/storage/persist-generated-image";
import { failGenerationJobAndRefund } from "@/lib/generation/job-refund";

async function assertGenerationPublicHttpUrl(url: string, fieldName: string) {
  try {
    await assertPublicHttpUrl(url);
  } catch {
    throw new Error(`${fieldName}仅支持公网 HTTP(S) 地址`);
  }
}

export async function POST(request: Request) {
  let jobId: string | null = null;

  try {
    const user = await requireCurrentUserRecord();
    const body = await parseGenerateRequest(request);
    await requireTurnstile("generate", body.turnstileToken);

    // 内容审核：敏感词 / AI 命中则阻断本次生成（不扣积分、不建 job）
    const moderation = await checkGenerationInput({
      userId: user.id,
      prompt: body.prompt,
      negativePrompt: body.negativePrompt,
    });
    if (!moderation.allowed) {
      return jsonError(moderation.message, 400);
    }
    const env = getEnv();

    const channelId = body.channelId as string | undefined;
    const builtInProvider = body.providerMode === "built_in"
      ? channelId
        ? await getGenerationChannelById(channelId, body.model)
        : await getGenerationChannelForModel(body.model)
      : null;

    const builtInCreditCost = resolveCreditCost({
      generationType: body.generationType,
      imageCreditCost:
        builtInProvider?.creditCost ?? env.BUILTIN_PROVIDER_CREDIT_COST,
      videoCreditCost:
        builtInProvider?.videoCreditCost ?? env.BUILTIN_PROVIDER_VIDEO_CREDIT_COST,
    });

    const cost = calculateGenerationCost({
      builtInCreditCost,
      providerMode: body.providerMode,
    });

    if (
      body.providerMode === "built_in" &&
      !hasEnoughCredits({
        builtInCreditCost,
        credits: user.credits,
        providerMode: body.providerMode,
      })
    ) {
      return jsonError("积分不足，请联系管理员补充", 402);
    }

    let customProvider = body.customProvider ?? null;
    let customProviderRemember = body.customProvider?.remember ?? false;
    let customProviderModels = body.customProvider?.models ?? [];
    if (body.providerMode === "custom" && !customProvider) {
      const saved = await db.savedProviderConfig.findUnique({
        where: { userId: user.id },
      });

      if (!saved) {
        return jsonError("请先填写自填渠道配置", 400);
      }

      customProvider = {
        apiKey: await decryptProviderSecret(
          saved.apiKeyEncrypted,
          env.AUTH_SECRET,
        ),
        baseUrl: saved.baseUrl,
        label: saved.label,
        model: body.model || saved.model,
        models: saved.models,
        remember: true,
      };
      customProviderRemember = true;
      customProviderModels = saved.models;
    }

    if (body.providerMode === "custom" && customProvider && !channelSupportsModel({
      defaultModel: customProvider.model,
      model: body.model,
      models: customProviderModels,
    })) {
      throw new GenerationContractError("MODEL_NOT_SUPPORTED_BY_CHANNEL");
    }

    // 此处做入队前校验；Worker 仍需对实际请求和重定向目标重复校验。
    const urlChecks = body.imageUrls.map((url) =>
      assertGenerationPublicHttpUrl(url, "参考图 URL")
    );
    if (body.providerMode === "custom" && customProvider) {
      urlChecks.push(
        assertGenerationPublicHttpUrl(customProvider.baseUrl, "自填渠道 Base URL"),
      );
    }
    await Promise.all(urlChecks);

    const inputConversationId = body.conversationId as string | undefined;
    let conversationToBind: string | null = null;
    if (inputConversationId) {
      const owned = await db.conversation.findFirst({
        where: { id: inputConversationId, userId: user.id },
        select: { id: true, generations: { select: { id: true }, take: 1 } },
      });
      if (!owned) {
        return jsonError("会话不存在或不属于当前用户", 400);
      }
      conversationToBind = owned.id;
    }

    const customProviderApiKeyEncrypted = customProvider
      ? await encryptProviderSecret(customProvider.apiKey, env.AUTH_SECRET)
      : null;

    const fileSourceImages = await Promise.all(
      body.images.map(async (image: File) => ({
        data: Buffer.from(await image.arrayBuffer()),
        fileName: image.name || "source.png",
        mimeType: image.type || "image/png",
      })),
    );
    const uploadedUrls = await Promise.all(
      fileSourceImages.map((sourceImage) =>
        persistGeneratedImage({
          buffer: sourceImage.data,
          fileExtension: sourceImage.fileName.split(".").pop() || "png",
          mimeType: sourceImage.mimeType,
          userId: user.id,
        }),
      ),
    );
    const sourceImageUrls = [...uploadedUrls, ...body.imageUrls];
    const contractFields = generationContractWriteFields(
      env.WORKER_CONTRACTS_V1_ENABLED,
    );

    // 创建 PENDING 任务并预扣积分。模型调用转交给 Go Worker，
    // 让请求链路保持短平快，也避免 Next 进程重启导致后台生成丢失。
    const job = await db.$transaction(async (tx) => {
      const created = await tx.generationJob.create({
        data: {
          ...(conversationToBind ? { conversationId: conversationToBind } : {}),
          count: body.count,
          contractVersion: contractFields.contractVersion,
          creditsSpent: body.providerMode === "built_in" ? cost : 0,
          generationType: toPrismaGenerationType(body.generationType),
          durationSeconds: body.durationSeconds ?? null,
          aspectRatio: body.aspectRatio ?? null,
          model: body.model,
          negativePrompt: body.negativePrompt,
          outputCompression: body.outputCompression,
          outputFormat: body.outputFormat,
          prompt: body.prompt,
          providerApiKeyEncrypted:
            body.providerMode === "custom" ? customProviderApiKeyEncrypted : null,
          providerBaseUrl:
            body.providerMode === "custom" ? customProvider?.baseUrl ?? null : null,
          providerChannelId:
            body.providerMode === "built_in" ? builtInProvider?.id ?? null : null,
          providerLabel:
            body.providerMode === "custom" ? customProvider?.label ?? null : null,
          providerModels:
            body.providerMode === "custom"
              ? normalizeProviderModels(customProvider?.model ?? body.model, customProviderModels)
              : generationChannelModelSnapshot(builtInProvider!),
          providerMode: toPrismaProviderMode(body.providerMode),
          providerRemember:
            body.providerMode === "custom" ? customProviderRemember : false,
          quality: body.quality,
          moderation: body.moderation,
          seed: body.seed,
          size: body.size,
          sourceImageUrls,
          status: GenerationStatus.PENDING,
          handoffState: contractFields.handoffState,
          userId: user.id,
          workerManaged: true,
        },
        include: {
          images: true,
          videos: true,
        },
      });

      if (body.replaceGenerationId && conversationToBind) {
        await tx.generationJob.updateMany({
          where: {
            conversationId: conversationToBind,
            id: body.replaceGenerationId,
            status: GenerationStatus.FAILED,
            userId: user.id,
          },
          data: {
            conversationId: null,
          },
        });
      }

      if (conversationToBind) {
        // 触发 updatedAt 刷新；若是会话内首条 generation，把 prompt 截前 30 字符作为 title 默认。
        const existingCount = await tx.generationJob.count({
          where: { conversationId: conversationToBind, NOT: { id: created.id } },
        });
        const updateData: { updatedAt: Date; title?: string } = { updatedAt: new Date() };
        if (existingCount === 0 && body.prompt) {
          updateData.title = body.prompt.slice(0, 30);
        }
        await tx.conversation.update({
          where: { id: conversationToBind },
          data: updateData,
        });
      }

      if (body.providerMode === "built_in" && cost > 0) {
        const charged = await tx.user.updateMany({
          where: { id: user.id, credits: { gte: cost } },
          data: { credits: { decrement: cost } },
        });
        if (charged.count === 0) {
          throw new Error("积分不足，请联系管理员补充");
        }
      }

      return created;
    });
    jobId = job.id;

    return jsonOk({
      generation: serializeGeneration(job),
    });
  } catch (error) {
    if (jobId) {
      await failGenerationJobAndRefund({
        errorMessage: getErrorMessage(error),
        jobId,
      });
    }

    if (error instanceof GenerationContractError) {
      return jsonError(error.message, error.status, error.code);
    }
    return jsonError(getErrorMessage(error), 400);
  }
}
