import { fetchPublicHttpUrl } from "@/lib/server/safe-remote-url";

const MODEL_FETCH_TIMEOUT_MS = 15_000;
const MODEL_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;

async function readResponseTextWithLimit(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      return text + decoder.decode();
    }

    byteLength += value.byteLength;
    if (byteLength > MODEL_RESPONSE_MAX_BYTES) {
      await reader.cancel();
      throw new Error("模型列表响应过大");
    }
    text += decoder.decode(value, { stream: true });
  }
}

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
  return /(?:^|\/)gpt-5(?:[.\-_]|$)/.test(id);
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
  const modelUrl = new URL(input.baseUrl);
  modelUrl.search = "";
  modelUrl.hash = "";
  modelUrl.pathname = `${modelUrl.pathname.replace(/\/+$/, "")}/models`;
  const response = await fetchPublicHttpUrl(modelUrl.href, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${input.apiKey}`,
    },
    signal: AbortSignal.timeout(MODEL_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`模型接口返回 HTTP ${response.status}`);
  }

  const contentLength = Number(response.headers.get("content-length") || "0");
  if (contentLength > MODEL_RESPONSE_MAX_BYTES) {
    throw new Error("模型列表响应过大");
  }

  if (!response.body) {
    throw new Error("模型接口响应为空");
  }
  const responseText = await readResponseTextWithLimit(response.body);

  let result: unknown;
  try {
    result = JSON.parse(responseText);
  } catch {
    throw new Error("模型接口未返回合法 JSON");
  }

  const data = typeof result === "object" && result !== null && "data" in result
    ? (result as { data?: unknown }).data
    : null;
  if (!Array.isArray(data)) {
    throw new Error("模型接口响应格式不正确");
  }

  const ids = data
    .map((item) => (
      typeof item === "object" && item !== null && "id" in item
        ? (item as { id?: unknown }).id
        : null
    ))
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  return prioritizeModelIds(ids);
}
