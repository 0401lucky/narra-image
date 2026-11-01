import { act, renderHook, waitFor } from "@testing-library/react";
import { useEffect } from "react";

import { useConversationGenerations } from "@/components/create/hooks/use-conversation-generations";
import type { SessionInfo } from "@/components/create/types";
import type { ConversationGenerationsPage } from "@/lib/conversations/contracts";
import { conversationGeneration as generation, conversationPage as page } from "./helpers/conversation-fixtures";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

type PendingRead = { url: string; signal: AbortSignal; reply: ReturnType<typeof deferred<Response>> };
let reads: PendingRead[];
const session = (id = "conversation_a", generationCount = 100): SessionInfo => ({ id, generationCount, generationIds: [], createdAt: "2026-10-01T00:00:00.000Z", title: id });
const reply = (data: ConversationGenerationsPage, status = 200) => new Response(JSON.stringify({ data }), { status });

async function finish(index: number, data: ConversationGenerationsPage, status = 200) {
  await act(async () => { reads[index].reply.resolve(reply(data, status)); });
}

beforeEach(() => {
  reads = [];
  vi.stubGlobal("fetch", vi.fn((url: string, options: RequestInit) => {
    const read = { url, signal: options.signal as AbortSignal, reply: deferred<Response>() };
    reads.push(read);
    return read.reply.promise;
  }));
});

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("conversation page ownership and recovery", () => {
  it("seeds only exact conversation membership and explicitly loads one older page", async () => {
    const initialPage = page([generation("job_b"), generation("job_c")], "older_cursor");
    const { result } = renderHook(() => useConversationGenerations({
      ownerId: "owner_a", initialPage, initialConversations: [session()],
      initialGenerations: [generation("canvas_job", "unused", { conversationId: null })],
    }));
    expect(result.current.generations).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    act(() => result.current.selectConversation("conversation_a"));
    expect(result.current.generations.map((item) => item.id)).toEqual(["job_b", "job_c"]);
    expect(result.current.hasMore).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    act(() => { void result.current.loadOlder(); void result.current.loadOlder(); });
    expect(reads).toHaveLength(1);
    expect(reads[0].url).toBe("/api/me/conversations/conversation_a/generations?cursor=older_cursor");
    expect(result.current.loadingOlder).toBe(true);
    await finish(0, page([generation("job_a"), generation("job_b")]));
    expect(result.current.generations.map((item) => item.id)).toEqual(["job_a", "job_b", "job_c"]);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.loadingOlder).toBe(false);
    await act(async () => { await result.current.loadOlder(); });
    expect(reads).toHaveLength(1);
  });

  it("loads an uncached old conversation with a single bounded request, not one request per historical ID", async () => {
    const { result } = renderHook(() => useConversationGenerations({ ownerId: "owner_a", initialConversations: [session("old:conversation", 50_000)] }));
    act(() => result.current.selectConversation("old:conversation"));
    expect(result.current.loading).toBe(true);
    expect(reads).toHaveLength(1);
    expect(reads[0].url).toBe("/api/me/conversations/old%3Aconversation/generations");
    await finish(0, page([generation("old_job", "old:conversation")], "next_page", "old:conversation"));
    expect(result.current.generations[0].id).toBe("old_job");
    expect(reads).toHaveLength(1);
  });

  it("rejects stale A and B replies after A -> B -> A, even within one event", async () => {
    const { result } = renderHook(() => useConversationGenerations({ ownerId: "owner_a" }));
    act(() => result.current.selectConversation("conversation_a"));
    act(() => { result.current.selectConversation("conversation_b"); result.current.selectConversation("conversation_a"); });
    expect(reads).toHaveLength(3);
    expect(reads[0].signal.aborted).toBe(true);
    expect(reads[1].signal.aborted).toBe(true);
    await finish(0, page([generation("stale_a")], "bad_cursor"));
    await finish(1, page([generation("stale_b", "conversation_b")], null, "conversation_b"));
    expect(result.current.generations).toEqual([]);
    expect(result.current.loading).toBe(true);
    await finish(2, page([generation("current_a")]));
    expect(result.current.generations.map((item) => item.id)).toEqual(["current_a"]);
    expect(result.current.hasMore).toBe(false);
  });

  it.each(["new", "delete"])("does not resurrect the current conversation after %s", async (operation) => {
    const { result, rerender } = renderHook((props: { initialPage?: ConversationGenerationsPage }) => useConversationGenerations({ ownerId: "owner_a", ...props }), { initialProps: {} });
    act(() => result.current.selectConversation("conversation_a"));
    act(() => operation === "new" ? result.current.selectConversation(null) : result.current.forgetConversation("conversation_a"));
    expect(reads[0].signal.aborted).toBe(true);
    await finish(0, page([generation("stale_a")]));
    rerender({ initialPage: page([generation("stale_server_props")]) });
    expect(result.current.conversationId).toBeNull();
    expect(result.current.generations).toEqual([]);
    if (operation === "delete") {
      act(() => result.current.selectConversation("conversation_a"));
      expect(result.current.conversationId).toBeNull();
      expect(result.current.acceptGeneration("conversation_a", generation("late_ack"))).toBe(false);
    }
    expect(reads).toHaveLength(1);
  });

  it("isolates owner epochs including owner A -> B -> A and old callbacks", async () => {
    const { result, rerender } = renderHook(({ ownerId }) => useConversationGenerations({ ownerId }), { initialProps: { ownerId: "owner_a" } });
    act(() => result.current.selectConversation("conversation_a"));
    const oldAccept = result.current.acceptGeneration;
    rerender({ ownerId: "owner_b" });
    expect(result.current.conversationId).toBeNull();
    act(() => result.current.selectConversation("conversation_a"));
    rerender({ ownerId: "owner_a" });
    act(() => result.current.selectConversation("conversation_a"));
    expect(reads[0].signal.aborted).toBe(true);
    expect(reads[1].signal.aborted).toBe(true);
    await finish(0, page([generation("old_owner_a")]));
    await finish(1, page([generation("owner_b")]));
    expect(oldAccept("conversation_a", generation("old_callback"))).toBe(false);
    expect(result.current.generations).toEqual([]);
    await finish(2, page([generation("fresh_owner_a")]));
    expect(result.current.generations.map((item) => item.id)).toEqual(["fresh_owner_a"]);
  });

  it("merges local accepted jobs and canonical terminal states without page regression", async () => {
    const pending = generation("pending_job", "conversation_a", { status: "pending" });
    const { result } = renderHook(() => useConversationGenerations({ ownerId: "owner_a", initialPage: page([pending], "older_page") }));
    act(() => result.current.selectConversation("conversation_a"));
    act(() => { void result.current.loadOlder(); });
    act(() => {
      result.current.acceptGeneration("conversation_a", generation("new_local"));
      result.current.updateGeneration({ ...pending, status: "succeeded", images: [{ id: "image", url: "https://media.invalid/image.png" }] });
    });
    await finish(0, page([pending, pending, generation("older_job")]));
    expect(result.current.generations.map((item) => item.id)).toEqual(["new_local", "older_job", "pending_job"]);
    expect(result.current.generations.find((item) => item.id === "pending_job")).toMatchObject({ status: "succeeded", images: [{ id: "image" }] });
    expect(result.current.acceptGeneration("conversation_a", generation("canvas", "x", { conversationId: null }))).toBe(false);
  });

  it("accepts a terminal transition even when the pending timestamp was ahead", () => {
    const pending = generation("clock_skew", "conversation_a", { status: "pending", updatedAt: "2026-10-03T00:00:00.000Z" });
    const terminal = generation(pending.id, "conversation_a", { status: "succeeded", updatedAt: "2026-10-02T00:00:00.000Z" });
    const { result } = renderHook(() => useConversationGenerations({ ownerId: "owner_a", initialPage: page([pending]) }));
    act(() => result.current.selectConversation("conversation_a"));
    act(() => result.current.updateGeneration(terminal));
    expect(result.current.generations).toEqual([terminal]);
    act(() => result.current.updateGeneration({ ...pending, updatedAt: "2026-10-04T00:00:00.000Z" }));
    expect(result.current.generations).toEqual([terminal]);
  });

  it("retains retry replacement suppression across stale pages and late updates", async () => {
    const failed = generation("failed_job", "conversation_a", { status: "failed" });
    const accepted = generation("replacement", "conversation_a", { status: "pending" });
    const { result } = renderHook(() => useConversationGenerations({ ownerId: "owner_a", initialPage: page([failed]) }));
    act(() => result.current.selectConversation("conversation_a"));
    act(() => { void result.current.reload(); result.current.acceptGeneration("conversation_a", accepted, failed.id); });
    await finish(0, page([failed]));
    act(() => result.current.updateGeneration(failed));
    expect(result.current.generations.map((item) => item.id)).toEqual(["replacement"]);
  });

  it("does not append an accepted A job into the selected B conversation", async () => {
    const { result } = renderHook(() => useConversationGenerations({ ownerId: "owner_a", initialConversations: [session("conversation_a", 0), session("conversation_b", 0)] }));
    act(() => result.current.selectConversation("conversation_b"));
    act(() => { result.current.acceptGeneration("conversation_a", generation("a_job")); });
    expect(result.current.generations).toEqual([]);
    act(() => result.current.selectConversation("conversation_a"));
    expect(result.current.generations[0].id).toBe("a_job");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps loading errors explicit, rejects mismatched pages and retries the same older cursor", async () => {
    const { result } = renderHook(() => useConversationGenerations({ ownerId: "owner_a", initialPage: page([generation("known_a")], "older_page") }));
    act(() => result.current.selectConversation("conversation_a"));
    act(() => { void result.current.loadOlder(); });
    await finish(0, page([generation("wrong_b", "conversation_b")], null, "conversation_b"));
    expect(result.current.error).toBe("会话内容格式不正确，请重试");
    expect(result.current.generations.map((item) => item.id)).toEqual(["known_a"]);
    expect(result.current.hasMore).toBe(true);
    act(() => { void result.current.reload(); });
    expect(reads[1].url).toContain("cursor=older_page");
    await finish(1, page([generation("older_a")]));
    expect(result.current.error).toBeNull();
    expect(result.current.generations).toHaveLength(2);
  });

  it.each([
    ["missing model", { model: undefined }],
    ["object prompt", { prompt: { text: "not a string" } }],
    ["null image", { images: [null] }],
    ["object image URL", { images: [{ id: "image", url: { href: "invalid" } }] }],
    ["numeric format", { outputFormat: 123 }],
    ["invalid date", { createdAt: "not-a-date" }],
    ["string references", { sourceImageUrls: "not-an-array" }],
  ])("rejects malformed %s before admitting a page into the UI cache", async (_name, fields) => {
    const { result } = renderHook(() => useConversationGenerations({ ownerId: "owner_a", initialPage: page([generation("known_a")], "older_page") }));
    act(() => result.current.selectConversation("conversation_a"));
    act(() => { void result.current.loadOlder(); });
    await act(async () => {
      reads[0].reply.resolve(new Response(JSON.stringify({ data: {
        conversationId: "conversation_a", generations: [{ ...generation("malformed"), ...fields }], nextCursor: null,
      } })));
    });
    expect(result.current.error).toBe("会话内容格式不正确，请重试");
    expect(result.current.generations.map((item) => item.id)).toEqual(["known_a"]);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.loadingOlder).toBe(false);
  });

  it.each(["null", "{", '{"data":null}'])("reports a safe error for malformed response body %s", async (body) => {
    const { result } = renderHook(() => useConversationGenerations({ ownerId: "owner_a" }));
    act(() => result.current.selectConversation("conversation_a"));
    await act(async () => { reads[0].reply.resolve(new Response(body)); });
    expect(result.current.error).toBe("会话内容格式不正确，请重试");
    expect(result.current.generations).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it("clears unavailable cached membership on a server 404 instead of showing retained orphan jobs", async () => {
    const { result } = renderHook(() => useConversationGenerations({ ownerId: "owner_a", initialPage: page([generation("known_a")]) }));
    act(() => result.current.selectConversation("conversation_a"));
    act(() => { void result.current.reload(); });
    await finish(0, page(), 404);
    expect(result.current.generations).toEqual([]);
    expect(result.current.error).toBe("会话不存在，请选择其他会话");
    expect(result.current.acceptGeneration("conversation_a", generation("late_ack"))).toBe(false);
    await act(async () => { await result.current.reload(); });
    expect(reads).toHaveLength(1);
  });

  it("guards the JSON await as well as the fetch await", async () => {
    const json = deferred<{ data: ConversationGenerationsPage }>();
    const { result } = renderHook(() => useConversationGenerations({ ownerId: "owner_a" }));
    act(() => result.current.selectConversation("conversation_a"));
    await act(async () => { reads[0].reply.resolve({ ok: true, json: () => json.promise } as Response); });
    act(() => result.current.selectConversation(null));
    await act(async () => { json.resolve({ data: page([generation("late_json")]) }); });
    expect(result.current.generations).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it.each(["fetch", "json"])("bounds a stalled %s read and retries the same older page without late cache changes", async (phase) => {
    vi.useFakeTimers();
    const json = deferred<{ data: ConversationGenerationsPage }>();
    const { result } = renderHook(() => useConversationGenerations({ ownerId: "owner_a", initialPage: page([generation("known_a")], "older_page") }));
    act(() => result.current.selectConversation("conversation_a"));
    let pending!: Promise<void>;
    act(() => { pending = result.current.loadOlder(); });
    if (phase === "json") await act(async () => { reads[0].reply.resolve({ ok: true, json: () => json.promise } as Response); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(result.current.loadingOlder).toBe(false);
    expect(result.current.error).toBe("会话加载超时，请重试");
    expect(reads[0].signal.aborted).toBe(true);
    expect(result.current.generations.map((item) => item.id)).toEqual(["known_a"]);
    await act(async () => { await pending; });
    act(() => { void result.current.reload(); });
    expect(reads[1].url).toContain("cursor=older_page");
    if (phase === "fetch") await finish(0, page([generation("late_page")], "late_cursor"));
    else await act(async () => { json.resolve({ data: page([generation("late_page")], "late_cursor") }); });
    expect(result.current.loadingOlder).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.generations.map((item) => item.id)).toEqual(["known_a"]);
    await finish(1, page([generation("older_a")]));
    expect(result.current.loadingOlder).toBe(false);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.generations.map((item) => item.id)).toEqual(["known_a", "older_a"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("settles an aborted stalled page without timing out a later selection", async () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useConversationGenerations({ ownerId: "owner_a" }));
    act(() => result.current.selectConversation("conversation_a"));
    let settled = false;
    act(() => { void result.current.reload().then(() => { settled = true; }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    act(() => result.current.selectConversation("conversation_b"));
    await act(async () => {});
    expect(settled).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(result.current.conversationId).toBe("conversation_b");
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(true);
    expect(reads.slice(0, 2).every((read) => read.signal.aborted)).toBe(true);
    await finish(2, page([generation("current_b", "conversation_b")], null, "conversation_b"));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("invalidates in-flight reads on unmount and StrictMode cleanup/setup", async () => {
    const { result, unmount } = renderHook(() => {
      const content = useConversationGenerations({ ownerId: "owner_a" });
      const { selectConversation } = content;
      useEffect(() => selectConversation("conversation_a"), [selectConversation]);
      return content;
    }, { reactStrictMode: true });
    expect(reads.length).toBeGreaterThan(1);
    expect(reads.slice(0, -1).every((read) => read.signal.aborted)).toBe(true);
    for (let i = 0; i < reads.length - 1; i += 1) await finish(i, page([generation(`stale_${i}`)]));
    expect(result.current.generations).toEqual([]);
    await finish(reads.length - 1, page([generation("current_mount")]));
    await waitFor(() => expect(result.current.generations[0]?.id).toBe("current_mount"));
    act(() => { void result.current.reload(); });
    unmount();
    expect(reads.at(-1)?.signal.aborted).toBe(true);
    await finish(reads.length - 1, page([generation("after_unmount")]));
  });

  it("registers a newly created empty conversation without fetching global history", () => {
    const { result } = renderHook(() => useConversationGenerations({ ownerId: "owner_a" }));
    act(() => { result.current.registerConversation(session("created", 0)); result.current.selectConversation("created"); });
    expect(result.current.conversationId).toBe("created");
    expect(result.current.generations).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
