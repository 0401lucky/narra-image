import "server-only";

import { Prisma, PromptSourceStatus } from "@prisma/client";

import { db } from "@/lib/db";
import { DEFAULT_PROMPT_SOURCES } from "@/lib/prompts/source-config";
import { type FetchedPrompt, parseRemotePrompts } from "@/lib/prompts/parser";
import type { AdminPromptSource, PromptLibraryPrompt } from "@/lib/prompts/types";

export const ALL_PROMPT_SOURCES = "all";
export const PROMPT_PAGE_SIZE = 24;

export type PromptListQuery = {
  keyword?: string;
  page?: number;
  pageSize?: number;
  source?: string;
  tags?: string[];
};

export async function ensureDefaultPromptSources() {
  await Promise.all(
    DEFAULT_PROMPT_SOURCES.map((source) =>
      db.promptSource.upsert({
        where: { slug: source.slug },
        update: {
          description: source.description,
          name: source.name,
          parser: source.parser,
          rawBaseUrl: source.rawBaseUrl,
          sortOrder: source.sortOrder,
          sourceUrl: source.sourceUrl,
        },
        create: {
          description: source.description,
          name: source.name,
          parser: source.parser,
          rawBaseUrl: source.rawBaseUrl,
          slug: source.slug,
          sortOrder: source.sortOrder,
          sourceUrl: source.sourceUrl,
        },
      }),
    ),
  );
}

export async function listPromptSourcesForAdmin() {
  await ensureDefaultPromptSources();
  const sources = await db.promptSource.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return sources.map(serializePromptSource);
}

export async function setPromptSourceEnabled(id: string, isEnabled: boolean) {
  await ensureDefaultPromptSources();
  const updated = await db.promptSource.update({
    data: { isEnabled },
    where: { id },
  });
  return serializePromptSource(updated);
}

export async function listPrompts(query: PromptListQuery = {}) {
  await ensureDefaultPromptSources();

  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(60, Math.max(1, query.pageSize ?? PROMPT_PAGE_SIZE));
  const where = buildPromptWhere(query);
  const sourceWhere = buildPromptSourceWhere(query.source);

  const [items, total, tagsRows, sources] = await Promise.all([
    db.promptLibraryItem.findMany({
      include: {
        source: {
          select: {
            id: true,
            name: true,
            slug: true,
            sourceUrl: true,
          },
        },
      },
      orderBy: [{ source: { sortOrder: "asc" } }, { sortOrder: "asc" }, { updatedAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      where,
    }),
    db.promptLibraryItem.count({ where }),
    db.promptLibraryItem.findMany({
      select: { tags: true },
      where: {
        source: sourceWhere,
      },
    }),
    db.promptSource.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        itemCount: true,
        name: true,
        slug: true,
      },
      where: { isEnabled: true },
    }),
  ]);

  return {
    categories: sources.map((source) => ({
      id: source.id,
      itemCount: source.itemCount,
      name: source.name,
      slug: source.slug,
    })),
    items: items.map(serializePrompt),
    page,
    pageSize,
    tags: collectTags(tagsRows.flatMap((item) => item.tags)),
    total,
  };
}

export async function syncPromptSource(idOrSlug: string) {
  await ensureDefaultPromptSources();
  const source = await db.promptSource.findFirst({
    where: {
      OR: [{ id: idOrSlug }, { slug: idOrSlug }],
    },
  });

  if (!source) {
    throw new Error("提示词来源不存在");
  }

  await db.promptSource.update({
    data: {
      lastSyncError: null,
      status: PromptSourceStatus.SYNCING,
    },
    where: { id: source.id },
  });

  try {
    const fetched = normalizeFetchedPrompts(
      await parseRemotePrompts(source, (filePath) => fetchSourceText(source.rawBaseUrl, filePath)),
    );

    if (fetched.length === 0) {
      throw new Error("没有从该来源解析到提示词");
    }

    const synced = await replaceSourcePrompts(source.id, fetched);
    return serializePromptSource(synced);
  } catch (error) {
    const message = error instanceof Error ? error.message : "同步失败";
    await db.promptSource.update({
      data: {
        lastSyncError: message,
        status: PromptSourceStatus.FAILED,
      },
      where: { id: source.id },
    });
    throw error;
  }
}

export async function syncAllPromptSources() {
  await ensureDefaultPromptSources();
  const sources = await db.promptSource.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    where: { isEnabled: true },
  });

  const results: AdminPromptSource[] = [];
  for (const source of sources) {
    results.push(await syncPromptSource(source.id));
  }
  return results;
}

function buildPromptWhere(query: PromptListQuery) {
  const where: Prisma.PromptLibraryItemWhereInput = {
    source: buildPromptSourceWhere(query.source),
  };
  const keyword = query.keyword?.trim();
  const tags = collectTags(query.tags ?? []);

  if (keyword) {
    where.OR = [
      { title: { contains: keyword, mode: "insensitive" } },
      { prompt: { contains: keyword, mode: "insensitive" } },
    ];
  }

  if (tags.length > 0) {
    where.tags = { hasEvery: tags };
  }

  return where;
}

function buildPromptSourceWhere(sourceSlug?: string) {
  const sourceWhere: Prisma.PromptSourceWhereInput = { isEnabled: true };
  const source = sourceSlug?.trim();
  if (source && source !== ALL_PROMPT_SOURCES) {
    sourceWhere.slug = source;
  }
  return sourceWhere;
}

async function replaceSourcePrompts(sourceId: string, items: FetchedPrompt[]) {
  const syncedAt = new Date();
  const remoteIds = items.map((item) => item.remoteId);

  return db.$transaction(async (tx) => {
    await tx.promptLibraryItem.deleteMany({
      where: {
        remoteId: { notIn: remoteIds },
        sourceId,
      },
    });

    for (const item of items) {
      await tx.promptLibraryItem.upsert({
        create: {
          coverUrl: item.coverUrl || null,
          preview: item.preview || null,
          previewUrls: item.previewUrls,
          prompt: item.prompt,
          remoteId: item.remoteId,
          sortOrder: item.sortOrder,
          sourceId,
          syncedAt,
          tags: item.tags,
          title: item.title,
        },
        update: {
          coverUrl: item.coverUrl || null,
          preview: item.preview || null,
          previewUrls: item.previewUrls,
          prompt: item.prompt,
          sortOrder: item.sortOrder,
          syncedAt,
          tags: item.tags,
          title: item.title,
        },
        where: {
          sourceId_remoteId: {
            remoteId: item.remoteId,
            sourceId,
          },
        },
      });
    }

    return tx.promptSource.update({
      data: {
        itemCount: items.length,
        lastSyncError: null,
        lastSyncedAt: syncedAt,
        status: PromptSourceStatus.SUCCESS,
      },
      where: { id: sourceId },
    });
  });
}

async function fetchSourceText(baseUrl: string, filePath: string) {
  const url = `${baseUrl.replace(/\/$/, "")}/${filePath.replace(/^\//, "")}`;
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "text/plain,application/json,text/markdown,*/*",
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`${filePath} 拉取失败：HTTP ${response.status}`);
  }

  return response.text();
}

function normalizeFetchedPrompts(items: FetchedPrompt[]) {
  const seen = new Set<string>();
  const normalized: FetchedPrompt[] = [];

  for (const item of items) {
    const title = item.title.trim().slice(0, 180);
    const prompt = item.prompt.trim();
    const remoteId = item.remoteId.trim();
    if (!title || !prompt || !remoteId || seen.has(remoteId)) continue;

    seen.add(remoteId);
    normalized.push({
      coverUrl: item.coverUrl?.trim() || null,
      preview: item.preview?.trim() || null,
      previewUrls: item.previewUrls.map((url) => url.trim()).filter(Boolean).slice(0, 8),
      prompt,
      remoteId,
      sortOrder: item.sortOrder,
      tags: collectTags(item.tags),
      title,
    });
  }

  return normalized;
}

function collectTags(tags: string[]) {
  return Array.from(
    new Set(
      tags
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    ),
  )
    .sort((a, b) => a.localeCompare(b, "zh-CN"))
    .slice(0, 80);
}

function serializePrompt(
  item: Prisma.PromptLibraryItemGetPayload<{
    include: {
      source: {
        select: {
          id: true;
          name: true;
          slug: true;
          sourceUrl: true;
        };
      };
    };
  }>,
): PromptLibraryPrompt {
  return {
    coverUrl: item.coverUrl,
    createdAt: item.createdAt.toISOString(),
    id: item.id,
    preview: item.preview,
    previewUrls: item.previewUrls,
    prompt: item.prompt,
    source: item.source,
    sourceUrl: item.source.sourceUrl,
    tags: item.tags,
    title: item.title,
    updatedAt: item.updatedAt.toISOString(),
  };
}

function serializePromptSource(source: {
  description: string | null;
  id: string;
  isEnabled: boolean;
  itemCount: number;
  lastSyncError: string | null;
  lastSyncedAt: Date | null;
  name: string;
  parser: string;
  rawBaseUrl: string;
  slug: string;
  sortOrder: number;
  sourceUrl: string;
  status: PromptSourceStatus;
}): AdminPromptSource {
  return {
    description: source.description,
    id: source.id,
    isEnabled: source.isEnabled,
    itemCount: source.itemCount,
    lastSyncError: source.lastSyncError,
    lastSyncedAt: source.lastSyncedAt?.toISOString() ?? null,
    name: source.name,
    parser: source.parser,
    rawBaseUrl: source.rawBaseUrl,
    slug: source.slug,
    sortOrder: source.sortOrder,
    sourceUrl: source.sourceUrl,
    status: source.status,
  };
}
