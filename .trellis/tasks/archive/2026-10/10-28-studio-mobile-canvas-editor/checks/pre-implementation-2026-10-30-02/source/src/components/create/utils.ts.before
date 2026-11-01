// 创作台纯函数集合。原本在 generator-studio.tsx 内嵌，拆出方便测试与复用。
import {
  getGenerationSizeLabel,
  normalizeGenerationSize,
} from "@/lib/generation/sizes";
import { SIZE_DOWNGRADE_TOLERANCE, SIZE_OPTIONS } from "./constants";
import type {
  GenerationImage,
  GenerationItem,
  ReusableGenerationConfig,
} from "./types";
import type {
  GenerationModeration,
  GenerationOutputFormat,
  GenerationQuality,
  GenerationSizeToken,
} from "@/lib/types";

export function getSizeSelectValue(size: string) {
  const normalized = normalizeGenerationSize(size);
  if (!normalized) return "custom";
  return SIZE_OPTIONS.some((option) => option.value === normalized)
    ? normalized
    : "custom";
}

export function getSizeLabel(size: string) {
  const normalized = normalizeGenerationSize(size);
  const option = SIZE_OPTIONS.find((item) => item.value === normalized);
  return option && option.value !== "custom"
    ? `${option.label}${option.detail ? ` ${option.detail}` : ""}`
    : getGenerationSizeLabel(size);
}

export function getGenerationOptionSummary(generation: GenerationItem) {
  const quality = generation.quality && generation.quality !== "auto"
    ? `质量 ${generation.quality}`
    : "质量自动";
  const format = (generation.outputFormat ?? "png").toUpperCase();

  return `${generation.model} • ${getSizeLabel(generation.size)} • ${quality} • ${format}`;
}

// 把请求 size 归一化为 "WxH"；auto / 非法值返回 null。
export function parseSizePixels(size: string | null | undefined): { width: number; height: number } | null {
  if (!size) return null;
  const match = size.trim().match(/^(\d+)\s*[xX×]\s*(\d+)$/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { height, width };
}

// 实际尺寸与请求尺寸像素数差异 > SIZE_DOWNGRADE_TOLERANCE 视为渠道降级/缩水。
// 容差用来吸收 16 倍数对齐这类合法的细微规整。
export function describeSizeDowngrade(generation: GenerationItem, image: GenerationImage) {
  if (!image.actualSize) return null;
  if (!generation.size || generation.size.toLowerCase() === "auto") return null;

  const requested = parseSizePixels(generation.size);
  const actual = parseSizePixels(image.actualSize);
  if (!requested || !actual) return null;

  const requestedPixels = requested.width * requested.height;
  const actualPixels = actual.width * actual.height;
  if (requestedPixels === 0) return null;

  const delta = Math.abs(requestedPixels - actualPixels) / requestedPixels;
  if (delta <= SIZE_DOWNGRADE_TOLERANCE) return null;

  return {
    actual: image.actualSize,
    requested: generation.size,
    shrunk: actualPixels < requestedPixels,
  };
}

export function getGenerationSourceImageUrls(generation: GenerationItem) {
  return generation.sourceImageUrls?.length
    ? generation.sourceImageUrls
    : generation.sourceImageUrl
      ? [generation.sourceImageUrl]
      : [];
}

export function getImageDimensionLabel(generation: GenerationItem, image: GenerationImage) {
  const actual = image.actualSize ?? (
    typeof image.actualWidth === "number" && typeof image.actualHeight === "number"
      ? `${image.actualWidth}x${image.actualHeight}`
      : null
  );
  const requested = generation.size && generation.size.toLowerCase() !== "auto"
    ? generation.size
    : null;

  return actual ?? requested ?? "尺寸待确认";
}

export function getImageRatioLabel(generation: GenerationItem, image: GenerationImage) {
  const pixels = parseSizePixels(getImageDimensionLabel(generation, image));
  if (!pixels) return "比例待确认";

  function gcd(a: number, b: number): number {
    return b === 0 ? a : gcd(b, a % b);
  }

  const divisor = gcd(pixels.width, pixels.height);
  return `${pixels.width / divisor}:${pixels.height / divisor}`;
}

function isGenerationQuality(value: unknown): value is GenerationQuality {
  return value === "auto" || value === "low" || value === "medium" || value === "high";
}

function isGenerationOutputFormat(value: unknown): value is GenerationOutputFormat {
  return value === "png" || value === "jpeg" || value === "webp";
}

function isGenerationModeration(value: unknown): value is GenerationModeration {
  return value === "auto" || value === "low";
}

export function toReusableGenerationConfig(
  generation: GenerationItem,
  availableChannelIds: string[],
): ReusableGenerationConfig {
  const normalizedSize = normalizeGenerationSize(generation.size) ?? "auto";
  const outputFormat = isGenerationOutputFormat(generation.outputFormat)
    ? generation.outputFormat
    : "png";
  const channelId = generation.providerChannelId && availableChannelIds.includes(generation.providerChannelId)
    ? generation.providerChannelId
    : null;

  return {
    channelId,
    count: Math.min(4, Math.max(1, generation.count || 1)),
    generationType:
      generation.generationType === "image_to_image" || getGenerationSourceImageUrls(generation).length > 0
        ? "image_to_image"
        : "text_to_image",
    model: generation.model,
    moderation: isGenerationModeration(generation.moderation) ? generation.moderation : "auto",
    negativePrompt: generation.negativePrompt ?? "",
    outputCompression:
      typeof generation.outputCompression === "number"
        ? Math.min(100, Math.max(0, generation.outputCompression))
        : 100,
    outputFormat,
    prompt: generation.prompt,
    quality: isGenerationQuality(generation.quality) ? generation.quality : "auto",
    size: normalizedSize as GenerationSizeToken,
    sourceImageUrls: getGenerationSourceImageUrls(generation),
  };
}

export function genSessionId() {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function formatSessionTime(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const time = `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  if (isToday) return `今天 ${time}`;
  return `${(d.getMonth() + 1).toString().padStart(2, "0")}/${d.getDate().toString().padStart(2, "0")} ${time}`;
}
