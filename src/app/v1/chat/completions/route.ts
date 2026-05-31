import { NextResponse } from "next/server";

import { parseChatGenerationInput } from "@/lib/external-api/chat";
import { openAiChatStream, openAiError, unixSeconds } from "@/lib/external-api/http";
import { runExternalGeneration } from "@/lib/generation/external-api";
import { requireApiUser } from "@/lib/server/api-auth";
import { parseJsonBody } from "@/lib/server/http";
import { externalChatCompletionSchema } from "@/lib/validators";

export async function POST(request: Request) {
  try {
    const auth = await requireApiUser(request);
    const body = externalChatCompletionSchema.parse(await parseJsonBody(request));

    const parsed = await parseChatGenerationInput(body);
    const job = await runExternalGeneration({
      apiKeyId: auth.apiKey.id,
      input: {
        count: body.n ?? 1,
        generationType: parsed.sourceImages.length > 0 ? "image_to_image" : "text_to_image",
        model: body.model,
        moderation: "auto",
        outputCompression: null,
        outputFormat: "png",
        prompt: parsed.prompt,
        quality: body.quality ?? "auto",
        size: body.size ?? "auto",
        sourceImages: parsed.sourceImages,
      },
      signal: request.signal,
      user: auth.user,
    });

    const imageMarkdown = job.images
      .map((image, index) => `![image-${index + 1}](${image.url})\n${image.url}`)
      .join("\n\n");
    const content = `生成完成。\n\n${imageMarkdown}`;
    const created = unixSeconds(job.createdAt);
    const id = `chatcmpl_${job.id}`;
    const model = body.model ?? job.model;

    if (body.stream) {
      return openAiChatStream({
        content,
        created,
        generationId: job.id,
        id,
        model,
      });
    }

    return NextResponse.json({
      choices: [
        {
          finish_reason: "stop",
          index: 0,
          message: {
            content,
            role: "assistant",
          },
        },
      ],
      created,
      generation_id: job.id,
      id,
      model,
      object: "chat.completion",
      usage: {
        completion_tokens: 0,
        prompt_tokens: 0,
        total_tokens: 0,
      },
    });
  } catch (error) {
    return openAiError(error);
  }
}
