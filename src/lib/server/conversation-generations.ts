import "server-only";

import { CANVAS_LIMITS } from "@/lib/canvas/contracts";
import { encodeCanvasCursor, type CanvasKeyset } from "@/lib/canvas/cursors";
import type { ConversationGenerationsPage, StudioConversationSummary } from "@/lib/conversations/contracts";
import { db } from "@/lib/db";
import { serializeGeneration } from "@/lib/prisma-mappers";
import { canvasCanonicalIdSchema, canvasPageQuerySchema } from "@/lib/validators";

export class ConversationContentError extends Error {
  readonly code: "CONVERSATION_INVALID_INPUT" | "CONVERSATION_NOT_FOUND";
  readonly status: number;

  constructor(code: "CONVERSATION_INVALID_INPUT" | "CONVERSATION_NOT_FOUND") {
    super(code === "CONVERSATION_NOT_FOUND" ? "会话不存在" : "会话分页参数不正确");
    this.name = "ConversationContentError";
    this.code = code;
    this.status = code === "CONVERSATION_NOT_FOUND" ? 404 : 400;
  }
}

type ListConversationGenerationsOptions = {
  ownerId: string;
  conversationId: string;
  limit?: number;
  key?: CanvasKeyset | null;
};

export async function listConversationGenerations({
  ownerId,
  conversationId,
  limit,
  key = null,
}: ListConversationGenerationsOptions): Promise<ConversationGenerationsPage> {
  const id = canvasCanonicalIdSchema.safeParse(conversationId);
  const page = canvasPageQuerySchema.safeParse({ limit });
  if (!id.success || !page.success) throw new ConversationContentError("CONVERSATION_INVALID_INPUT");

  const parent = await db.conversation.findFirst({
    where: { id: id.data, userId: ownerId },
    select: { id: true },
  });
  if (!parent) throw new ConversationContentError("CONVERSATION_NOT_FOUND");

  const jobs = await db.generationJob.findMany({
    where: {
      userId: ownerId,
      conversationId: id.data,
      ...(key ? {
        OR: [
          { createdAt: { lt: key.at } },
          { createdAt: key.at, id: { lt: key.id } },
        ],
      } : {}),
    },
    include: {
      images: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      videos: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: page.data.limit + 1,
  });
  const visible = jobs.slice(0, page.data.limit);
  const last = visible.at(-1);
  return {
    conversationId: id.data,
    generations: visible.map(serializeGeneration),
    nextCursor: jobs.length > page.data.limit && last
      ? encodeCanvasCursor({ ownerId, scope: "conversation", parentId: id.data }, { at: last.createdAt, id: last.id })
      : null,
  };
}

export async function listStudioConversations(ownerId: string): Promise<StudioConversationSummary[]> {
  const conversations = await db.conversation.findMany({
    where: { userId: ownerId },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { generations: { where: { userId: ownerId } } } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: CANVAS_LIMITS.maximumPageSize,
  });
  return conversations.map((conversation) => ({
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    generationCount: conversation._count.generations,
  }));
}
