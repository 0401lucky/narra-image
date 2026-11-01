import { act, cleanup, renderHook } from "@testing-library/react";
import { useEffect } from "react";

import type { CanvasJobOrigin } from "@/components/create/canvas/studio-bridge";
import { POLL_DELAYS_MS } from "@/components/create/constants";
import { useConversationGenerations } from "@/components/create/hooks/use-conversation-generations";
import { useStudioJobs } from "@/components/create/hooks/use-studio-jobs";
import type { GenerationItem, SessionInfo } from "@/components/create/types";

import { conversationGeneration } from "./helpers/conversation-fixtures";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

type PendingRead = { url: string; signal: AbortSignal; reply: ReturnType<typeof deferred<Response>> };
let reads: PendingRead[];
const originalHidden = Object.getOwnPropertyDescriptor(document, "hidden");
const pending: GenerationItem = conversationGeneration("job_a", "conversation_a", { status: "pending" });
const terminal: GenerationItem = {
  ...pending, status: "succeeded", updatedAt: "2026-10-03T00:00:00.000Z",
  images: [{ id: "image_a", url: "https://media.invalid/image_a.png" }],
};
const canvasOrigin: CanvasJobOrigin = { ownerId: "owner_a", canvasId: "canvas_a", nodeId: "node_a", runId: "run_a" };

async function advance(ms = POLL_DELAYS_MS[0]) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

async function finish(index: number, job = terminal) {
  await act(async () => { reads[index].reply.resolve(new Response(JSON.stringify({ data: { generation: job } }))); });
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  reads = [];
  vi.stubGlobal("fetch", vi.fn((url: string, options: RequestInit) => {
    const read = { url, signal: options.signal as AbortSignal, reply: deferred<Response>() };
    reads.push(read);
    return read.reply.promise;
  }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (originalHidden) Object.defineProperty(document, "hidden", originalHidden);
  else Reflect.deleteProperty(document, "hidden");
});

describe("useStudioJobs", () => {
  it("starts empty and never discovers history or registers unknown updates", async () => {
    const { result } = renderHook(() => useStudioJobs({ ownerId: "owner_a" }));
    expect(result.current.getJob("unknown")).toBeNull();
    expect(result.current.canvasJobs.read("unknown")).toBeNull();
    expect(result.current.updateJob(pending)).toBeNull();
    expect(result.current.pendingGenerations).toEqual([]);
    await advance(100_000);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("registers and merges synchronously before notifying the captured conversation", () => {
    const observed: Array<{ conversationId: string; job: GenerationItem; cached: GenerationItem | null }> = [];
    const { result } = renderHook(() => useStudioJobs({
      ownerId: "owner_a",
      onConversationUpdate: (conversationId, job) => observed.push({ conversationId, job, cached: result.current.getJob(job.id) }),
    }));
    act(() => {
      const canonical = result.current.registerConversation("conversation_a", pending);
      expect(canonical).toBe(result.current.getJob(pending.id));
      expect(observed[0]).toEqual({ conversationId: "conversation_a", job: canonical, cached: canonical });
    });
    expect(result.current.pendingGenerations).toEqual([pending]);
    act(() => {
      const canonical = result.current.updateJob(terminal);
      expect(canonical).toBe(result.current.getJob(pending.id));
      expect(observed[1].cached).toBe(canonical);
    });
    expect(result.current.pendingGenerations).toEqual([]);
    expect(observed.map((item) => item.job.status)).toEqual(["pending", "succeeded"]);
  });

  it.each(["succeeded", "failed"] as const)("does not regress a cached %s job from stale bootstrap, pending, or a different terminal state", (status) => {
    const notify = vi.fn();
    const { result } = renderHook(() => useStudioJobs({ ownerId: "owner_a", onConversationUpdate: notify }));
    act(() => result.current.registerConversation("conversation_a", pending));
    act(() => result.current.updateJob({ ...terminal, status }));
    const canonical = result.current.getJob(pending.id);
    act(() => {
      expect(result.current.registerConversation("conversation_a", { ...pending, updatedAt: "2026-10-05T00:00:00.000Z" })).toBe(canonical);
      expect(result.current.updateJob({ ...terminal, status, updatedAt: "2026-10-02T00:00:00.000Z", images: [] })).toBe(canonical);
      expect(result.current.updateJob({ ...terminal, status: status === "succeeded" ? "failed" : "succeeded" })).toBe(canonical);
      expect(result.current.registerConversation("conversation_a", canonical!)).toBe(canonical);
    });
    expect(result.current.getJob(pending.id)?.images).toEqual(terminal.images);
    expect(result.current.pendingGenerations).toEqual([]);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("treats equivalent DTOs as no-ops and owns a snapshot of incoming media arrays", () => {
    const notify = vi.fn();
    const incoming: GenerationItem = { ...terminal, images: terminal.images.map((image) => ({ ...image })), sourceImageUrls: ["https://media.invalid/source.png"] };
    const { result } = renderHook(() => useStudioJobs({ ownerId: "owner_a", onConversationUpdate: notify }));
    act(() => result.current.registerConversation("conversation_a", incoming));
    const canonical = result.current.getJob(pending.id);
    act(() => {
      expect(result.current.registerConversation("conversation_a", {
        ...incoming, images: incoming.images.map((image) => ({ url: image.url, id: image.id })), sourceImageUrls: [...incoming.sourceImageUrls!],
      })).toBe(canonical);
    });
    expect(notify).toHaveBeenCalledOnce();
    incoming.status = "pending";
    incoming.images[0].url = "https://media.invalid/replaced.png";
    incoming.sourceImageUrls?.push("https://media.invalid/other.png");
    expect(result.current.getJob(pending.id)).toMatchObject({ status: "succeeded", images: terminal.images, sourceImageUrls: ["https://media.invalid/source.png"] });
  });

  it("keeps the first conversation origin immutable even if another workspace registers the same ID", async () => {
    const onConversationUpdate = vi.fn();
    const canvasUpdate = vi.fn();
    const { result } = renderHook(() => useStudioJobs({ ownerId: "owner_a", onConversationUpdate }));
    act(() => {
      result.current.canvasJobs.subscribe(canvasUpdate);
      const canonical = result.current.registerConversation("conversation_a", pending);
      expect(result.current.registerConversation("conversation_b", terminal)).toBe(canonical);
      expect(result.current.canvasJobs.register(canvasOrigin, terminal)).toBe(canonical);
    });
    expect(result.current.pendingGenerations).toEqual([pending]);
    await advance();
    await finish(0);
    expect(onConversationUpdate.mock.calls.map(([id]) => id)).toEqual(["conversation_a", "conversation_a"]);
    expect(canvasUpdate).not.toHaveBeenCalled();
    expect(result.current.getJob(pending.id)).toEqual(terminal);
  });

  it("copies the canvas origin and publishes cache-first to only canvas subscribers", () => {
    const onConversationUpdate = vi.fn();
    const origin = { ...canvasOrigin };
    const observed: Array<{ origin: CanvasJobOrigin; job: GenerationItem; cached: GenerationItem | null }> = [];
    const { result } = renderHook(() => useStudioJobs({ ownerId: "owner_a", onConversationUpdate }));
    act(() => {
      result.current.canvasJobs.subscribe((source, job) => observed.push({ origin: source, job, cached: result.current.canvasJobs.read(job.id) }));
      const canonical = result.current.canvasJobs.register(origin, pending);
      expect(observed[0].cached).toBe(canonical);
      expect(observed[0].job).toBe(canonical);
      expect(Object.isFrozen(observed[0].origin)).toBe(true);
      origin.canvasId = "different_canvas";
      origin.runId = "different_run";
      result.current.updateJob(terminal);
    });
    expect(observed.map((item) => item.origin)).toEqual([canvasOrigin, canvasOrigin]);
    expect(observed[1].cached).toBe(observed[1].job);
    expect(onConversationUpdate).not.toHaveBeenCalled();
    act(() => {
      expect(result.current.canvasJobs.register({ ...canvasOrigin, nodeId: "another_node" }, pending)).toBe(observed[1].job);
      result.current.canvasJobs.register({ ...canvasOrigin, ownerId: "owner_b" }, { ...pending, id: "foreign_job" });
    });
    expect(result.current.getJob("foreign_job")).toBeNull();
    expect(observed).toHaveLength(2);
  });

  it("keeps polling detached canvas jobs and exposes the terminal cache after an unsubscribed deferred response", async () => {
    const listener = vi.fn();
    const { result } = renderHook(() => useStudioJobs({ ownerId: "owner_a" }));
    let unsubscribe = () => {};
    act(() => {
      unsubscribe = result.current.canvasJobs.subscribe(listener);
      result.current.canvasJobs.register(canvasOrigin, pending);
    });
    await advance();
    unsubscribe();
    listener.mockClear();
    expect(reads[0].signal.aborted).toBe(false);
    await finish(0);
    expect(listener).not.toHaveBeenCalled();
    expect(result.current.canvasJobs.read(pending.id)).toEqual(terminal);
    expect(result.current.pendingGenerations).toEqual([]);
    const catchup = vi.fn();
    act(() => {
      result.current.canvasJobs.subscribe(catchup);
      const canonical = result.current.canvasJobs.register(canvasOrigin, { ...pending });
      expect(canonical.status).toBe("succeeded");
      expect(canonical).toBe(result.current.canvasJobs.read(pending.id));
    });
    expect(catchup).not.toHaveBeenCalled();
    await advance(100_000);
    expect(reads).toHaveLength(1);
  });

  it("honors unsubscribe during notification and does not conflate duplicate subscriptions", () => {
    const listener = vi.fn();
    const skipped = vi.fn();
    const { result } = renderHook(() => useStudioJobs({ ownerId: "owner_a" }));
    act(() => {
      let removeSkipped = () => {};
      result.current.canvasJobs.subscribe(() => removeSkipped());
      const first = result.current.canvasJobs.subscribe(listener);
      result.current.canvasJobs.subscribe(listener);
      removeSkipped = result.current.canvasJobs.subscribe(skipped);
      first();
      result.current.canvasJobs.register(canvasOrigin, terminal);
    });
    expect(listener).toHaveBeenCalledOnce();
    expect(skipped).not.toHaveBeenCalled();
  });

  it("uses one known-job poller across renderer and callback changes", async () => {
    const conversationUpdate = vi.fn();
    const canvasUpdate = vi.fn();
    const { result, rerender } = renderHook(({ pane }) => {
      const jobs = useStudioJobs({ ownerId: "owner_a", onConversationUpdate: (id, job) => conversationUpdate(pane, id, job) });
      return jobs;
    }, { initialProps: { pane: "conversation" } });
    const port = result.current.canvasJobs;
    act(() => {
      port.subscribe(canvasUpdate);
      result.current.registerConversation("conversation_a", pending);
      port.register(canvasOrigin, { ...pending, id: "canvas_job", conversationId: null });
      result.current.registerConversation("conversation_a", pending);
    });
    expect(result.current.pendingGenerations).toHaveLength(2);
    await advance();
    expect(reads.map((read) => read.url)).toEqual(["/api/me/generations/job_a", "/api/me/generations/canvas_job"]);
    rerender({ pane: "canvas" });
    expect(result.current.canvasJobs).toBe(port);
    expect(reads.every((read) => !read.signal.aborted)).toBe(true);
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("pageshow"));
    await advance(5_000);
    expect(reads).toHaveLength(2);
    await finish(0);
    await finish(1, { ...terminal, id: "canvas_job", conversationId: null });
    expect(conversationUpdate).toHaveBeenLastCalledWith("canvas", "conversation_a", terminal);
    expect(canvasUpdate).toHaveBeenLastCalledWith(canvasOrigin, expect.objectContaining({ id: "canvas_job", status: "succeeded" }));
    expect(result.current.pendingGenerations).toEqual([]);
    await advance(100_000);
    expect(reads).toHaveLength(2);
  });

  it("invalidates owner ports, subscriptions, cache and deferred polls across owner A -> B -> A", async () => {
    const oldListener = vi.fn();
    const currentListener = vi.fn();
    const { result, rerender } = renderHook(({ ownerId }) => useStudioJobs({ ownerId }), { initialProps: { ownerId: "owner_a" } });
    const oldJobs = result.current;
    act(() => {
      oldJobs.canvasJobs.subscribe(oldListener);
      oldJobs.canvasJobs.register(canvasOrigin, pending);
    });
    await advance();
    oldListener.mockClear();
    rerender({ ownerId: "owner_b" });
    expect(oldJobs.getJob(pending.id)).toBeNull();
    expect(result.current.getJob(pending.id)).toBeNull();
    expect(result.current.pendingGenerations).toEqual([]);
    expect(reads[0].signal.aborted).toBe(true);
    act(() => {
      oldJobs.canvasJobs.subscribe(oldListener);
      oldJobs.canvasJobs.register(canvasOrigin, { ...terminal, id: "stale_registration" });
      result.current.canvasJobs.register({ ...canvasOrigin, ownerId: "owner_b" }, pending);
    });
    await advance();
    rerender({ ownerId: "owner_a" });
    expect(result.current.getJob(pending.id)).toBeNull();
    expect(result.current.getJob("stale_registration")).toBeNull();
    expect(oldJobs.updateJob(terminal)).toBeNull();
    act(() => {
      result.current.canvasJobs.subscribe(currentListener);
      result.current.canvasJobs.register(canvasOrigin, pending);
    });
    await advance();
    currentListener.mockClear();
    expect(reads).toHaveLength(3);
    expect(reads[1].signal.aborted).toBe(true);
    await finish(0);
    await finish(1);
    expect(result.current.getJob(pending.id)?.status).toBe("pending");
    expect(oldListener).not.toHaveBeenCalled();
    expect(currentListener).not.toHaveBeenCalled();
    await finish(2);
    expect(currentListener).toHaveBeenCalledOnce();
    expect(result.current.getJob(pending.id)).toEqual(terminal);
    expect(oldJobs.canvasJobs.read(pending.id)).toBeNull();
  });

  it("does not retain StrictMode's discarded subscription or deliver an unmounted poll", async () => {
    const subscriptions: ReturnType<typeof vi.fn>[] = [];
    const { result, unmount } = renderHook(() => {
      const jobs = useStudioJobs({ ownerId: "owner_a" });
      useEffect(() => {
        const listener = vi.fn();
        subscriptions.push(listener);
        const unsubscribe = jobs.canvasJobs.subscribe(listener);
        jobs.canvasJobs.register(canvasOrigin, pending);
        return unsubscribe;
      }, [jobs.canvasJobs]);
      return jobs;
    }, { reactStrictMode: true });
    expect(subscriptions).toHaveLength(2);
    for (const listener of subscriptions) listener.mockClear();
    await advance();
    await finish(0);
    expect(subscriptions[0]).not.toHaveBeenCalled();
    expect(subscriptions[1]).toHaveBeenCalledWith(canvasOrigin, terminal);
    act(() => result.current.canvasJobs.register({ ...canvasOrigin, runId: "next_run" }, { ...pending, id: "next_job" }));
    await advance();
    const api = result.current;
    unmount();
    expect(reads[1].signal.aborted).toBe(true);
    const notified = subscriptions[1].mock.calls.length;
    await finish(1, { ...terminal, id: "next_job" });
    expect(subscriptions[1]).toHaveBeenCalledTimes(notified);
    expect(api.getJob(pending.id)).toBeNull();
    expect(api.updateJob(terminal)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("captured conversation membership", () => {
  const session = (id: string): SessionInfo => ({ id, title: id, generationIds: [], generationCount: 0, createdAt: pending.createdAt });

  function useScopedJobs() {
    const content = useConversationGenerations({
      ownerId: "owner_a", initialConversations: [session("conversation_a"), session("conversation_b")],
    });
    const jobs = useStudioJobs({ ownerId: "owner_a", onConversationUpdate: (_id, job) => content.updateGeneration(job) });
    return { content, jobs };
  }

  it("merges an A response while B is selected without projecting A into B", async () => {
    const { result } = renderHook(() => useScopedJobs());
    act(() => {
      result.current.content.selectConversation("conversation_b");
      const canonical = result.current.jobs.registerConversation("conversation_a", pending);
      result.current.content.acceptGeneration("conversation_a", canonical);
    });
    expect(result.current.content.generations).toEqual([]);
    await advance();
    await finish(0);
    expect(result.current.content.conversationId).toBe("conversation_b");
    expect(result.current.content.generations).toEqual([]);
    expect(result.current.jobs.getJob(pending.id)).toEqual(terminal);
    act(() => result.current.content.selectConversation("conversation_a"));
    expect(result.current.content.generations).toEqual([terminal]);
    expect(reads.map((read) => read.url)).toEqual(["/api/me/generations/job_a"]);
  });

  it("deletes only the attachment, not the accepted job or its pending poll", async () => {
    const { result } = renderHook(() => useScopedJobs());
    act(() => {
      result.current.content.selectConversation("conversation_a");
      const canonical = result.current.jobs.registerConversation("conversation_a", pending);
      result.current.content.acceptGeneration("conversation_a", canonical);
    });
    await advance();
    act(() => result.current.content.forgetConversation("conversation_a"));
    expect(result.current.content.generations).toEqual([]);
    expect(result.current.jobs.pendingGenerations).toEqual([pending]);
    expect(reads[0].signal.aborted).toBe(false);
    await finish(0, { ...terminal, conversationId: null });
    expect(result.current.jobs.getJob(pending.id)).toMatchObject({ status: "succeeded", conversationId: null });
    act(() => result.current.content.selectConversation("conversation_a"));
    expect(result.current.content.conversationId).toBeNull();
    expect(result.current.content.generations).toEqual([]);
    expect(reads.map((read) => read.url)).toEqual(["/api/me/generations/job_a"]);
  });
});
