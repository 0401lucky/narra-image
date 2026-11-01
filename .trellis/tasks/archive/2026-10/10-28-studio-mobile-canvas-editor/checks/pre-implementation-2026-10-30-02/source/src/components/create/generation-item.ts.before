import type { GenerationItem } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isIdentity(value: unknown): value is string {
  return isString(value) && value.trim().length > 0;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isTimestamp(value: unknown): value is string {
  return isString(value) && Number.isFinite(Date.parse(value));
}

function optional(value: unknown, check: (value: unknown) => boolean, nullable = false): boolean {
  return value === undefined || (nullable && value === null) || check(value);
}

function isImage(value: unknown): boolean {
  return isRecord(value) && isIdentity(value.id) && isIdentity(value.url)
    && optional(value.actualSize, isString, true)
    && optional(value.actualWidth, isNumber, true)
    && optional(value.actualHeight, isNumber, true);
}

function isVideo(value: unknown): boolean {
  return isRecord(value) && isIdentity(value.id) && isIdentity(value.url)
    && optional(value.posterUrl, isString, true)
    && optional(value.width, isNumber, true)
    && optional(value.height, isNumber, true)
    && optional(value.durationSeconds, isNumber, true);
}

// Check the UI DTO, not execution limits; legacy optional media metadata stays optional.
export function isGenerationItem(value: unknown): value is GenerationItem {
  if (!isRecord(value)) return false;
  return isIdentity(value.id) && isTimestamp(value.createdAt)
    && optional(value.updatedAt, isTimestamp)
    && optional(value.startedAt, isTimestamp, true)
    && optional(value.completedAt, isTimestamp, true)
    && optional(value.conversationId, isIdentity, true)
    && isString(value.status) && ["pending", "succeeded", "failed"].includes(value.status)
    && isString(value.providerMode) && ["built_in", "custom"].includes(value.providerMode)
    && isString(value.generationType) && ["text_to_image", "image_to_image", "text_to_video", "image_to_video"].includes(value.generationType)
    && isNumber(value.count) && Number.isInteger(value.count) && value.count > 0
    && isNumber(value.creditsSpent)
    && isString(value.prompt) && isString(value.model) && isString(value.size)
    && Array.isArray(value.images) && value.images.every(isImage)
    && optional(value.videos, (videos) => Array.isArray(videos) && videos.every(isVideo))
    && optional(value.quality, isString)
    && optional(value.moderation, isString)
    && optional(value.outputFormat, isString)
    && optional(value.outputCompression, isNumber, true)
    && optional(value.negativePrompt, isString, true)
    && optional(value.errorMessage, isString, true)
    && optional(value.aspectRatio, isString, true)
    && optional(value.durationMs, isNumber, true)
    && optional(value.durationSeconds, isNumber, true)
    && optional(value.providerChannelId, isIdentity, true)
    && optional(value.sourceImageUrl, isString, true)
    && optional(value.sourceImageUrls, (urls) => Array.isArray(urls) && urls.every(isString));
}
