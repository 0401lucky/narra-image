import "server-only";

import { GenerationType } from "@prisma/client";

import { db } from "@/lib/db";
import { serializeGenerationsForClient, type SerializedGeneration } from "@/lib/prisma-mappers";
import { imageAvailabilityInclude } from "@/lib/storage/image-availability";

export const STUDIO_GENERATIONS_DEFAULT_LIMIT = 30;
export const STUDIO_GENERATIONS_MAX_LIMIT = 60;

export class StudioGenerationQueryError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "StudioGenerationQueryError";
  }
}

export type StudioGenerationsPage = {
  generations: SerializedGeneration[];
  hasMore: boolean;
  nextCursor: string | null;
};

type StudioGenerationCursor = {
  at: string;
  id: string;
  ownerId: string;
};

function encodeStudioCursor(cursor: StudioGenerationCursor) {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeStudioCursor(rawCursor: string, ownerId: string): { at: Date; id: string } {
  if (rawCursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(rawCursor)) {
    throw new StudioGenerationQueryError("分页游标格式不正确");
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(rawCursor, "base64url").toString("utf8"),
    ) as Partial<StudioGenerationCursor>;
    if (
      typeof parsed.at !== "string"
      || typeof parsed.id !== "string"
      || !parsed.id.trim()
      || parsed.ownerId !== ownerId
    ) {
      throw new StudioGenerationQueryError("分页游标无效或不属于当前账户");
    }
    const at = new Date(parsed.at);
    if (Number.isNaN(at.getTime())) {
      throw new StudioGenerationQueryError("分页游标时间无效");
    }
    return { at, id: parsed.id };
  } catch (error) {
    if (error instanceof StudioGenerationQueryError) throw error;
    throw new StudioGenerationQueryError("分页游标无法解析");
  }
}

type ListStudioGenerationsOptions = {
  ownerId: string;
  limit?: number;
  cursor?: string | null;
};

export async function listStudioGenerations({
  ownerId,
  limit = STUDIO_GENERATIONS_DEFAULT_LIMIT,
  cursor = null,
}: ListStudioGenerationsOptions): Promise<StudioGenerationsPage> {
  if (!Number.isInteger(limit) || limit < 1 || limit > STUDIO_GENERATIONS_MAX_LIMIT) {
    throw new StudioGenerationQueryError(`limit 必须为 1 到 ${STUDIO_GENERATIONS_MAX_LIMIT} 的整数`);
  }

  const decoded = cursor ? decodeStudioCursor(cursor, ownerId) : null;

  const jobs = await db.generationJob.findMany({
    where: {
      userId: ownerId,
      studioHiddenAt: null,
      generationType: {
        in: [GenerationType.TEXT_TO_IMAGE, GenerationType.IMAGE_TO_IMAGE],
      },
      ...(decoded
        ? {
            OR: [
              { createdAt: { lt: decoded.at } },
              { createdAt: decoded.at, id: { lt: decoded.id } },
            ],
          }
        : {}),
    },
    include: {
      images: { include: imageAvailabilityInclude, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      videos: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });

  const hasMore = jobs.length > limit;
  const visible = jobs.slice(0, limit);
  const last = visible.at(-1);

  return {
    generations: await serializeGenerationsForClient(visible),
    hasMore,
    nextCursor: hasMore && last
      ? encodeStudioCursor({
          at: last.createdAt.toISOString(),
          id: last.id,
          ownerId,
        })
      : null,
  };
}
