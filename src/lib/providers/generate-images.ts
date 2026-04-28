import "server-only";

import OpenAI, { toFile } from "openai";

import { persistGeneratedImage } from "@/lib/storage/persist-generated-image";
import { getBuiltInProviderConfig } from "@/lib/providers/built-in-provider";
import { resolveGenerationProvider } from "@/lib/providers/resolve-provider";
import type {
  GenerationModeration,
  GenerationOutputFormat,
  GenerationQuality,
  GenerationSizeToken,
  GenerationType,
  ProviderMode,
} from "@/lib/types";

type CustomProviderConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

type GenerateImagesInput = {
  count: number;
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

export async function generateImages(input: GenerateImagesInput) {
  const builtInConfig = await getBuiltInProviderConfig();
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

  const result = input.generationType === "image_to_image"
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
        model: input.model || provider.model,
        n: 1,
        ...outputOptions,
        prompt: input.prompt,
        size: compatibleSize,
      })
    : await client.images.generate({
        ...(input.moderation && input.moderation !== "auto"
          ? { moderation: input.moderation }
          : {}),
        model: input.model || provider.model,
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

  const items = result.data ?? [];

  if (items.length === 0) {
    throw new Error("渠道没有返回图片结果");
  }

  return Promise.all(
    items.map(async (item) => {
      if (item.url) {
        return persistGeneratedImage({
          url: item.url,
          userId: input.userId,
        });
      }

      if (item.b64_json) {
        return persistGeneratedImage({
          b64Json: item.b64_json,
          userId: input.userId,
        });
      }

      throw new Error("返回结果里没有可用图片");
    }),
  );
}
