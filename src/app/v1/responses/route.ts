import { NextResponse } from "next/server";

import {
  formatResponsesImageGenerationPayload,
  parseResponsesGenerationInput,
} from "@/lib/external-api/responses";
import { openAiError } from "@/lib/external-api/http";
import { runExternalGeneration } from "@/lib/generation/external-api";
import { requireApiUser } from "@/lib/server/api-auth";
import { parseJsonBody } from "@/lib/server/http";
import { externalResponsesSchema } from "@/lib/validators";

export async function POST(request: Request) {
  try {
    const auth = await requireApiUser(request);
    const body = externalResponsesSchema.parse(await parseJsonBody(request));
    const parsed = await parseResponsesGenerationInput(body);

    const job = await runExternalGeneration({
      apiKeyId: auth.apiKey.id,
      input: {
        count: 1,
        generationType: parsed.generationType,
        model: body.model,
        moderation: parsed.moderation,
        outputCompression: parsed.outputCompression,
        outputFormat: parsed.outputFormat,
        prompt: parsed.prompt,
        quality: parsed.quality,
        size: parsed.size,
        sourceImages: parsed.sourceImages,
      },
      user: auth.user,
    });

    const model = body.model ?? job.model;

    return NextResponse.json(
      await formatResponsesImageGenerationPayload({
        body,
        job,
        model,
      }),
    );
  } catch (error) {
    return openAiError(error);
  }
}
