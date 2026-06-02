// 创作台共享类型：从 generator-studio 拆出，方便子组件与 hooks 共用。
import type {
  GenerationModeration,
  GenerationOutputFormat,
  GenerationQuality,
  GenerationSizeToken,
  GenerationType,
  ProviderMode,
} from "@/lib/types";

export type ViewerUser = {
  credits: number;
  role: "user" | "admin";
} | null;

export type GenerationImage = {
  actualHeight?: number | null;
  actualSize?: string | null;
  actualWidth?: number | null;
  id: string;
  url: string;
};

export type GenerationVideo = {
  id: string;
  url: string;
  posterUrl?: string | null;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
};

export type GenerationItem = {
  completedAt?: string | null;
  conversationId?: string | null;
  count: number;
  createdAt: string;
  creditsSpent: number;
  durationMs?: number | null;
  errorMessage?: string | null;
  generationType: GenerationType;
  id: string;
  images: GenerationImage[];
  videos?: GenerationVideo[];
  aspectRatio?: string | null;
  durationSeconds?: number | null;
  model: string;
  moderation?: string;
  negativePrompt?: string | null;
  outputCompression?: number | null;
  outputFormat?: string;
  prompt: string;
  providerChannelId?: string | null;
  providerMode: "built_in" | "custom";
  quality?: string;
  size: string;
  sourceImageUrl?: string | null;
  sourceImageUrls?: string[];
  startedAt?: string | null;
  status: "pending" | "succeeded" | "failed";
};

export type ChannelInfo = {
  creditCost: number;
  defaultModel: string;
  id: string;
  models: string[];
  name: string;
};

export type SavedProviderInfo = {
  baseUrl: string;
  id: string;
  label: string | null;
  model: string;
  models: string[];
  updatedAt: string;
};

export type CustomProviderDraft = {
  apiKey: string;
  baseUrl: string;
  label: string;
  model: string;
  models: string[];
  remember: boolean;
};

export type ProviderSelectionMode = ProviderMode;

export type ReferenceImage = {
  id: string;
  file: File | null;
  previewUrl: string;
  sourceUrl?: string;
};

export type ReusableGenerationConfig = {
  channelId?: string | null;
  count: number;
  generationType: GenerationType;
  model: string;
  moderation: GenerationModeration;
  negativePrompt: string;
  outputCompression: number;
  outputFormat: GenerationOutputFormat;
  prompt: string;
  quality: GenerationQuality;
  size: GenerationSizeToken;
  sourceImageUrls: string[];
};

export type SessionInfo = {
  id: string;
  title: string;
  generationIds: string[];
  createdAt: string;
};

export type SizeOption = {
  detail?: string;
  label: string;
  value: GenerationSizeToken | "custom";
};

export type GenerationFormState = {
  size: GenerationSizeToken;
  quality: GenerationQuality;
  outputFormat: GenerationOutputFormat;
};
