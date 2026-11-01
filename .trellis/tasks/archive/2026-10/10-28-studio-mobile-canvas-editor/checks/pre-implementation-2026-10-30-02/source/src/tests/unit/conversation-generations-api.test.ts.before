// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), parent: vi.fn(), conversations: vi.fn(), jobs: vi.fn(), stale: vi.fn() }));
vi.mock("@/lib/server/current-user", () => ({ getCurrentUserRecord: mocks.user }));
vi.mock("@/lib/db", () => ({ db: {
  conversation: { findFirst: mocks.parent, findMany: mocks.conversations },
  generationJob: { findMany: mocks.jobs },
} }));
vi.mock("@/lib/generation/job-refund", () => ({ failStalePendingGenerationJobs: mocks.stale }));

import { GET } from "@/app/api/me/conversations/[id]/generations/route";
import { GET as globalGet } from "@/app/api/me/generations/route";
import { decodeCanvasCursor, encodeCanvasCursor } from "@/lib/canvas/cursors";
import type { ConversationGenerationsPage } from "@/lib/conversations/contracts";
import { listConversationGenerations, listStudioConversations } from "@/lib/server/conversation-generations";

const ownerId = "owner_one";
const conversationId = "conversation_opaque:old";
const at = new Date("2026-10-01T00:00:00.000Z");
const scope = { ownerId, scope: "conversation" as const, parentId: conversationId };

function job(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, userId: ownerId, conversationId, status: "SUCCEEDED", generationType: "TEXT_TO_IMAGE", providerMode: "BUILT_IN",
    providerApiKeyEncrypted: "private-encrypted-provider", providerBaseUrl: "https://private-provider.invalid",
    model: "gpt-image-2", prompt: `prompt ${id}`, count: 1, creditsSpent: 5, size: "auto", quality: "auto",
    moderation: "auto", outputFormat: "png", outputCompression: null, sourceImageUrls: [], negativePrompt: null,
    errorMessage: null, featuredAt: null, createdAt: at, updatedAt: at, completedAt: at, startedAt: at,
    images: [{ id: `image_${id}`, url: "https://media.invalid/image.png", width: 512, height: 768, createdAt: at, storageKey: "private-object-key" }],
    videos: [], ...overrides,
  };
}

type JobQuery = {
  where: { userId: string; conversationId?: string; OR?: [{ createdAt: { lt: Date } }, { createdAt: Date; id: { lt: string } }] };
  take: number;
};
let rows: ReturnType<typeof job>[];

function read(query = "", id = conversationId) {
  return GET(new Request(`https://studio.invalid/api/me/conversations/${encodeURIComponent(id)}/generations${query}`), { params: Promise.resolve({ id }) });
}

async function page(response: Response): Promise<ConversationGenerationsPage> {
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  return (await response.json() as { data: ConversationGenerationsPage }).data;
}

beforeEach(() => {
  vi.resetAllMocks();
  rows = [];
  mocks.user.mockResolvedValue({ id: ownerId });
  mocks.parent.mockImplementation(async ({ where }: { where: { id: string; userId: string } }) => (
    where.id === conversationId && where.userId === ownerId ? { id: conversationId } : null
  ));
  mocks.conversations.mockResolvedValue([]);
  mocks.jobs.mockImplementation(async ({ where, take }: JobQuery) => rows
    .filter((row) => row.userId === where.userId && (!where.conversationId || row.conversationId === where.conversationId))
    .filter((row) => !where.OR || row.createdAt < where.OR[0].createdAt.lt
      || (row.createdAt.getTime() === where.OR[1].createdAt.getTime() && row.id < where.OR[1].id.lt))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
    .slice(0, take));
});

afterEach(() => vi.restoreAllMocks());

describe("owner-scoped conversation content", () => {
  it("authenticates without requiring canvas enablement and does not query for anonymous callers", async () => {
    mocks.user.mockResolvedValue(null);
    const response = await read();
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ code: "CONVERSATION_UNAUTHENTICATED", error: "未登录" });
    expect(mocks.parent).not.toHaveBeenCalled();
    expect(mocks.jobs).not.toHaveBeenCalled();
  });

  it.each(["missing_conversation", "foreign_conversation", "deleted_conversation"])("treats %s as an unavailable owned parent", async (id) => {
    expect((await read("", id)).status).toBe(404);
    expect(mocks.jobs).not.toHaveBeenCalled();
    expect(mocks.parent).toHaveBeenCalledWith({ where: { id, userId: ownerId }, select: { id: true } });
  });

  it("cannot load another owner's identically named conversation", async () => {
    mocks.user.mockResolvedValue({ id: "owner_two" });
    expect((await read()).status).toBe(404);
    expect(mocks.jobs).not.toHaveBeenCalled();
  });

  it("keeps an old chat complete when newer canvas/orphan jobs fill the global pool", async () => {
    rows = [
      ...Array.from({ length: 130 }, (_, i) => job(`canvas_${i}`, { conversationId: null, createdAt: new Date("2026-10-28T00:00:00.000Z") })),
      ...Array.from({ length: 60 }, (_, i) => job(`chat_${String(i).padStart(3, "0")}`)),
      job("foreign", { userId: "owner_two" }), job("other_chat", { conversationId: "conversation_other" }),
    ];
    const first = await page(await read());
    expect(first.conversationId).toBe(conversationId);
    expect(first.generations).toHaveLength(50);
    expect(first.generations.every((generation) => generation.id.startsWith("chat_") && generation.conversationId === conversationId)).toBe(true);
    const second = await page(await read(`?cursor=${first.nextCursor}`));
    expect(second.generations).toHaveLength(10);
    expect(new Set([...first.generations, ...second.generations].map((generation) => generation.id)).size).toBe(60);
    expect(second.nextCursor).toBeNull();
    expect(mocks.stale).not.toHaveBeenCalled();
    expect(mocks.jobs).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: ownerId, conversationId }, take: 51 }));
  });

  it("uses immutable creation time plus opaque ID for equal-time pages and serializes safe DTOs", async () => {
    rows = [job("job_c"), job("job_a"), job("job_b", { updatedAt: new Date("2026-10-29T00:00:00.000Z") })];
    const first = await page(await read("?limit=2"));
    expect(first.generations.map((generation) => generation.id)).toEqual(["job_c", "job_b"]);
    expect(first.generations[0]).toMatchObject({ status: "succeeded", createdAt: at.toISOString(), images: [{ actualWidth: 512, actualHeight: 768 }] });
    const key = decodeCanvasCursor(first.nextCursor!, scope);
    expect(key).toEqual({ at, id: "job_b" });
    const second = await page(await read(`?limit=2&cursor=${first.nextCursor}`));
    expect(second.generations.map((generation) => generation.id)).toEqual(["job_a"]);
    expect(second.nextCursor).toBeNull();
    expect(JSON.stringify(first)).not.toMatch(/private-|providerApiKey|userId|storageKey/);
    expect(mocks.jobs).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { userId: ownerId, conversationId, OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: "job_b" } }] },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 3,
    }));
  });

  it("bounds pages at 100 without a per-ID query or full-history startup", async () => {
    rows = Array.from({ length: 110 }, (_, i) => job(`job_${i}`));
    expect((await page(await read("?limit=100"))).generations).toHaveLength(100);
    expect(mocks.jobs).toHaveBeenCalledTimes(1);
    expect(mocks.jobs.mock.calls[0][0].take).toBe(101);
    expect((await read("?limit=101")).status).toBe(400);
    await expect(listConversationGenerations({ ownerId, conversationId, limit: 101 })).rejects.toMatchObject({ code: "CONVERSATION_INVALID_INPUT" });
  });

  it.each(["?limit=0", "?limit=-1", "?limit=1.5", "?limit=no", "?limit=1&limit=2", "?ownerId=other", "?cursor=", "?cursor=%25"])("rejects malformed or unexpected query %s before DB access", async (query) => {
    expect((await read(query)).status).toBe(400);
    expect(mocks.parent).not.toHaveBeenCalled();
    expect(mocks.jobs).not.toHaveBeenCalled();
  });

  it.each(["", "bad/parent", "x".repeat(201)])("rejects malformed parent IDs without assuming UUID format: %s", async (id) => {
    expect((await read("", id)).status).toBe(400);
    expect(mocks.parent).not.toHaveBeenCalled();
  });

  it("binds cursor owner, parent, scope, version and canonical timestamp", async () => {
    const payload = { schemaVersion: 1, ...scope, at: at.toISOString(), id: "job_opaque" };
    const cursors = [
      encodeCanvasCursor({ ...scope, ownerId: "owner_two" }, { at, id: "job_opaque" }),
      encodeCanvasCursor({ ...scope, parentId: "conversation_other" }, { at, id: "job_opaque" }),
      ...[{ scope: "canvas" }, { schemaVersion: 2 }, { at: "not-a-date" }, { unexpected: true }].map((value) => Buffer.from(JSON.stringify({ ...payload, ...value })).toString("base64url")),
      Buffer.from([255]).toString("base64url"), "a".repeat(2049),
    ];
    for (const cursor of cursors) expect((await read(`?cursor=${cursor}`)).status).toBe(400);
    expect(mocks.parent).not.toHaveBeenCalled();
    expect(mocks.jobs).not.toHaveBeenCalled();
  });

  it("returns bounded navigation counts without serializing historical ID lists", async () => {
    mocks.conversations.mockResolvedValue([{ id: conversationId, title: "Old conversation", createdAt: at, updatedAt: at, _count: { generations: 50_000 } }]);
    expect(await listStudioConversations(ownerId)).toEqual([{
      id: conversationId, title: "Old conversation", createdAt: at.toISOString(), updatedAt: at.toISOString(), generationCount: 50_000,
    }]);
    expect(mocks.conversations).toHaveBeenCalledWith({
      where: { userId: ownerId },
      select: { id: true, title: true, createdAt: true, updatedAt: true, _count: { select: { generations: { where: { userId: ownerId } } } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100,
    });
    expect(mocks.jobs).not.toHaveBeenCalled();
  });

  it("keeps the legacy no-query global GET contract unchanged", async () => {
    rows = Array.from({ length: 30 }, (_, i) => job(`global_${i}`, { conversationId: null }));
    const response = await globalGet();
    const result = await response.json();
    expect(Object.keys(result.data)).toEqual(["generations"]);
    expect(result.data.generations).toHaveLength(24);
    expect(result.data.generations.every((generation: { conversationId: string | null }) => generation.conversationId === null)).toBe(true);
    expect(mocks.jobs).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: ownerId }, take: 24 }));
    expect(mocks.stale).toHaveBeenCalledWith({ userId: ownerId });
  });

  it("does not expose raw database errors", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.parent.mockRejectedValue(new Error("private-dsn and SQL"));
    const response = await read();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: "CONVERSATION_LOAD_FAILED", error: "会话加载失败，请稍后重试" });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-dsn|SQL/);
  });
});
