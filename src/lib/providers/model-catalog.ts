import OpenAI from "openai";

const IMAGE_HINTS = [
  "image",
  "imagen",
  "dall-e",
  "flux",
  "stable-diffusion",
  "sdxl",
  "midjourney",
  "visual",
  "vision-image",
  "grok",
];

const PRIORITY_HINTS = ["image", "imagen", "dall-e", "grok"];

export function supportsResponsesImageGeneration(modelId: string) {
  const id = modelId.toLowerCase();
  return /^gpt-5(?:[.\-_]|$)/.test(id);
}

export function looksLikeImageModel(modelId: string) {
  const id = modelId.toLowerCase();
  return supportsResponsesImageGeneration(id) ||
    IMAGE_HINTS.some((hint) => id.includes(hint));
}

function getPriorityScore(modelId: string) {
  const id = modelId.toLowerCase();

  if (PRIORITY_HINTS.some((hint) => id.includes(hint))) {
    return 0;
  }

  return looksLikeImageModel(id) ? 1 : 2;
}

export function prioritizeModelIds(modelIds: string[]) {
  return [...new Set(modelIds)].sort((left, right) => {
    const scoreDiff = getPriorityScore(left) - getPriorityScore(right);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }

    return left.localeCompare(right);
  });
}

export async function fetchOpenAICompatibleModelIds(input: {
  apiKey: string;
  baseUrl: string;
}) {
  const client = new OpenAI({
    apiKey: input.apiKey,
    baseURL: input.baseUrl,
  });

  const result = await client.models.list();
  const ids = result.data?.map((item) => item.id).filter(Boolean) ?? [];

  return prioritizeModelIds(ids);
}
