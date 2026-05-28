import "server-only";

import OpenAI, { toFile } from "openai";

import {
  type ImageDimensions,
  formatDimensions,
  readImageDimensions,
} from "@/lib/generation/image-dimensions";
import { persistGeneratedImage } from "@/lib/storage/persist-generated-image";
import { getBuiltInProviderConfig } from "@/lib/providers/built-in-provider";
import { supportsResponsesImageGeneration } from "@/lib/providers/model-catalog";
import { resolveGenerationProvider } from "@/lib/providers/resolve-provider";
import type {
  GenerationModeration,
  GenerationOutputFormat,
  GenerationQuality,
  GenerationSizeToken,
  GenerationType,
  ProviderMode,
} from "@/lib/types";

export type GeneratedImageRecord = {
  actualHeight: number | null;
  actualSize: string | null;
  actualWidth: number | null;
  url: string;
};

type CustomProviderConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

type GenerateImagesInput = {
  count: number;
  builtInProvider?: CustomProviderConfig | null;
  customProvider: CustomProviderConfig | null;
  generationType: GenerationType;
  model: string;
  negativePrompt?: string | null;
  outputCompression?: number | null;
  outputFormat?: GenerationOutputFormat;
  prompt: string;
  providerMode: ProviderMode;
  quality?: GenerationQuality;
  moderation?: GenerationModeration;
  seed?: number | null;
  size: GenerationSizeToken;
  sourceImage?: {
    data: Buffer;
    fileName: string;
    mimeType: string;
  } | null;
  sourceImages?: Array<{
    data: Buffer;
    fileName: string;
    mimeType: string;
  }>;
  userId: string;
};

type RawGeneratedImageItem = {
  actualHeight?: unknown;
  actualWidth?: unknown;
  actual_height?: unknown;
  actual_width?: unknown;
  b64_json?: string | null;
  height?: unknown;
  size?: unknown;
  url?: string | null;
  width?: unknown;
};

type ResponsesImageGenerationItem = {
  id?: string;
  result?: string | null;
  status?: string;
  type?: string;
};

type ResponsesImageGenerationOutput = {
  output?: ResponsesImageGenerationItem[];
};

type ResponsesStreamEvent = {
  item?: ResponsesImageGenerationItem;
  response?: ResponsesImageGenerationOutput;
  type?: string;
};

export async function generateImages(input: GenerateImagesInput) {
  const builtInConfig = input.builtInProvider ?? await getBuiltInProviderConfig();
  const provider = resolveGenerationProvider({
    builtIn: {
      apiKey: builtInConfig.apiKey,
      baseUrl: builtInConfig.baseUrl,
      model: builtInConfig.model,
    },
    custom: input.customProvider,
    providerMode: input.providerMode,
  });

  if (!provider.apiKey || !provider.baseUrl) {
    throw new Error("当前渠道未配置完成");
  }

  const client = new OpenAI({
    apiKey: provider.apiKey,
    baseURL: provider.baseUrl,
    timeout: 180_000,
  });

  const sourceImages = input.sourceImages ?? (input.sourceImage ? [input.sourceImage] : []);

  if (input.generationType === "image_to_image" && sourceImages.length === 0) {
    throw new Error("请先上传参考图");
  }

  // SDK 类型暂时落后于 gpt-image-2 的灵活尺寸，运行时按官方参数透传。
  const compatibleSize = input.size as unknown as
    | "auto"
    | "1024x1024"
    | "1024x1536"
    | "1536x1024"
    | "256x256"
    | "512x512";
  const outputFormat = input.outputFormat ?? "png";
  const outputOptions = {
    ...(outputFormat !== "png" ? { output_format: outputFormat } : {}),
    ...(outputFormat !== "png" && input.outputCompression != null
      ? { output_compression: input.outputCompression }
      : {}),
    ...(input.quality && input.quality !== "auto" ? { quality: input.quality } : {}),
  } as const;
  const model = input.model || provider.model;

  const result = supportsResponsesImageGeneration(model)
    ? await generateWithResponsesImageTool({
        client,
        compatibleSize,
        input,
        model,
        outputOptions,
        sourceImages,
      })
    : input.generationType === "image_to_image"
    ? await client.images.edit({
        image: await Promise.all(
          sourceImages.map((sourceImage, index) =>
            toFile(
              sourceImage.data,
              sourceImage.fileName || `source-${index + 1}.png`,
              {
                type: sourceImage.mimeType || "image/png",
              },
            ),
          ),
        ),
        model,
        n: 1,
        ...outputOptions,
        prompt: input.prompt,
        size: compatibleSize,
      })
    : await client.images.generate({
        ...(input.moderation && input.moderation !== "auto"
          ? { moderation: input.moderation }
          : {}),
        model,
        n: input.count,
        ...outputOptions,
        prompt: input.prompt,
        size: compatibleSize,
        ...(input.negativePrompt || input.seed
          ? {
              extra_body: {
                negative_prompt: input.negativePrompt,
                seed: input.seed,
              },
            }
          : {}),
      });

  const items = ((result as { data?: RawGeneratedImageItem[] }).data ?? []);

  if (items.length === 0) {
    throw new Error("渠道没有返回图片结果");
  }

  return Promise.all(
    items.map(async (item): Promise<GeneratedImageRecord> => {
      if (item.b64_json) {
        const buffer = Buffer.from(item.b64_json, "base64");
        const dimensions =
          extractDimensionsFromMetadata(item, result) ?? readImageDimensions(buffer);
        const url = await persistGeneratedImage({
          b64Json: item.b64_json,
          userId: input.userId,
        });
        return toRecord(url, dimensions);
      }

      if (item.url) {
        const dimensions =
          extractDimensionsFromMetadata(item, result) ??
          (await fetchAndProbeDimensions(item.url));
        const url = await persistGeneratedImage({
          url: item.url,
          userId: input.userId,
        });
        return toRecord(url, dimensions);
      }

      throw new Error("返回结果里没有可用图片");
    }),
  );
}

async function generateWithResponsesImageTool(input: {
  client: OpenAI;
  compatibleSize: string;
  input: GenerateImagesInput;
  model: string;
  outputOptions: Record<string, unknown>;
  sourceImages: Array<{
    data: Buffer;
    fileName: string;
    mimeType: string;
  }>;
}) {
  const count = input.input.generationType === "image_to_image" ? 1 : input.input.count;
  const responses = await Promise.all(
    Array.from({ length: count }, async (): Promise<ResponsesImageGenerationOutput> =>
      await collectResponsesImageGenerationStream(await input.client.responses.create({
        input: buildResponsesInput(input.input.prompt, input.sourceImages),
        model: input.model,
        stream: true,
        tool_choice: { type: "image_generation" },
        tools: [
          {
            action: input.sourceImages.length > 0 ? "edit" : "generate",
            ...(input.input.moderation && input.input.moderation !== "auto"
              ? { moderation: input.input.moderation }
              : {}),
            ...input.outputOptions,
            size: input.compatibleSize,
            type: "image_generation",
          },
        ],
      } as Parameters<OpenAI["responses"]["create"]>[0])),
    ),
  );

  return {
    data: responses.flatMap((response) =>
      (response.output ?? [])
        .filter((output) => output.type === "image_generation_call")
        .map((output) => ({
          b64_json: output.result,
        }))
        .filter((item): item is { b64_json: string } => Boolean(item.b64_json)),
    ),
  };
}

async function collectResponsesImageGenerationStream(
  payload: unknown,
): Promise<ResponsesImageGenerationOutput> {
  if (!isAsyncIterable(payload)) {
    return payload as ResponsesImageGenerationOutput;
  }

  const streamedOutput: NonNullable<ResponsesImageGenerationOutput["output"]> = [];
  let completedResponse: ResponsesImageGenerationOutput | null = null;

  for await (const event of payload) {
    if (!isRecord(event)) continue;
    const streamEvent = event as ResponsesStreamEvent;

    if (streamEvent.type === "response.completed" && isRecord(streamEvent.response)) {
      completedResponse = streamEvent.response as ResponsesImageGenerationOutput;
      continue;
    }

    if (streamEvent.type === "response.output_item.done" && isRecord(streamEvent.item)) {
      streamedOutput.push(streamEvent.item);
    }
  }

  const completedOutput = completedResponse?.output ?? [];
  return {
    output: completedOutput.length > 0 ? completedOutput : streamedOutput,
  };
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return Boolean(value) &&
    typeof value === "object" &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildResponsesInput(
  prompt: string,
  sourceImages: Array<{
    data: Buffer;
    mimeType: string;
  }>,
) {
  if (sourceImages.length === 0) {
    return prompt;
  }

  return [
    {
      content: [
        {
          text: prompt,
          type: "input_text",
        },
        ...sourceImages.map((sourceImage) => ({
          image_url: `data:${sourceImage.mimeType || "image/png"};base64,${sourceImage.data.toString("base64")}`,
          type: "input_image",
        })),
      ],
      role: "user",
    },
  ];
}

function toRecord(
  url: string,
  dimensions: ImageDimensions | null,
): GeneratedImageRecord {
  if (!dimensions) {
    return { actualHeight: null, actualSize: null, actualWidth: null, url };
  }

  return {
    actualHeight: dimensions.height,
    actualSize: formatDimensions(dimensions),
    actualWidth: dimensions.width,
    url,
  };
}

// 多家代理对实际生效尺寸的回传字段并不统一，这里把已知的几种形态都捞一下。
function extractDimensionsFromMetadata(
  item: unknown,
  payload: unknown,
): ImageDimensions | null {
  return (
    pickDimensionsFromObject(item) ?? pickDimensionsFromObject(payload) ?? null
  );
}

function pickDimensionsFromObject(value: unknown): ImageDimensions | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;

  const sizeField = record.size;
  if (typeof sizeField === "string") {
    const parsed = parseSizeString(sizeField);
    if (parsed) return parsed;
  }

  const widthCandidate =
    pickFiniteNumber(record.width) ??
    pickFiniteNumber(record.actual_width) ??
    pickFiniteNumber((record as { actualWidth?: unknown }).actualWidth);
  const heightCandidate =
    pickFiniteNumber(record.height) ??
    pickFiniteNumber(record.actual_height) ??
    pickFiniteNumber((record as { actualHeight?: unknown }).actualHeight);

  if (widthCandidate && heightCandidate) {
    return { height: heightCandidate, width: widthCandidate };
  }

  return null;
}

function pickFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}

function parseSizeString(value: string): ImageDimensions | null {
  const match = value.trim().match(/^(\d+)\s*[xX×]\s*(\d+)$/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { height, width };
}

// URL 模式下 b64 不在手里，需要拉一小段头部嗅探尺寸。
// 受 PROBE_TIMEOUT_MS 与 PROBE_MAX_BYTES 限制，失败时静默返回 null，不阻塞主流程。
const PROBE_TIMEOUT_MS = 5_000;
const PROBE_MAX_BYTES = 64 * 1024;

async function fetchAndProbeDimensions(url: string): Promise<ImageDimensions | null> {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        cache: "no-store",
        headers: { Range: `bytes=0-${PROBE_MAX_BYTES - 1}` },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok && response.status !== 206) return null;

    const arrayBuffer = await response.arrayBuffer();
    return readImageDimensions(Buffer.from(arrayBuffer));
  } catch {
    return null;
  }
}
