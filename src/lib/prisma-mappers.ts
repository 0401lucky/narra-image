import {
  GenerationStatus,
  GenerationType,
  ProviderMode,
  Role,
  ShowcaseStatus,
  type Conversation,
  type GeneratedVideo,
  type GenerationImage,
  type GenerationJob,
  type User,
} from "@prisma/client";

import type { ProviderMode as UiProviderMode, UserRole } from "@/lib/types";
import type { GenerationType as UiGenerationType } from "@/lib/types";
import type { WorkShowcaseStatus } from "@/lib/work-showcase";

export type SerializedGeneration = {
  completedAt: string | null;
  conversationId: string | null;
  count: number;
  createdAt: string;
  creditsSpent: number;
  durationMs: number | null;
  errorMessage: string | null;
  featuredAt: string | null;
  generationType: "text_to_image" | "image_to_image" | "text_to_video" | "image_to_video";
  id: string;
  aspectRatio: string | null;
  durationSeconds: number | null;
  images: Array<{
    actualHeight: number | null;
    actualSize: string | null;
    actualWidth: number | null;
    id: string;
    url: string;
  }>;
  videos: Array<{
    durationSeconds: number | null;
    height: number | null;
    id: string;
    posterUrl: string | null;
    url: string;
    width: number | null;
  }>;
  model: string;
  moderation: string;
  negativePrompt: string | null;
  outputCompression: number | null;
  outputFormat: string;
  prompt: string;
  providerMode: UiProviderMode;
  quality: string;
  size: string;
  sourceImageUrl: string | null;
  sourceImageUrls: string[];
  startedAt: string | null;
  status: "pending" | "succeeded" | "failed";
  updatedAt: string;
};

export type SerializedConversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  generationIds: string[];
};

export function serializeConversation(
  conversation: Conversation & { generations?: Array<Pick<GenerationJob, "id">> },
): SerializedConversation {
  return {
    createdAt: conversation.createdAt.toISOString(),
    generationIds: conversation.generations?.map((g) => g.id) ?? [],
    id: conversation.id,
    title: conversation.title,
    updatedAt: conversation.updatedAt.toISOString(),
  };
}

type WorkAuthorFields = Pick<User, "avatarUrl" | "id" | "nickname">;

type WorkJobFields = Pick<
  GenerationJob,
  "createdAt" | "id" | "model" | "negativePrompt" | "prompt" | "size" | "status" | "userId"
>;

type WorkReviewerFields = Pick<User, "email" | "id">;

export type WorkRecord = GenerationImage & {
  job: WorkJobFields & {
    user?: { nickname: string | null } | null;
  };
  reviewedBy?: WorkReviewerFields | null;
};

export type AdminWorkRecord = GenerationImage & {
  job: WorkJobFields & {
    user: WorkReviewerFields & { nickname: string | null };
  };
  reviewedBy?: WorkReviewerFields | null;
};

export type SerializedWork = {
  authorNickname: string | null;
  createdAt: string;
  featuredAt: string | null;
  generationCreatedAt: string;
  generationStatus: "failed" | "pending" | "succeeded";
  id: string;
  jobId: string;
  model: string;
  negativePrompt: string | null;
  ownerId: string;
  prompt: string;
  reviewNote: string | null;
  reviewedAt: string | null;
  reviewedById: string | null;
  reviewer: {
    email: string;
    id: string;
  } | null;
  showcaseStatus: WorkShowcaseStatus;
  showPromptPublic: boolean;
  size: string;
  submittedAt: string | null;
  url: string;
};

export type SerializedAdminWork = SerializedWork & {
  author: {
    email: string;
    id: string;
  };
};

export type SerializedFeaturedWork = {
  authorAvatar: string | null;
  authorName: string;
  featuredAt: string | null;
  id: string;
  image: string;
  likeCount: number;
  likedByMe: boolean;
  prompt: string;
  // 形如 "1024x1536"。让前端在图片解码前就能用真实长宽比预留容器高度，
  // 避免 CSS columns 瀑布流在滚动期因图片陆续到达而重排跳列。
  size: string;
  title: string;
};

export function toPrismaProviderMode(providerMode: UiProviderMode) {
  return providerMode === "built_in"
    ? ProviderMode.BUILT_IN
    : ProviderMode.CUSTOM;
}

export function toPrismaGenerationType(generationType: UiGenerationType) {
  switch (generationType) {
    case "image_to_image":
      return GenerationType.IMAGE_TO_IMAGE;
    case "text_to_video":
      return GenerationType.TEXT_TO_VIDEO;
    case "image_to_video":
      return GenerationType.IMAGE_TO_VIDEO;
    default:
      return GenerationType.TEXT_TO_IMAGE;
  }
}

export function fromPrismaProviderMode(providerMode: ProviderMode): UiProviderMode {
  return providerMode === ProviderMode.BUILT_IN ? "built_in" : "custom";
}

export function fromPrismaGenerationType(generationType: GenerationType): UiGenerationType {
  switch (generationType) {
    case GenerationType.IMAGE_TO_IMAGE:
      return "image_to_image";
    case GenerationType.TEXT_TO_VIDEO:
      return "text_to_video";
    case GenerationType.IMAGE_TO_VIDEO:
      return "image_to_video";
    default:
      return "text_to_image";
  }
}

export function fromPrismaRole(role: Role): UserRole {
  return role === Role.ADMIN ? "admin" : "user";
}

export function fromPrismaShowcaseStatus(status: ShowcaseStatus): WorkShowcaseStatus {
  return status;
}

export function serializeUser(user: Pick<User, "id" | "email" | "role" | "credits" | "nickname" | "avatarUrl">) {
  return {
    avatarUrl: user.avatarUrl,
    credits: user.credits,
    email: user.email,
    id: user.id,
    nickname: user.nickname,
    role: fromPrismaRole(user.role),
  };
}

export function serializeWork(work: WorkRecord): SerializedWork {
  return {
    authorNickname: work.job.user?.nickname ?? null,
    createdAt: work.createdAt.toISOString(),
    featuredAt: work.featuredAt?.toISOString() ?? null,
    generationCreatedAt: work.job.createdAt.toISOString(),
    generationStatus:
      work.job.status === GenerationStatus.SUCCEEDED
        ? "succeeded"
        : work.job.status === GenerationStatus.FAILED
          ? "failed"
          : "pending",
    id: work.id,
    jobId: work.jobId,
    model: work.job.model,
    negativePrompt: work.job.negativePrompt,
    ownerId: work.job.userId,
    prompt: work.job.prompt,
    reviewNote: work.reviewNote,
    reviewedAt: work.reviewedAt?.toISOString() ?? null,
    reviewedById: work.reviewedById,
    reviewer: work.reviewedBy
      ? {
          email: work.reviewedBy.email,
          id: work.reviewedBy.id,
        }
      : null,
    showcaseStatus: fromPrismaShowcaseStatus(work.showcaseStatus),
    showPromptPublic: work.showPromptPublic,
    size: work.job.size,
    submittedAt: work.submittedAt?.toISOString() ?? null,
    url: work.url,
  };
}

export function serializeAdminWork(work: AdminWorkRecord): SerializedAdminWork {
  return {
    ...serializeWork(work),
    author: {
      email: work.job.user.email,
      id: work.job.user.id,
    },
  };
}

export type FeaturedWorkRecord = WorkRecord & {
  job: WorkJobFields & {
    user: WorkAuthorFields;
  };
  _count?: {
    likes: number;
  };
  likes?: Array<{
    userId: string;
  }>;
};

export function serializeFeaturedWork(work: FeaturedWorkRecord): SerializedFeaturedWork {
  const author = work.job.user;
  return {
    authorAvatar: author.avatarUrl,
    authorName: author.nickname || "匿名创作者",
    featuredAt: work.featuredAt?.toISOString() ?? null,
    id: work.id,
    image: work.url,
    likeCount: work._count?.likes ?? 0,
    likedByMe: Boolean(work.likes?.length),
    prompt: work.showPromptPublic ? work.job.prompt : "作者未公开提示词",
    size: work.job.size,
    title: work.job.model,
  };
}

export function serializeGeneration(
  job: GenerationJob & { images: GenerationImage[]; videos?: GeneratedVideo[] },
): SerializedGeneration {
  const generationType = fromPrismaGenerationType(
    "generationType" in job && job.generationType
      ? (job.generationType as GenerationType)
      : GenerationType.TEXT_TO_IMAGE,
  );
  const sourceImageUrl =
    "sourceImageUrl" in job && typeof job.sourceImageUrl === "string"
      ? job.sourceImageUrl
      : null;
  const sourceImageUrls =
    "sourceImageUrls" in job && Array.isArray(job.sourceImageUrls)
      ? job.sourceImageUrls.filter((url): url is string => typeof url === "string")
      : sourceImageUrl
        ? [sourceImageUrl]
        : [];
  const startedAt =
    "startedAt" in job && job.startedAt instanceof Date
      ? job.startedAt
      : null;
  const completedAt =
    "completedAt" in job && job.completedAt instanceof Date
      ? job.completedAt
      : null;
  const durationMs = completedAt
    ? Math.max(0, completedAt.getTime() - job.createdAt.getTime())
    : null;

  return {
    completedAt: completedAt?.toISOString() ?? null,
    conversationId:
      "conversationId" in job && typeof job.conversationId === "string"
        ? job.conversationId
        : null,
    count: job.count,
    createdAt: job.createdAt.toISOString(),
    creditsSpent: job.creditsSpent,
    durationMs,
    errorMessage: job.errorMessage,
    featuredAt: job.featuredAt?.toISOString() ?? null,
    generationType,
    aspectRatio:
      "aspectRatio" in job && typeof job.aspectRatio === "string" ? job.aspectRatio : null,
    durationSeconds:
      "durationSeconds" in job && typeof job.durationSeconds === "number"
        ? job.durationSeconds
        : null,
    id: job.id,
    images: job.images.map((image) => {
      const width = "width" in image && typeof image.width === "number" ? image.width : null;
      const height = "height" in image && typeof image.height === "number" ? image.height : null;
      const actualSize = width && height ? `${width}x${height}` : null;
      return {
        actualHeight: height,
        actualSize,
        actualWidth: width,
        id: image.id,
        url: image.url,
      };
    }),
    videos:
      "videos" in job && Array.isArray(job.videos)
        ? job.videos.map((video) => ({
            durationSeconds:
              typeof video.durationSeconds === "number" ? video.durationSeconds : null,
            height: typeof video.height === "number" ? video.height : null,
            id: video.id,
            posterUrl: typeof video.posterUrl === "string" ? video.posterUrl : null,
            url: video.url,
            width: typeof video.width === "number" ? video.width : null,
          }))
        : [],
    model: job.model,
    moderation:
      "moderation" in job && typeof job.moderation === "string"
        ? job.moderation
        : "auto",
    negativePrompt: job.negativePrompt,
    outputCompression:
      "outputCompression" in job && typeof job.outputCompression === "number"
        ? job.outputCompression
        : null,
    outputFormat:
      "outputFormat" in job && typeof job.outputFormat === "string"
        ? job.outputFormat
        : "png",
    prompt: job.prompt,
    providerMode: fromPrismaProviderMode(job.providerMode),
    quality:
      "quality" in job && typeof job.quality === "string"
        ? job.quality
        : "auto",
    size: job.size,
    sourceImageUrl: sourceImageUrls[0] ?? null,
    sourceImageUrls,
    startedAt: startedAt?.toISOString() ?? null,
    status:
      job.status === GenerationStatus.SUCCEEDED
        ? "succeeded"
        : job.status === GenerationStatus.FAILED
          ? "failed"
          : "pending",
    updatedAt: job.updatedAt.toISOString(),
  };
}
