export type ProviderMode = "built_in" | "custom";
export type GenerationType = "text_to_image" | "image_to_image";
export type {
  GenerationSizeToken,
  SizeTier,
} from "@/lib/generation/sizes";
export { legacyGenerationSizeMap } from "@/lib/generation/sizes";

export type GenerationQuality = "auto" | "low" | "medium" | "high";
export type GenerationOutputFormat = "png" | "jpeg" | "webp";
export type GenerationModeration = "auto" | "low";

export type UserRole = "user" | "admin";
