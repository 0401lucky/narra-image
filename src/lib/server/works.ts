import "server-only";

import { Prisma, ShowcaseStatus } from "@prisma/client";

import { db } from "@/lib/db";
import {
  serializeAdminWork,
  serializeFeaturedWork,
  serializeWork,
  type FeaturedWorkRecord,
} from "@/lib/prisma-mappers";

const FEATURED_WORKS_PAGE_SIZE = 24;
const FEATURED_WORKS_MAX = 100;

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

export async function listUserWorks(userId: string, take = 60) {
  const works = await db.generationImage.findMany({
    where: {
      job: {
        userId,
      },
    },
    include: workBaseInclude,
    orderBy: {
      createdAt: "desc",
    },
    take,
  });

  return works.map(serializeWork);
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

function isAfterCursor(record: { featuredAt: Date | null; id: string }, cursor: FeaturedWorksCursor) {
  if (!record.featuredAt) {
    return false;
  }

  const recordFeaturedAt = record.featuredAt.toISOString();
  if (recordFeaturedAt < cursor.featuredAt) {
    return true;
  }
  if (recordFeaturedAt > cursor.featuredAt) {
    return false;
  }
  return record.id < cursor.id;
}

export async function listFeaturedWorksPage(
  options: ListFeaturedWorksPageOptions = {},
): Promise<FeaturedWorksPage> {
  const limit = Math.min(
    Math.max(options.limit ?? FEATURED_WORKS_PAGE_SIZE, 1),
    FEATURED_WORKS_PAGE_SIZE,
  );
  const cursor = decodeFeaturedWorksCursor(options.cursor);

  const works = await db.generationImage.findMany({
    where: {
      showcaseStatus: ShowcaseStatus.FEATURED,
      featuredAt: {
        not: null,
      },
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
    take: FEATURED_WORKS_MAX,
  });

  const visibleWorks = cursor
    ? works.filter((work) => isAfterCursor(work, cursor))
    : works;
  const pageItems = visibleWorks.slice(0, limit);
  const hasMore = visibleWorks.length > limit;
  const nextCursor =
    hasMore && pageItems.length > 0 && pageItems[pageItems.length - 1]?.featuredAt
      ? encodeFeaturedWorksCursor({
          featuredAt: pageItems[pageItems.length - 1].featuredAt!.toISOString(),
          id: pageItems[pageItems.length - 1].id,
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
