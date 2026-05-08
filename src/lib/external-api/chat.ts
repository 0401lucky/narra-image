import "server-only";

import { downloadExternalImage } from "@/lib/external-api/source-images";
import { GENERATION_PROMPT_MAX_LENGTH } from "@/lib/generation/limits";
import type { externalChatCompletionSchema } from "@/lib/validators";
import type { z } from "zod";

type ChatBody = z.infer<typeof externalChatCompletionSchema>;

const MAX_CHAT_REFERENCE_IMAGES = 4;

function readImageUrl(value: string | { url: string }) {
  return typeof value === "string" ? value : value.url;
}

export async function parseChatGenerationInput(body: ChatBody) {
  const lastUserMessage = [...body.messages]
    .reverse()
    .find((message) => message.role === "user");

  if (!lastUserMessage) {
    throw new Error("messages 中必须包含 user 消息");
  }

  if (typeof lastUserMessage.content === "string") {
    const prompt = lastUserMessage.content.trim();
    if (!prompt) {
      throw new Error("user message 中必须包含文本提示词");
    }

    return {
      prompt,
      sourceImages: [],
    };
  }

  const textParts: string[] = [];
  const imageUrls: string[] = [];

  for (const part of lastUserMessage.content) {
    if (part.type === "text") {
      textParts.push(part.text);
    } else {
      imageUrls.push(readImageUrl(part.image_url));
    }
  }

  const prompt = textParts.join("\n").trim();
  if (!prompt) {
    throw new Error("user message 中必须包含文本提示词");
  }
  if (prompt.length > GENERATION_PROMPT_MAX_LENGTH) {
    throw new Error(`提示词最多 ${GENERATION_PROMPT_MAX_LENGTH} 个字符`);
  }
  if (imageUrls.length > MAX_CHAT_REFERENCE_IMAGES) {
    throw new Error(`参考图最多支持 ${MAX_CHAT_REFERENCE_IMAGES} 张`);
  }

  const sourceImages = await Promise.all(
    imageUrls.map((url, index) => downloadExternalImage(url, index)),
  );

  return {
    prompt,
    sourceImages,
  };
}
