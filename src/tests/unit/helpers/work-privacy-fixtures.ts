import { GenerationStatus, Role, ShowcaseStatus } from "@prisma/client";

import type { AdminWorkRecord, FeaturedWorkRecord } from "@/lib/prisma-mappers";

export const workPrivacySentinels = {
  authorEmail: "author-private-sentinel@unit.invalid",
  jobId: "private-job-id-sentinel",
  negativePrompt: "PRIVATE_NEGATIVE_PROMPT_SENTINEL\nno lettering, no watermark",
  ownerId: "private-owner-id-sentinel",
  prompt: "PRIVATE_POSITIVE_PROMPT_SENTINEL\nbookshop light & paper + 100% detail",
  reviewNote: "INTERNAL_REVIEW_NOTE_SENTINEL",
  reviewedAt: "2026-10-29T09:32:17.000Z",
  reviewerEmail: "reviewer-private-sentinel@unit.invalid",
  reviewerId: "private-reviewer-id-sentinel",
  submittedAt: "2026-10-29T08:31:16.000Z",
} as const;

export const publicWorkDetailKeys = [
  "authorNickname",
  "createdAt",
  "featuredAt",
  "id",
  "model",
  "negativePrompt",
  "prompt",
  "showcaseStatus",
  "showPromptPublic",
  "size",
  "url",
].sort();

export function createPrivacyWork(
  overrides: Partial<AdminWorkRecord & FeaturedWorkRecord> = {},
): AdminWorkRecord & FeaturedWorkRecord {
  return {
    _count: { likes: 3 },
    createdAt: new Date("2026-10-29T08:00:00.000Z"),
    featuredAt: new Date("2026-10-29T10:00:00.000Z"),
    height: 768,
    id: "work_privacy_fixture",
    job: {
      createdAt: new Date("2026-10-29T07:00:00.000Z"),
      id: workPrivacySentinels.jobId,
      model: "gpt-image-2",
      negativePrompt: workPrivacySentinels.negativePrompt,
      prompt: workPrivacySentinels.prompt,
      size: "1024x768",
      status: GenerationStatus.SUCCEEDED,
      user: {
        avatarUrl: null,
        email: workPrivacySentinels.authorEmail,
        id: workPrivacySentinels.ownerId,
        nickname: "Public author nickname",
      },
      userId: workPrivacySentinels.ownerId,
    },
    jobId: workPrivacySentinels.jobId,
    likes: [],
    mediaStorage: "S3",
    reviewNote: workPrivacySentinels.reviewNote,
    reviewedAt: new Date(workPrivacySentinels.reviewedAt),
    reviewedBy: {
      email: workPrivacySentinels.reviewerEmail,
      id: workPrivacySentinels.reviewerId,
    },
    reviewedById: workPrivacySentinels.reviewerId,
    showcaseStatus: ShowcaseStatus.FEATURED,
    showPromptPublic: false,
    storageKey: "private-storage-key-sentinel",
    submittedAt: new Date(workPrivacySentinels.submittedAt),
    url: "https://media.unit.invalid/full-original-image.png",
    width: 1024,
    ...overrides,
  };
}

export function createPrivacyUser(id: string, role: Role = Role.USER) {
  return {
    avatarUrl: null,
    credits: 500,
    email: `${id}@unit.invalid`,
    id,
    nickname: "Viewer",
    role,
  };
}
