import { after } from "next/server";
import { GenerationStatus } from "@prisma/client";

import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { parseGenerateRequest } from "@/lib/generation/parse-generate-request";
import { calculateGenerationCost, hasEnoughCredits } from "@/lib/credits";
import {
  serializeGeneration,
  toPrismaGenerationType,
  toPrismaProviderMode,
} from "@/lib/prisma-mappers";
import { getBuiltInProviderConfig, getChannelById } from "@/lib/providers/built-in-provider";
import { decryptProviderSecret, encryptProviderSecret } from "@/lib/providers/provider-secret";
import { requireCurrentUserRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/server/http";
import { generateImages } from "@/lib/providers/generate-images";
import { persistGeneratedImage } from "@/lib/storage/persist-generated-image";
import { failGenerationJobAndRefund } from "@/lib/generation/job-refund";

export async function POST(request: Request) {
  let jobId: string | null = null;

  try {
    const user = await requireCurrentUserRecord();
    const body = await parseGenerateRequest(request);
    const env = getEnv();
    // Resolve channel: use channelId if given, else fall back to first active channel
    const channelId = body.channelId as string | undefined;
    let builtInProvider;
    if (channelId) {
      const channel = await getChannelById(channelId);
      if (!channel) return jsonError("所选渠道不存在或已被停用", 400);
      builtInProvider = {
        apiKey: channel.apiKey,
        baseUrl: channel.baseUrl,
        creditCost: channel.creditCost,
        model: channel.defaultModel,
        models: channel.models,
        name: channel.name,
      };
    } else {
      builtInProvider = await getBuiltInProviderConfig();
    }
    const cost = calculateGenerationCost({
      builtInCreditCost: builtInProvider.creditCost,
      providerMode: body.providerMode,
    });

    if (
      body.providerMode === "built_in" &&
      !hasEnoughCredits({
        builtInCreditCost: builtInProvider.creditCost,
        credits: user.credits,
        providerMode: body.providerMode,
      })
    ) {
      return jsonError("积分不足，请联系管理员补充", 402);
    }

    let customProvider = body.customProvider ?? null;
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
        model: saved.model,
        models: saved.models,
        remember: true,
      };
    }

    const sourceImages = await Promise.all(
      body.images.map(async (image: File) => ({
        data: Buffer.from(await image.arrayBuffer()),
        fileName: image.name || "source.png",
        mimeType: image.type || "image/png",
      })),
    );
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

    // 创建 PENDING 任务并预扣积分。预扣可避免连续点击造成的并发越扣，
    // 失败时在 after() 内退还。
    // 若提供 conversationId，先校验所有权防止跨用户写入；自动续推该会话的 updatedAt（首条 generation 还会刷新 title）。
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
          model: body.model,
          negativePrompt: body.negativePrompt,
          outputCompression: body.outputCompression,
          outputFormat: body.outputFormat,
          prompt: body.prompt,
          providerMode: toPrismaProviderMode(body.providerMode),
          quality: body.quality,
          moderation: body.moderation,
          size: body.size,
          sourceImageUrls,
          status: GenerationStatus.PENDING,
          userId: user.id,
        },
        include: {
          images: true,
        },
      });

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
        await tx.user.update({
          where: { id: user.id },
          data: {
            credits: {
              decrement: cost,
            },
          },
        });
      }

      return created;
    });
    jobId = job.id;

    const userId = user.id;
    const generationParams = {
      count: body.count,
      customProvider: customProvider
        ? {
            apiKey: customProvider.apiKey,
            baseUrl: customProvider.baseUrl,
            model: customProvider.model,
          }
        : null,
      generationType: body.generationType,
      model: body.model,
      negativePrompt: body.negativePrompt,
      outputCompression: body.outputCompression,
      outputFormat: body.outputFormat,
      prompt: body.prompt,
      providerMode: body.providerMode,
      quality: body.quality,
      moderation: body.moderation,
      seed: body.seed,
      size: body.size,
      sourceImages,
      userId,
    };
    const customProviderForRemember =
      customProvider && body.customProvider?.remember
        ? {
            apiKey: customProvider.apiKey,
            baseUrl: customProvider.baseUrl,
            label: customProvider.label || null,
            model: customProvider.model,
            models: body.customProvider?.models || [],
          }
        : null;
    const providerMode = body.providerMode;

    // 响应返回后再调模型；任意耗时（5 分钟、十分钟）都不会再被前置网关切断。
    after(async () => {
      try {
        const images = await generateImages(generationParams);

        await db.$transaction(async (tx) => {
          const updated = await tx.generationJob.updateMany({
            where: {
              id: job.id,
              status: GenerationStatus.PENDING,
            },
            data: {
              status: GenerationStatus.SUCCEEDED,
            },
          });

          if (updated.count === 0) {
            return;
          }

          await tx.generationImage.createMany({
            data: images.map((image) => ({
              height: image.actualHeight,
              jobId: job.id,
              url: image.url,
              width: image.actualWidth,
            })),
          });

          if (providerMode === "custom" && customProviderForRemember) {
            await tx.savedProviderConfig.upsert({
              where: { userId },
              update: {
                apiKeyEncrypted: await encryptProviderSecret(
                  customProviderForRemember.apiKey,
                  env.AUTH_SECRET,
                ),
                baseUrl: customProviderForRemember.baseUrl,
                label: customProviderForRemember.label,
                model: customProviderForRemember.model,
                models: customProviderForRemember.models,
              },
              create: {
                apiKeyEncrypted: await encryptProviderSecret(
                  customProviderForRemember.apiKey,
                  env.AUTH_SECRET,
                ),
                baseUrl: customProviderForRemember.baseUrl,
                label: customProviderForRemember.label,
                model: customProviderForRemember.model,
                models: customProviderForRemember.models,
                userId,
              },
            });
          }
        });
      } catch (error) {
        // 模型生成失败：标记 FAILED + 退还预扣积分。
        try {
          await failGenerationJobAndRefund({
            errorMessage: getErrorMessage(error),
            jobId: job.id,
          });
        } catch {
          // 退还失败时只能记录在 stderr，前端轮询仍能看到 FAILED。
          console.error(`[generate] failed to mark job ${job.id} as FAILED`);
        }
      }
    });

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
