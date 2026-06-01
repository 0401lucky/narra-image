import "server-only";

import { Prisma, ShowcaseStatus } from "@prisma/client";

import { db } from "@/lib/db";
import {
  serializeAdminWork,
  serializeFeaturedVideo,
  serializeFeaturedWork,
  serializeWork,
  type FeaturedVideoRecord,
  type FeaturedWorkRecord,
  type SerializedWork,
} from "@/lib/prisma-mappers";

const FEATURED_WORKS_PAGE_SIZE = 24;
const USER_WORKS_PAGE_SIZE = 24;
const USER_WORKS_MAX_LIMIT = 60;

const workBaseInclude = Prisma.validator<Prisma.GenerationImageInclude>()({
  job: {
    select: {
      createdAt: true,
      id: true,
      model: true,
      negativePrompt: true,
      prompt: true,
      size: true,
      status: true,
      user: {
        select: {
          nickname: true,
        },
      },
      userId: true,
    },
  },
  reviewedBy: {
    select: {
      email: true,
      id: true,
    },
  },
});

const workAdminInclude = Prisma.validator<Prisma.GenerationImageInclude>()({
  job: {
    select: {
      createdAt: true,
      id: true,
      model: true,
      negativePrompt: true,
      prompt: true,
      size: true,
      status: true,
      user: {
        select: {
          email: true,
          id: true,
          nickname: true,
        },
      },
      userId: true,
    },
  },
  reviewedBy: {
    select: {
      email: true,
      id: true,
    },
  },
});

// 用户作品分页：cursor 复合排序 (createdAt desc, id desc) 保证稳定翻页
type UserWorksCursor = {
  createdAt: string;
  id: string;
};

function encodeUserWorksCursor(cursor: UserWorksCursor) {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeUserWorksCursor(cursor?: string | null): UserWorksCursor | null {
  if (!cursor) {
    return null;
  }
  try {
    const decoded = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Partial<UserWorksCursor>;
    if (
      typeof decoded.createdAt !== "string" ||
      typeof decoded.id !== "string"
    ) {
      return null;
    }
    return { createdAt: decoded.createdAt, id: decoded.id };
  } catch {
    return null;
  }
}

type ListUserWorksPageOptions = {
  userId: string;
  cursor?: string | null;
  limit?: number;
};

export type UserWorksPage = {
  hasMore: boolean;
  items: SerializedWork[];
  nextCursor: string | null;
};

export async function listUserWorksPage({
  userId,
  cursor,
  limit,
}: ListUserWorksPageOptions): Promise<UserWorksPage> {
  const take = Math.min(
    Math.max(limit ?? USER_WORKS_PAGE_SIZE, 1),
    USER_WORKS_MAX_LIMIT,
  );
  const decoded = decodeUserWorksCursor(cursor);
  const cursorDate = decoded ? new Date(decoded.createdAt) : null;

  const works = await db.generationImage.findMany({
    where: {
      job: { userId },
      ...(decoded && cursorDate
        ? {
            OR: [
              { createdAt: { lt: cursorDate } },
              {
                createdAt: cursorDate,
                id: { lt: decoded.id },
              },
            ],
          }
        : {}),
    },
    include: workBaseInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
  });

  const hasMore = works.length > take;
  const visible = works.slice(0, take);
  const items = visible.map(serializeWork);
  const last = visible[visible.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeUserWorksCursor({
          createdAt: last.createdAt.toISOString(),
          id: last.id,
        })
      : null;

  return { hasMore, items, nextCursor };
}

export type UserWorksCounts = {
  featured: number;
  pending: number;
  total: number;
};

export async function getUserWorksCounts(
  userId: string,
): Promise<UserWorksCounts> {
  const [total, statusGroups] = await Promise.all([
    db.generationImage.count({ where: { job: { userId } } }),
    db.generationImage.groupBy({
      by: ["showcaseStatus"],
      where: { job: { userId } },
      _count: { _all: true },
    }),
  ]);

  const counts: UserWorksCounts = { featured: 0, pending: 0, total };
  for (const group of statusGroups) {
    if (group.showcaseStatus === ShowcaseStatus.PENDING) {
      counts.pending = group._count._all;
    } else if (group.showcaseStatus === ShowcaseStatus.FEATURED) {
      counts.featured = group._count._all;
    }
  }
  return counts;
}

export async function listFeaturedWorks(take = 6) {
  const page = await listFeaturedWorksPage({ limit: take });
  return page.items;
}

type FeaturedWorksCursor = {
  featuredAt: string;
  id: string;
};

type ListFeaturedWorksPageOptions = {
  cursor?: string | null;
  limit?: number;
  viewerId?: string | null;
};

export type FeaturedWorksPage = {
  hasMore: boolean;
  items: ReturnType<typeof serializeFeaturedWork>[];
  nextCursor: string | null;
};

function encodeFeaturedWorksCursor(cursor: FeaturedWorksCursor) {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeFeaturedWorksCursor(cursor?: string | null) {
  if (!cursor) {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<FeaturedWorksCursor>;
    if (typeof decoded.featuredAt !== "string" || typeof decoded.id !== "string") {
      return null;
    }
    return decoded as FeaturedWorksCursor;
  } catch {
    return null;
  }
}

export async function listFeaturedWorksPage(
  options: ListFeaturedWorksPageOptions = {},
): Promise<FeaturedWorksPage> {
  const limit = Math.min(
    Math.max(options.limit ?? FEATURED_WORKS_PAGE_SIZE, 1),
    FEATURED_WORKS_PAGE_SIZE,
  );
  const cursor = decodeFeaturedWorksCursor(options.cursor);
  const cursorFeaturedAt = cursor ? new Date(cursor.featuredAt) : null;
  const hasValidCursor =
    cursor && cursorFeaturedAt && !Number.isNaN(cursorFeaturedAt.getTime());

  const works = await db.generationImage.findMany({
    where: {
      showcaseStatus: ShowcaseStatus.FEATURED,
      featuredAt: {
        not: null,
      },
      ...(hasValidCursor
        ? {
            OR: [
              { featuredAt: { lt: cursorFeaturedAt } },
              {
                featuredAt: cursorFeaturedAt,
                id: { lt: cursor.id },
              },
            ],
          }
        : {}),
    },
    include: {
      ...workBaseInclude,
      _count: {
        select: {
          likes: true,
        },
      },
      job: {
        select: {
          createdAt: true,
          id: true,
          model: true,
          negativePrompt: true,
          prompt: true,
          size: true,
          status: true,
          user: {
            select: {
              avatarUrl: true,
              id: true,
              nickname: true,
            },
          },
          userId: true,
        },
      },
      ...(options.viewerId
        ? {
            likes: {
              where: {
                userId: options.viewerId,
              },
              select: {
                userId: true,
              },
              take: 1,
            },
          }
        : {}),
    },
    orderBy: [
      {
        featuredAt: "desc",
      },
      {
        id: "desc",
      },
    ],
    take: limit + 1,
  });

  const hasMore = works.length > limit;
  const pageItems = hasMore ? works.slice(0, limit) : works;
  const last = pageItems[pageItems.length - 1];
  const nextCursor =
    hasMore && last && last.featuredAt
      ? encodeFeaturedWorksCursor({
          featuredAt: last.featuredAt.toISOString(),
          id: last.id,
        })
      : null;

  return {
    hasMore,
    items: pageItems.map((w) => serializeFeaturedWork(w as unknown as FeaturedWorkRecord)),
    nextCursor,
  };
}

export async function listAdminWorks(take = 120) {
  const works = await db.generationImage.findMany({
    where: {
      showcaseStatus: {
        in: [
          ShowcaseStatus.PENDING,
          ShowcaseStatus.TAKEDOWN_PENDING,
          ShowcaseStatus.FEATURED,
        ],
      },
    },
    include: workAdminInclude,
    orderBy: [
      {
        featuredAt: "desc",
      },
      {
        submittedAt: "desc",
      },
      {
        createdAt: "desc",
      },
    ],
    take,
  });

  return works.map(serializeAdminWork);
}

export async function getWorkById(id: string) {
  const work = await db.generationImage.findUnique({
    where: { id },
    include: workBaseInclude,
  });

  return work ? serializeWork(work) : null;
}

export async function getAdminWorkById(id: string) {
  const work = await db.generationImage.findUnique({
    where: { id },
    include: workAdminInclude,
  });

  return work ? serializeAdminWork(work) : null;
}

export async function getWorkMutationTarget(id: string) {
  return db.generationImage.findUnique({
    where: { id },
    select: {
      featuredAt: true,
      job: {
        select: {
          userId: true,
        },
      },
      showcaseStatus: true,
    },
  });
}

const videoFeaturedInclude = {
  job: {
    select: {
      createdAt: true,
      id: true,
      model: true,
      negativePrompt: true,
      prompt: true,
      size: true,
      status: true,
      user: {
        select: {
          avatarUrl: true,
          id: true,
          nickname: true,
        },
      },
      userId: true,
    },
  },
  _count: {
    select: {
      likes: true,
    },
  },
};

export type FeaturedVideosPage = {
  hasMore: boolean;
  items: ReturnType<typeof serializeFeaturedVideo>[];
  nextCursor: string | null;
};

export async function listFeaturedVideosPage(
  options: { cursor?: string | null; limit?: number; viewerId?: string | null } = {},
): Promise<FeaturedVideosPage> {
  const limit = Math.min(Math.max(options.limit ?? FEATURED_WORKS_PAGE_SIZE, 1), FEATURED_WORKS_PAGE_SIZE);
  const cursor = decodeFeaturedWorksCursor(options.cursor);
  const cursorFeaturedAt = cursor ? new Date(cursor.featuredAt) : null;
  const hasValidCursor = cursor && cursorFeaturedAt && !Number.isNaN(cursorFeaturedAt.getTime());

  const videos = await db.generatedVideo.findMany({
    where: {
      showcaseStatus: ShowcaseStatus.FEATURED,
      featuredAt: { not: null },
      ...(hasValidCursor
        ? {
            OR: [
              { featuredAt: { lt: cursorFeaturedAt } },
              { featuredAt: cursorFeaturedAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    include: {
      ...videoFeaturedInclude,
      ...(options.viewerId
        ? { likes: { where: { userId: options.viewerId }, select: { userId: true }, take: 1 } }
        : {}),
    },
    orderBy: [{ featuredAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });

  const hasMore = videos.length > limit;
  const pageItems = hasMore ? videos.slice(0, limit) : videos;
  const last = pageItems[pageItems.length - 1];
  const nextCursor =
    hasMore && last && last.featuredAt
      ? encodeFeaturedWorksCursor({ featuredAt: last.featuredAt.toISOString(), id: last.id })
      : null;

  return {
    hasMore,
    items: pageItems.map((v) => serializeFeaturedVideo(v as unknown as FeaturedVideoRecord)),
    nextCursor,
  };
}

export async function getVideoMutationTarget(id: string) {
  return db.generatedVideo.findUnique({
    where: { id },
    select: {
      featuredAt: true,
      job: { select: { userId: true } },
      showcaseStatus: true,
    },
  });
}
