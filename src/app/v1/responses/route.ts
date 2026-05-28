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

    const createPayload = async () => {
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

      return await formatResponsesImageGenerationPayload({
        body,
        job,
        model,
      });
    };

    if (body.stream) {
      return openAiResponsesStream(createPayload);
    }

    return NextResponse.json(await createPayload());
  } catch (error) {
    return openAiError(error);
  }
}

type ResponsesPayload = Awaited<ReturnType<typeof formatResponsesImageGenerationPayload>>;

function openAiResponsesStream(createPayload: () => Promise<ResponsesPayload>) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const sendEvent = (event: string, value: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`),
        );
      };

      try {
        sendEvent("response.created", { type: "response.created" });
        const payload = await createPayload();
        payload.output.forEach((item, index) => {
          sendEvent("response.output_item.done", {
            item,
            output_index: index,
            sequence_number: index + 1,
            type: "response.output_item.done",
          });
        });
        sendEvent("response.completed", {
          response: payload,
          type: "response.completed",
        });
      } catch (error) {
        sendEvent("response.failed", {
          error: {
            message: error instanceof Error ? error.message : String(error),
            type: "invalid_request_error",
          },
          type: "response.failed",
        });
      } finally {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
