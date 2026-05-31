import { NextResponse } from "next/server";

import { ApiAuthError, ApiRateLimitError, ApiTimeoutError } from "@/lib/api-errors";
import { getErrorMessage } from "@/lib/server/http";

const IMAGE_JSON_KEEP_ALIVE_INTERVAL_MS = 10_000;

function openAiErrorPayload(error: unknown) {
  const status =
    error instanceof ApiAuthError ||
    error instanceof ApiRateLimitError ||
    error instanceof ApiTimeoutError
      ? error.status
      : 400;
  const isAuthError = error instanceof ApiAuthError;
  const isRateLimitError = error instanceof ApiRateLimitError;
  const isTimeoutError = error instanceof ApiTimeoutError;
  const message = getErrorMessage(error);

  return {
    body: {
      error: {
        code: isRateLimitError
          ? "rate_limit_exceeded"
          : isAuthError
            ? "invalid_api_key"
            : isTimeoutError
              ? "timeout"
              : "invalid_request_error",
        message,
        type: isRateLimitError
          ? "rate_limit_error"
          : isAuthError
            ? "authentication_error"
            : isTimeoutError
              ? "server_error"
              : "invalid_request_error",
      },
    },
    status,
  };
}

export function openAiError(error: unknown) {
  const payload = openAiErrorPayload(error);

  return NextResponse.json(
    payload.body,
    { status: payload.status },
  );
}

function shouldUseImageJsonKeepAlive(request: Request) {
  const userAgent = request.headers.get("user-agent")?.toLowerCase() ?? "";
  return userAgent.includes("kelivo");
}

export async function openAiImageJsonResponse(
  request: Request,
  createPayload: () => Promise<unknown>,
) {
  if (!shouldUseImageJsonKeepAlive(request)) {
    return NextResponse.json(await createPayload());
  }

  const encoder = new TextEncoder();
  let isClosed = false;
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  const clearKeepAlive = () => {
    if (keepAlive) {
      clearInterval(keepAlive);
      keepAlive = null;
    }
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (value: string) => {
        if (isClosed) return;
        try {
          controller.enqueue(encoder.encode(value));
        } catch {
          isClosed = true;
          clearKeepAlive();
        }
      };
      const close = () => {
        if (isClosed) return;
        isClosed = true;
        clearKeepAlive();
        controller.close();
      };
      keepAlive = setInterval(
        () => write(" \n"),
        IMAGE_JSON_KEEP_ALIVE_INTERVAL_MS,
      );

      write(" \n");

      void createPayload()
        .then((payload) => {
          write(JSON.stringify(payload));
        })
        .catch((error) => {
          write(JSON.stringify(openAiErrorPayload(error).body));
        })
        .finally(() => {
          close();
        });
    },
    cancel() {
      isClosed = true;
      clearKeepAlive();
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "application/json; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}

export function unixSeconds(date = new Date()) {
  return Math.floor(date.getTime() / 1000);
}

type ChatStreamPayload = {
  content: string;
  created: number;
  generationId: string;
  id: string;
  model: string;
};

function createChatCompletionChunk(
  payload: ChatStreamPayload,
  delta: Record<string, string>,
  finishReason: "stop" | null,
) {
  return {
    choices: [
      {
        delta,
        finish_reason: finishReason,
        index: 0,
      },
    ],
    created: payload.created,
    generation_id: payload.generationId,
    id: payload.id,
    model: payload.model,
    object: "chat.completion.chunk",
  };
}

export function openAiChatStream(payload: ChatStreamPayload) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (value: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
      };

      send(createChatCompletionChunk(payload, { role: "assistant" }, null));
      send(createChatCompletionChunk(payload, { content: payload.content }, null));
      send(createChatCompletionChunk(payload, {}, "stop"));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
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
