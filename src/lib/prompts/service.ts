import "server-only";

import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import type { AdminPromptSource, PromptLibraryPrompt } from "@/lib/prompts/types";

export const ALL_PROMPT_SOURCES = "all";
export const PROMPT_PAGE_SIZE = 24;

export type PromptSyncResult = {
  count: number;
  slug: string;
  status: string;
};

export type PromptListQuery = {
  keyword?: string;
  page?: number;
  pageSize?: number;
  source?: string;
  tags?: string[];
};

export async function listPromptSourcesForAdmin() {
  const sources = await db.promptSource.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return sources.map(serializePromptSource);
}

export async function setPromptSourceEnabled(id: string, isEnabled: boolean) {
  const updated = await db.promptSource.update({
    data: { isEnabled },
    where: { id },
  });
  return serializePromptSource(updated);
}

export async function listPrompts(query: PromptListQuery = {}) {
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

// syncPromptSource / syncAllPromptSources 只转发到 Go Worker 的内部端点；
// 抓取、解析、入库、advisory 锁与失败记录全部由 Worker 承担，Node 不再维护解析器。
export async function syncPromptSource(idOrSlug: string): Promise<PromptSyncResult> {
  const results = await callPromptSync(idOrSlug);
  return results[0] ?? { count: 0, slug: idOrSlug, status: "FAILED" };
}

export async function syncAllPromptSources(): Promise<PromptSyncResult[]> {
  return callPromptSync(ALL_PROMPT_SOURCES);
}

async function callPromptSync(sourceId: string): Promise<PromptSyncResult[]> {
  const env = getEnv();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (env.WORKER_METRICS_TOKEN) {
    headers.Authorization = `Bearer ${env.WORKER_METRICS_TOKEN}`;
  }
  const body = sourceId === ALL_PROMPT_SOURCES ? {} : { sourceId };

  const response = await fetch(
    `${env.WORKER_INTERNAL_URL}/internal/prompt-sync`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300_000),
    },
  );
  if (!response.ok) {
    throw new Error(`提示词同步失败：HTTP ${response.status}`);
  }
  const payload = (await response.json()) as { results?: PromptSyncResult[] };
  return payload.results ?? [];
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
  status: string;
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
    status: source.status as AdminPromptSource["status"],
  };
}
