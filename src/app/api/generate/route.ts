import { GenerationStatus } from "@prisma/client";

import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { parseGenerateRequest } from "@/lib/generation/parse-generate-request";
import { calculateGenerationCost, hasEnoughCredits, resolveCreditCost } from "@/lib/credits";
import {
  serializeGeneration,
  toPrismaGenerationType,
  toPrismaProviderMode,
} from "@/lib/prisma-mappers";
import { getBuiltInProviderConfig, getChannelById } from "@/lib/providers/built-in-provider";
import { decryptProviderSecret, encryptProviderSecret } from "@/lib/providers/provider-secret";
import { requireTurnstile } from "@/lib/auth/turnstile";
import { requireCurrentUserRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/server/http";
import { persistGeneratedImage } from "@/lib/storage/persist-generated-image";
import { failGenerationJobAndRefund } from "@/lib/generation/job-refund";

export async function POST(request: Request) {
  let jobId: string | null = null;

  try {
    const user = await requireCurrentUserRecord();
    const body = await parseGenerateRequest(request);
    await requireTurnstile("generate", body.turnstileToken);
    const env = getEnv();

    const channelId = body.channelId as string | undefined;
    let builtInProvider;
    if (channelId) {
      const channel = await getChannelById(channelId);
      if (!channel) return jsonError("所选渠道不存在或已被停用", 400);
      builtInProvider = {
        apiKey: channel.apiKey,
        baseUrl: channel.baseUrl,
        creditCost: channel.creditCost,
        videoCreditCost: channel.videoCreditCost,
        id: channel.id,
        model: channel.defaultModel,
        models: channel.models,
        name: channel.name,
      };
    } else {
      builtInProvider = await getBuiltInProviderConfig();
    }

    const builtInCreditCost = resolveCreditCost({
      generationType: body.generationType,
      imageCreditCost: builtInProvider.creditCost,
      videoCreditCost: builtInProvider.videoCreditCost,
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

    // 创建 PENDING 任务并预扣积分。模型调用转交给 Go Worker，
    // 让请求链路保持短平快，也避免 Next 进程重启导致后台生成丢失。
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

    const job = await db.$transaction(async (tx) => {
      const created = await tx.generationJob.create({
        data: {
          ...(conversationToBind ? { conversationId: conversationToBind } : {}),
          count: body.count,
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
            body.providerMode === "built_in" ? builtInProvider.id ?? null : null,
          providerLabel:
            body.providerMode === "custom" ? customProvider?.label ?? null : null,
          providerModels:
            body.providerMode === "custom" ? customProviderModels : [],
          providerMode: toPrismaProviderMode(body.providerMode),
          providerRemember:
            body.providerMode === "custom" ? customProviderRemember : false,
          quality: body.quality,
          moderation: body.moderation,
          seed: body.seed,
          size: body.size,
          sourceImageUrls,
          status: GenerationStatus.PENDING,
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

    return jsonError(getErrorMessage(error), 400);
  }
}
