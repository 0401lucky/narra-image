import "server-only";

import { formatImageGenerationData } from "@/lib/external-api/images";
import { downloadExternalImage } from "@/lib/external-api/source-images";
import { GENERATION_PROMPT_MAX_LENGTH } from "@/lib/generation/limits";
import type {
  GenerationModeration,
  GenerationOutputFormat,
  GenerationQuality,
  GenerationSizeToken,
} from "@/lib/types";

const MAX_RESPONSE_REFERENCE_IMAGES = 4;
const MAX_DATA_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_DATA_IMAGE_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export type ExternalResponsesBody = {
  input: unknown;
  model?: string;
  previous_response_id?: string | null;
  stream?: boolean;
  tool_choice?: unknown;
  tools?: unknown;
};

export type ResponsesGenerationInput = {
  generationType: "text_to_image" | "image_to_image";
  moderation: GenerationModeration;
  outputCompression: number | null;
  outputFormat: GenerationOutputFormat;
  prompt: string;
  quality: GenerationQuality;
  size: GenerationSizeToken;
  sourceImages: Array<{
    data: Buffer;
    fileName: string;
    mimeType: string;
  }>;
};

type CompletedResponsesJob = {
  createdAt: Date;
  id: string;
  images: Array<{
    height: number | null;
    url: string;
    width: number | null;
  }>;
  model: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringField(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function hasImageGenerationTool(tools: unknown) {
  if (!Array.isArray(tools)) return false;
  return tools.some((tool) => isRecord(tool) && tool.type === "image_generation");
}

function findImageGenerationTool(tools: unknown) {
  if (!Array.isArray(tools)) return null;
  return tools.find((tool) => isRecord(tool) && tool.type === "image_generation") ?? null;
}

function readImageUrl(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (isRecord(value)) return stringField(value.url);
  return "";
}

function collectInputParts(input: unknown) {
  const textParts: string[] = [];
  const imageUrls: string[] = [];
  let fileIdCount = 0;

  const visitContent = (content: unknown) => {
    if (typeof content === "string") {
      textParts.push(content);
      return;
    }

    if (!Array.isArray(content)) return;

    for (const part of content) {
      if (!isRecord(part)) continue;

      if (part.type === "input_text" || part.type === "text") {
        const text = stringField(part.text);
        if (text) textParts.push(text);
        continue;
      }

      if (part.type === "input_image" || part.type === "image_url") {
        const url = readImageUrl(part.image_url);
        if (url) {
          imageUrls.push(url);
        } else if (part.file_id) {
          fileIdCount += 1;
        }
      }
    }
  };

  if (typeof input === "string") {
    textParts.push(input);
  } else if (Array.isArray(input)) {
    for (const item of input) {
      if (!isRecord(item)) continue;
      if (item.type === "image_generation_call") {
        continue;
      }
      visitContent(item.content);
    }
  } else if (isRecord(input)) {
    visitContent(input.content);
  }

  return {
    fileIdCount,
    imageUrls,
    prompt: textParts.join("\n").trim(),
  };
}

function normalizeQuality(value: unknown): GenerationQuality {
  return value === "low" || value === "medium" || value === "high" || value === "auto"
    ? value
    : "auto";
}

function normalizeModeration(value: unknown): GenerationModeration {
  return value === "low" || value === "auto" ? value : "auto";
}

function normalizeOutputFormat(value: unknown): GenerationOutputFormat {
  return value === "jpeg" || value === "webp" || value === "png" ? value : "png";
}

function normalizeOutputCompression(
  outputFormat: GenerationOutputFormat,
  value: unknown,
) {
  if (outputFormat === "png") return null;
  if (typeof value !== "number" || !Number.isInteger(value)) return 100;
  return Math.min(100, Math.max(0, value));
}

function normalizeSize(value: unknown): GenerationSizeToken {
  return typeof value === "string" && value.trim() ? value.trim() as GenerationSizeToken : "auto";
}

function decodeDataImageUrl(url: string, index: number) {
  const match = url.match(/^data:([^;,]+);base64,([\s\S]*)$/i);
  if (!match) return null;

  const mimeType = match[1].toLowerCase();
  if (!ALLOWED_DATA_IMAGE_TYPES.has(mimeType)) {
    throw new Error("input_image 仅支持 png、jpeg、webp 或 gif 图片");
  }

  const data = Buffer.from(match[2], "base64");
  if (data.byteLength > MAX_DATA_IMAGE_BYTES) {
    throw new Error("input_image 不能超过 10MB");
  }

  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1] || "png";
  return {
    data,
    fileName: `source-${index + 1}.${extension}`,
    mimeType,
  };
}

async function downloadResponsesImage(url: string, index: number) {
  const dataUrlImage = decodeDataImageUrl(url, index);
  if (dataUrlImage) return dataUrlImage;
  return downloadExternalImage(url, index);
}

export async function parseResponsesGenerationInput(
  body: ExternalResponsesBody,
): Promise<ResponsesGenerationInput> {
  if (body.stream) {
    throw new Error("responses 生图暂不支持 stream=true，请使用非流式请求");
  }

  if (body.previous_response_id) {
    throw new Error("responses 生图暂不支持 previous_response_id，请通过 input_image 传入参考图");
  }

  if (!hasImageGenerationTool(body.tools)) {
    throw new Error("responses 请求必须包含 image_generation 工具");
  }

  const tool = findImageGenerationTool(body.tools);
  const { fileIdCount, imageUrls, prompt } = collectInputParts(body.input);

  if (!prompt) {
    throw new Error("responses input 中必须包含文本提示词");
  }
  if (prompt.length > GENERATION_PROMPT_MAX_LENGTH) {
    throw new Error(`提示词最多 ${GENERATION_PROMPT_MAX_LENGTH} 个字符`);
  }
  if (fileIdCount > 0) {
    throw new Error("responses input_image 暂不支持 file_id，请使用 image_url 或 data URL");
  }
  if (imageUrls.length > MAX_RESPONSE_REFERENCE_IMAGES) {
    throw new Error(`参考图最多支持 ${MAX_RESPONSE_REFERENCE_IMAGES} 张`);
  }

  const sourceImages = await Promise.all(
    imageUrls.map((url, index) => downloadResponsesImage(url, index)),
  );
  const action = isRecord(tool) ? tool.action : null;
  if (action === "edit" && sourceImages.length === 0) {
    throw new Error("image_generation action=edit 需要至少一张 input_image");
  }

  const outputFormat = normalizeOutputFormat(isRecord(tool) ? tool.output_format : null);

  return {
    generationType: sourceImages.length > 0 ? "image_to_image" : "text_to_image",
    moderation: normalizeModeration(isRecord(tool) ? tool.moderation : null),
    outputCompression: normalizeOutputCompression(
      outputFormat,
      isRecord(tool) ? tool.output_compression : null,
    ),
    outputFormat,
    prompt,
    quality: normalizeQuality(isRecord(tool) ? tool.quality : null),
    size: normalizeSize(isRecord(tool) ? tool.size : null),
    sourceImages,
  };
}

export async function formatResponsesImageGenerationPayload(input: {
  body: ExternalResponsesBody;
  job: CompletedResponsesJob;
  model: string;
}) {
  const data = await formatImageGenerationData(input.job.images, "b64_json") as Array<{
    b64_json: string;
    height: number | null;
    url: string;
    width: number | null;
  }>;
  const output = data.map((image, index) => ({
    id: `ig_${input.job.id}_${index + 1}`,
    result: image.b64_json,
    status: "completed",
    type: "image_generation_call",
  }));

  return {
    background: false,
    created_at: Math.floor(input.job.createdAt.getTime() / 1000),
    error: null,
    id: `resp_${input.job.id}`,
    incomplete_details: null,
    instructions: null,
    metadata: {},
    model: input.model,
    object: "response",
    output,
    output_text: "",
    parallel_tool_calls: true,
    previous_response_id: input.body.previous_response_id ?? null,
    status: "completed",
    temperature: null,
    tool_choice: input.body.tool_choice ?? "auto",
    tools: input.body.tools ?? [],
    top_p: null,
    usage: {
      input_tokens: 0,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 0,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 0,
    },
  };
}
