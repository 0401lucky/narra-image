export const workShowcaseStatuses = [
  "PRIVATE",
  "PENDING",
  "FEATURED",
  "TAKEDOWN_PENDING",
] as const;

export type WorkShowcaseStatus = (typeof workShowcaseStatuses)[number];

export const userWorkShowcaseActions = [
  "submit",
  "withdraw",
  "request_unfeature",
] as const;

export type UserWorkShowcaseAction = (typeof userWorkShowcaseActions)[number];

export const adminWorkReviewActions = [
  "approve_feature",
  "reject_feature",
  "approve_unfeature",
  "reject_unfeature",
] as const;

export type AdminWorkReviewAction = (typeof adminWorkReviewActions)[number];

export const workShowcaseStatusLabels: Record<WorkShowcaseStatus, string> = {
  PRIVATE: "私有",
  PENDING: "待审核",
  FEATURED: "已公开",
  TAKEDOWN_PENDING: "待下架审核",
};

type MutableWorkFields = {
  featuredAt?: Date | null;
  reviewNote?: string | null;
  reviewedAt?: Date | null;
  reviewedById?: string | null;
  showcaseStatus: WorkShowcaseStatus;
  showPromptPublic?: boolean;
  submittedAt?: Date | null;
};

function normalizeReviewNote(reviewNote?: string | null) {
  const value = reviewNote?.trim();
  return value ? value : null;
}

function assertUserActionAllowed(
  action: UserWorkShowcaseAction,
  currentStatus: WorkShowcaseStatus,
) {
  const allowed =
    (action === "submit" && currentStatus === "PRIVATE") ||
    (action === "withdraw" && currentStatus === "PENDING") ||
    (action === "request_unfeature" && currentStatus === "FEATURED");

  if (!allowed) {
    throw new Error("当前状态不允许执行该操作");
  }
}

function assertAdminActionAllowed(
  action: AdminWorkReviewAction,
  currentStatus: WorkShowcaseStatus,
) {
  const allowed =
    ((action === "approve_feature" || action === "reject_feature") &&
      currentStatus === "PENDING") ||
    ((action === "approve_unfeature" || action === "reject_unfeature") &&
      currentStatus === "TAKEDOWN_PENDING");

  if (!allowed) {
    throw new Error("当前状态不允许执行该审核操作");
  }
}

export function applyUserShowcaseAction(input: {
  action: UserWorkShowcaseAction;
  currentStatus: WorkShowcaseStatus;
  now?: Date;
  showPromptPublic?: boolean;
}): MutableWorkFields {
  const { action, currentStatus, now = new Date(), showPromptPublic } = input;
  assertUserActionAllowed(action, currentStatus);

  if (action === "submit") {
    return {
      featuredAt: null,
      reviewNote: null,
      reviewedAt: null,
      reviewedById: null,
      showcaseStatus: "PENDING",
      showPromptPublic: Boolean(showPromptPublic),
      submittedAt: now,
    };
  }

  if (action === "withdraw") {
    return {
      reviewNote: null,
      reviewedAt: null,
      reviewedById: null,
      showcaseStatus: "PRIVATE",
      submittedAt: null,
    };
  }

  return {
    showcaseStatus: "TAKEDOWN_PENDING",
  };
}

export function applyAdminWorkReview(input: {
  action: AdminWorkReviewAction;
  currentFeaturedAt?: Date | null;
  currentStatus: WorkShowcaseStatus;
  now?: Date;
  reviewNote?: string | null;
  reviewerId: string;
}): MutableWorkFields {
  const {
    action,
    currentFeaturedAt = null,
    currentStatus,
    now = new Date(),
    reviewNote,
    reviewerId,
  } = input;

  assertAdminActionAllowed(action, currentStatus);

  if (action === "approve_feature") {
    return {
      featuredAt: now,
      reviewNote: normalizeReviewNote(reviewNote),
      reviewedAt: now,
      reviewedById: reviewerId,
      showcaseStatus: "FEATURED",
    };
  }

  if (action === "reject_feature") {
    return {
      featuredAt: null,
      reviewNote: normalizeReviewNote(reviewNote),
      reviewedAt: now,
      reviewedById: reviewerId,
      showcaseStatus: "PRIVATE",
    };
  }

  if (action === "approve_unfeature") {
    return {
      featuredAt: null,
      reviewNote: normalizeReviewNote(reviewNote),
      reviewedAt: now,
      reviewedById: reviewerId,
      showcaseStatus: "PRIVATE",
      submittedAt: null,
    };
  }

  return {
    featuredAt: currentFeaturedAt,
    reviewNote: normalizeReviewNote(reviewNote),
    reviewedAt: now,
    reviewedById: reviewerId,
    showcaseStatus: "FEATURED",
  };
}

export function canViewWorkDetail(input: {
  isOwner: boolean;
  showcaseStatus: WorkShowcaseStatus;
}) {
  return input.isOwner || input.showcaseStatus === "FEATURED";
}

export function canShowWorkPrompt(input: {
  isOwner: boolean;
  showcaseStatus: WorkShowcaseStatus;
  showPromptPublic: boolean;
}) {
  if (input.isOwner) {
    return true;
  }

  return input.showcaseStatus === "FEATURED" && input.showPromptPublic;
}

export function isFeaturedWork(showcaseStatus: WorkShowcaseStatus) {
  return showcaseStatus === "FEATURED";
}

export function getWorkShowcaseStatusLabel(showcaseStatus: WorkShowcaseStatus) {
  return workShowcaseStatusLabels[showcaseStatus];
}
