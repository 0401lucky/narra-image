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
import { getBuiltInProviderConfig } from "@/lib/providers/built-in-provider";
import { decryptProviderSecret, encryptProviderSecret } from "@/lib/providers/provider-secret";
import { requireCurrentUserRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/server/http";
import { generateImages } from "@/lib/providers/generate-images";
import { persistGeneratedImage } from "@/lib/storage/persist-generated-image";

export async function POST(request: Request) {
  let jobId: string | null = null;

  try {
    const user = await requireCurrentUserRecord();
    const body = await parseGenerateRequest(request);
    const env = getEnv();
    const builtInProvider = await getBuiltInProviderConfig();
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

    const sourceImage =
      body.image instanceof File
        ? {
            data: Buffer.from(await body.image.arrayBuffer()),
            fileName: body.image.name || "source.png",
            mimeType: body.image.type || "image/png",
          }
        : null;
    const sourceImageUrl = sourceImage
      ? await persistGeneratedImage({
          buffer: sourceImage.data,
          fileExtension: sourceImage.fileName.split(".").pop() || "png",
          mimeType: sourceImage.mimeType,
          userId: user.id,
        })
      : null;

    const job = await db.generationJob.create({
      data: {
        count: body.count,
        creditsSpent: 0,
        generationType: toPrismaGenerationType(body.generationType),
        model: body.model,
        negativePrompt: body.negativePrompt,
        prompt: body.prompt,
        providerMode: toPrismaProviderMode(body.providerMode),
        size: body.size,
        sourceImageUrl,
        status: GenerationStatus.PENDING,
        userId: user.id,
      },
      include: {
        images: true,
      },
    });
    jobId = job.id;

    const images = await generateImages({
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
      prompt: body.prompt,
      providerMode: body.providerMode,
      seed: body.seed,
      size: body.size,
      sourceImage,
      userId: user.id,
    });

    await db.$transaction(async (tx) => {
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

      await tx.generationImage.createMany({
        data: images.map((url) => ({
          jobId: job.id,
          url,
        })),
      });

      await tx.generationJob.update({
        where: { id: job.id },
        data: {
          creditsSpent: cost,
          status: GenerationStatus.SUCCEEDED,
        },
      });

      if (
        body.providerMode === "custom" &&
        customProvider &&
        body.customProvider?.remember
      ) {
        await tx.savedProviderConfig.upsert({
          where: { userId: user.id },
          update: {
            apiKeyEncrypted: await encryptProviderSecret(
              customProvider.apiKey,
              env.AUTH_SECRET,
            ),
            baseUrl: customProvider.baseUrl,
            label: customProvider.label || null,
            model: customProvider.model,
            models: body.customProvider?.models || [],
          },
          create: {
            apiKeyEncrypted: await encryptProviderSecret(
              customProvider.apiKey,
              env.AUTH_SECRET,
            ),
            baseUrl: customProvider.baseUrl,
            label: customProvider.label || null,
            model: customProvider.model,
            models: body.customProvider?.models || [],
            userId: user.id,
          },
        });
      }
    });

    const completedJob = await db.generationJob.findUniqueOrThrow({
      where: { id: job.id },
      include: {
        images: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    return jsonOk({
      generation: serializeGeneration(completedJob),
    });
  } catch (error) {
    if (jobId) {
      await db.generationJob.update({
        where: { id: jobId },
        data: {
          errorMessage: getErrorMessage(error),
          status: GenerationStatus.FAILED,
        },
      });
    }

    return jsonError(getErrorMessage(error), 400);
  }
}
