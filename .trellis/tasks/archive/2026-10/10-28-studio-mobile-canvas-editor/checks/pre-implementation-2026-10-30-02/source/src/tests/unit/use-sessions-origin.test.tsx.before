import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";

import { useSessions } from "@/components/create/hooks/use-sessions";
import type { SessionInfo } from "@/components/create/types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const session = (id: string): SessionInfo => ({ id, title: id, createdAt: "2026-10-01T00:00:00.000Z", generationIds: [], generationCount: 12 });
const created = (id: string) => ({ data: { conversation: { ...session(id), updatedAt: "2026-10-01T00:00:00.000Z" } } });
type Request = { url: string; options?: RequestInit; reply: ReturnType<typeof deferred<Response>> };
let requests: Request[];
let preferences: Map<string, string>;

beforeEach(() => {
  requests = [];
  preferences = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => preferences.get(key) ?? null,
    setItem: (key: string, value: string) => preferences.set(key, value),
    removeItem: (key: string) => preferences.delete(key),
  });
  vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
    const request = { url, options, reply: deferred<Response>() };
    requests.push(request);
    return request.reply.promise;
  }));
});

afterEach(() => vi.unstubAllGlobals());

describe("session mutation origins", () => {
  it("bootstraps once per owner without enumerating history or overwriting local counts on refresh", () => {
    const { result, rerender } = renderHook(({ initial }) => useSessions("owner_a", initial), { initialProps: { initial: [session("chat_a")] } });
    act(() => result.current.appendGeneration("chat_a", "accepted"));
    rerender({ initial: [{ ...session("chat_a"), title: "stale title" }] });
    expect(result.current.sessions[0]).toMatchObject({ title: "chat_a", generationCount: 13, generationIds: ["accepted"] });
    act(() => result.current.replaceGeneration("chat_a", "older_not_loaded", "replacement"));
    expect(result.current.sessions[0]).toMatchObject({ generationCount: 13, generationIds: ["accepted", "replacement"] });
    expect(requests).toEqual([]);
  });

  it("discards a provisional create if its caller draft changes before the reply", async () => {
    const { result } = renderHook(() => useSessions("owner_a"));
    let current = true;
    let pending!: Promise<SessionInfo | null>;
    act(() => { pending = result.current.createSession("old draft", { isCurrent: () => current }); });
    current = false;
    await act(async () => {
      requests[0].reply.resolve(new Response(JSON.stringify(created("obsolete"))));
      expect(await pending).toBeNull();
    });
    expect(result.current.sessions).toEqual([]);
    expect(requests).toHaveLength(1);
  });

  it("checks provisional identity again after asynchronous JSON decoding", async () => {
    const { result } = renderHook(() => useSessions("owner_a"));
    let current = true;
    const body = deferred<ReturnType<typeof created>>();
    let pending!: Promise<SessionInfo | null>;
    act(() => { pending = result.current.createSession(undefined, { isCurrent: () => current }); });
    await act(async () => {
      requests[0].reply.resolve({ ok: true, json: () => body.promise } as Response);
    });
    current = false;
    await act(async () => { body.resolve(created("obsolete")); expect(await pending).toBeNull(); });
    expect(result.current.sessions).toEqual([]);
  });

  it.each([{ title: {} }, { id: [] }, { generationIds: [null] }, { createdAt: "invalid-date" }])("rejects malformed new-session metadata before publishing it: %j", async (fields) => {
    const { result } = renderHook(() => useSessions("owner_a"));
    let pending!: Promise<SessionInfo | null>;
    act(() => { pending = result.current.createSession("draft"); });
    await act(async () => {
      requests[0].reply.resolve(new Response(JSON.stringify({ data: { conversation: { ...created("invalid").data.conversation, ...fields } } })));
      expect(await pending).toBeNull();
    });
    expect(result.current.sessions).toEqual([]);
  });

  it("aborts owner A requests and rejects old callbacks even after returning from B to A", async () => {
    const { result, rerender } = renderHook(({ owner }) => useSessions(owner, [session(owner)]), { initialProps: { owner: "owner_a" } });
    const old = result.current;
    let pending!: Promise<SessionInfo | null>;
    act(() => { pending = old.createSession("old"); old.writeLastActive("owner_a"); });
    rerender({ owner: "owner_b" });
    expect(requests[0].options?.signal?.aborted).toBe(true);
    expect(result.current.sessions.map((item) => item.id)).toEqual(["owner_b"]);
    rerender({ owner: "owner_a" });
    act(() => { old.appendGeneration("owner_a", "stale"); old.writeLastActive("stale"); });
    await act(async () => {
      requests[0].reply.resolve(new Response(JSON.stringify(created("old_created"))));
      expect(await pending).toBeNull();
    });
    expect(result.current.sessions).toEqual([session("owner_a")]);
    expect(preferences.get("narra_active_conversation_id:owner_a")).toBe("owner_a");
    expect(preferences.has("narra_active_conversation_id:owner_b")).toBe(false);
    expect(await old.createSession("stale command")).toBeNull();
    expect(requests).toHaveLength(1);
  });

  it("does not attach generation metadata or a late rename to a deleting/deleted session", async () => {
    const initial = [session("chat_a")];
    const { result, rerender } = renderHook(({ sessions }) => useSessions("owner_a", sessions), { initialProps: { sessions: initial } });
    let rename!: Promise<void>;
    let deletion!: Promise<boolean>;
    act(() => {
      rename = result.current.renameSession("chat_a", "late rename");
      deletion = result.current.deleteSession("chat_a");
      result.current.appendGeneration("chat_a", "late_job");
    });
    expect(result.current.isSessionLive("chat_a")).toBe(false);
    expect(result.current.sessions[0].generationIds).toEqual([]);
    await act(async () => { requests[1].reply.resolve(new Response("{}")); expect(await deletion).toBe(true); });
    await act(async () => { requests[0].reply.resolve(new Response("{}")); await rename; });
    rerender({ sessions: [...initial] });
    expect(result.current.sessions).toEqual([]);
    expect(result.current.isSessionLive("chat_a")).toBe(false);
  });

  it("leaves metadata available to retry when deletion fails", async () => {
    const { result } = renderHook(() => useSessions("owner_a", [session("chat_a")]));
    let pending!: Promise<boolean>;
    act(() => { pending = result.current.deleteSession("chat_a"); });
    await act(async () => { requests[0].reply.resolve(new Response("{}", { status: 503 })); expect(await pending).toBe(false); });
    expect(result.current.isSessionLive("chat_a")).toBe(true);
    expect(result.current.sessions).toEqual([session("chat_a")]);
  });

  it("honors cancellation and unmount without publishing an ignored fetch reply in StrictMode", async () => {
    const { result, unmount } = renderHook(() => useSessions("owner_a"), { wrapper: StrictMode });
    const controller = new AbortController();
    let pending!: Promise<SessionInfo | null>;
    act(() => { pending = result.current.createSession("old", { signal: controller.signal }); });
    controller.abort();
    expect(requests[0].options?.signal?.aborted).toBe(true);
    unmount();
    requests[0].reply.resolve(new Response(JSON.stringify(created("obsolete"))));
    expect(await pending).toBeNull();
  });
});
