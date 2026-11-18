import { db } from "@/lib/db";
import { requireAdminRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/server/http";
import { imageAvailabilityInclude } from "@/lib/storage/image-availability";
import { presentGenerationImage } from "@/lib/storage/image-presentation";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdminRecord();
    const { id } = await context.params;

    const record = await db.generationJob.findUnique({
      select: {
        apiKey: {
          select: {
            id: true,
            keyPrefix: true,
            name: true,
          },
        },
        apiKeyId: true,
        aspectRatio: true,
        attemptCount: true,
        attempts: {
          orderBy: { ordinal: "asc" },
          select: {
            completedAt: true,
            createdAt: true,
            errorCode: true,
            errorMessage: true,
            id: true,
            idempotencyKey: true,
            model: true,
            nextRetryAt: true,
            operation: true,
            ordinal: true,
            providerChannelId: true,
            providerRequestId: true,
            status: true,
            updatedAt: true,
            upstreamSubmittedAt: true,
            workerId: true,
          },
        },
        cancelRequestedAt: true,
        clientSource: true,
        completedAt: true,
        contractVersion: true,
        conversationId: true,
        count: true,
        createdAt: true,
        creditsSpent: true,
        durationSeconds: true,
        errorCode: true,
        errorMessage: true,
        generationType: true,
        handoffState: true,
        id: true,
        images: {
          include: imageAvailabilityInclude,
          orderBy: { createdAt: "asc" },
        },
        lockedAt: true,
        model: true,
        moderation: true,
        negativePrompt: true,
        nextAttemptAt: true,
        outputCompression: true,
        outputFormat: true,
        prompt: true,
        providerBaseUrl: true,
        providerChannelId: true,
        providerLabel: true,
        providerMode: true,
        quality: true,
        refundAppliedAt: true,
        seed: true,
        size: true,
        sourceImageUrls: true,
        startedAt: true,
        status: true,
        updatedAt: true,
        user: {
          select: {
            credits: true,
            email: true,
            id: true,
            nickname: true,
          },
        },
        userId: true,
        videos: {
          orderBy: { createdAt: "asc" },
          select: {
            durationSeconds: true,
            height: true,
            id: true,
            posterUrl: true,
            url: true,
            width: true,
          },
        },
        workerId: true,
        workerManaged: true,
      },
      where: { id },
    });

    if (!record) {
      return jsonError("生成任务不存在", 404);
    }

    const channel =
      record.providerChannelId &&
      typeof db.providerChannel?.findUnique === "function"
        ? await db.providerChannel.findUnique({
            select: {
              id: true,
              name: true,
              slug: true,
            },
            where: { id: record.providerChannelId },
          })
        : null;

    return jsonOk({
      job: {
        apiKey: record.apiKey,
        aspectRatio: record.aspectRatio,
        attemptCount: record.attemptCount,
        attempts: record.attempts.map((attempt) => ({
          completedAt: attempt.completedAt?.toISOString() ?? null,
          createdAt: attempt.createdAt.toISOString(),
          errorCode: attempt.errorCode,
          errorMessage: attempt.errorMessage,
          id: attempt.id,
          idempotencyKey: attempt.idempotencyKey,
          model: attempt.model,
          nextRetryAt: attempt.nextRetryAt?.toISOString() ?? null,
          operation: attempt.operation,
          ordinal: attempt.ordinal,
          providerChannelId: attempt.providerChannelId,
          providerRequestId: attempt.providerRequestId,
          status: attempt.status,
          updatedAt: attempt.updatedAt.toISOString(),
          upstreamSubmittedAt: attempt.upstreamSubmittedAt?.toISOString() ?? null,
          workerId: attempt.workerId,
        })),
        cancelRequestedAt: record.cancelRequestedAt?.toISOString() ?? null,
        channel,
        clientSource: record.clientSource,
        completedAt: record.completedAt?.toISOString() ?? null,
        contractVersion: record.contractVersion,
        conversationId: record.conversationId,
        count: record.count,
        createdAt: record.createdAt.toISOString(),
        creditsSpent: record.creditsSpent,
        durationSeconds: record.durationSeconds,
        errorCode: record.errorCode,
        errorMessage: record.errorMessage,
        generationType: record.generationType,
        handoffState: record.handoffState,
        id: record.id,
        images: record.images.map((image) => {
          const presented = presentGenerationImage(image);
          return {
            availability: presented.availability,
            height: image.height,
            id: image.id,
            url: presented.availability === "available" ? presented.url : "",
            width: image.width,
          };
        }),
        lockedAt: record.lockedAt?.toISOString() ?? null,
        model: record.model,
        moderation: record.moderation,
        negativePrompt: record.negativePrompt,
        nextAttemptAt: record.nextAttemptAt?.toISOString() ?? null,
        outputCompression: record.outputCompression,
        outputFormat: record.outputFormat,
        prompt: record.prompt,
        providerBaseUrl: record.providerBaseUrl,
        providerChannelId: record.providerChannelId,
        providerLabel: record.providerLabel,
        providerMode: record.providerMode,
        quality: record.quality,
        refundAppliedAt: record.refundAppliedAt?.toISOString() ?? null,
        seed: record.seed,
        size: record.size,
        sourceImageUrls: record.sourceImageUrls,
        startedAt: record.startedAt?.toISOString() ?? null,
        status: record.status,
        updatedAt: record.updatedAt.toISOString(),
        user: record.user,
        videos: record.videos,
        workerId: record.workerId,
        workerManaged: record.workerManaged,
      },
    });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
