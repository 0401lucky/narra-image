import { GenerationClientSource } from "@prisma/client";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { openAiError, unixSeconds } from "@/lib/external-api/http";
import {
  forwardGenerationQuery,
  isGatewayEnabled,
} from "@/lib/generation/gateway-client";
import { requireApiUser } from "@/lib/server/api-auth";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireApiUser(request);
    const { id } = await context.params;

    if (isGatewayEnabled()) {
      return await forwardGenerationQuery({ apiKeyId: auth.apiKey.id, jobId: id });
    }

    const job = await db.generationJob.findFirst({
      where: {
        apiKeyId: auth.apiKey.id,
        clientSource: GenerationClientSource.API,
        id,
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

    return NextResponse.json({
      created: unixSeconds(job.createdAt),
      error: job.errorMessage,
      id: job.id,
      images: job.images.map((image) => ({
        height: image.height,
        id: image.id,
        url: image.url,
        width: image.width,
      })),
      model: job.model,
      object: "image.generation",
      status:
        job.status === "SUCCEEDED"
          ? "succeeded"
          : job.status === "FAILED"
            ? "failed"
            : "pending",
    });
  } catch (error) {
    return openAiError(error);
  }
}
