// 创作台共享类型：从 generator-studio 拆出，方便子组件与 hooks 共用。
import type {
  GenerationOutputFormat,
  GenerationQuality,
  GenerationSizeToken,
  GenerationType,
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

export type GenerationItem = {
  conversationId?: string | null;
  count: number;
  createdAt: string;
  creditsSpent: number;
  errorMessage?: string | null;
  generationType: GenerationType;
  id: string;
  images: GenerationImage[];
  model: string;
  moderation?: string;
  negativePrompt?: string | null;
  outputCompression?: number | null;
  outputFormat?: string;
  prompt: string;
  providerMode: "built_in" | "custom";
  quality?: string;
  size: string;
  sourceImageUrl?: string | null;
  sourceImageUrls?: string[];
  status: "pending" | "succeeded" | "failed";
};

export type ChannelInfo = {
  creditCost: number;
  defaultModel: string;
  id: string;
  models: string[];
  name: string;
};

export type ReferenceImage = {
  id: string;
  file: File | null;
  previewUrl: string;
  sourceUrl?: string;
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
