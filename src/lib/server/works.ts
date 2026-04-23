import "server-only";

import { Prisma, ShowcaseStatus } from "@prisma/client";

import { db } from "@/lib/db";
import {
  serializeAdminWork,
  serializeFeaturedWork,
  serializeWork,
} from "@/lib/prisma-mappers";

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
  const works = await db.generationImage.findMany({
    where: {
      showcaseStatus: ShowcaseStatus.FEATURED,
    },
    include: workBaseInclude,
    orderBy: {
      featuredAt: "desc",
    },
    take,
  });

  return works.map(serializeFeaturedWork);
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
