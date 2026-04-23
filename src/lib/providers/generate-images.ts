import "server-only";

import OpenAI, { toFile } from "openai";

import { persistGeneratedImage } from "@/lib/storage/persist-generated-image";
import { getBuiltInProviderConfig } from "@/lib/providers/built-in-provider";
import { resolveGenerationProvider } from "@/lib/providers/resolve-provider";
import type { GenerationType, ProviderMode } from "@/lib/types";

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
  prompt: string;
  providerMode: ProviderMode;
  seed?: number | null;
  size: string;
  sourceImage?: {
    data: Buffer;
    fileName: string;
    mimeType: string;
  } | null;
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

  if (input.generationType === "image_to_image" && !input.sourceImage) {
    throw new Error("请先上传参考图");
  }

  const generateSize =
    input.size === "1024x1536" || input.size === "1536x1024"
      ? input.size
      : "1024x1024";

  const result = input.generationType === "image_to_image"
    ? await client.images.edit({
        image: await toFile(
          input.sourceImage?.data ?? Buffer.alloc(0),
          input.sourceImage?.fileName ?? "source.png",
          {
            type: input.sourceImage?.mimeType ?? "image/png",
          },
        ),
        model: input.model || provider.model,
        n: 1,
        prompt: input.prompt,
      })
    : await client.images.generate({
        model: input.model || provider.model,
        n: input.count,
        prompt: input.prompt,
        size: generateSize,
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
