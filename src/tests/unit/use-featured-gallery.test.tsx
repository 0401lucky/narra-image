import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode, startTransition } from "react";

import { useFeaturedGallery } from "@/components/marketing/homepage/hooks/use-featured-gallery";
import { GALLERY_MESSAGES, GALLERY_REQUEST_TIMEOUT_MS } from "@/components/marketing/homepage/gallery-constants";

import { createGalleryWork, deferred, galleryCursor, galleryPage, galleryWorks, jsonResponse } from "./helpers/gallery-fixtures";

beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function renderGallery() {
  return renderHook(() => useFeaturedGallery({ works: galleryWorks(1), initialHasMore: true, initialNextCursor: galleryCursor(1) }));
}

describe("featured page command", () => {
  it("coalesces observer/manual/same-tick commands with a synchronous lock", async () => {
    const pending = deferred<ReturnType<typeof jsonResponse>>();
    vi.mocked(fetch).mockReturnValue(pending.promise);
    const { result } = renderGallery();
    let first!: Promise<void>;
    act(() => {
      first = result.current.loadMore("auto");
      void result.current.loadMore("manual");
      void result.current.loadMore("auto");
    });
    expect(result.current.isLoading).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve(jsonResponse(galleryPage([createGalleryWork("work_16"), createGalleryWork("work_17")])));
      await first;
    });
    expect(result.current.items.map((work) => work.id)).toEqual(galleryWorks(1, 17).map((work) => work.id));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.canLoadMore).toBe(false);
  });

  it("advances the authoritative cursor before React commits even in a deferred transition", async () => {
    const first = deferred<ReturnType<typeof jsonResponse>>();
    const second = deferred<ReturnType<typeof jsonResponse>>();
    vi.mocked(fetch).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderGallery();
    const load = result.current.loadMore;
    await act(async () => {
      let firstCommand!: Promise<void>;
      startTransition(() => { firstCommand = load(); });
      first.resolve(jsonResponse(galleryPage(galleryWorks(17), galleryCursor(2))));
      await firstCommand;
      // This callback still has the pre-commit closure; it must use the command snapshot.
      const secondCommand = load("auto");
      const url = String(vi.mocked(fetch).mock.calls[1][0]);
      expect(new URL(url, "https://unit.invalid").searchParams.get("cursor")).toBe(galleryCursor(2));
      second.resolve(jsonResponse(galleryPage(galleryWorks(33))));
      await secondCommand;
    });
    expect(result.current.items).toHaveLength(48);
    expect(result.current.nextCursor).toBeNull();
  });

  it("loads 16 -> 32 -> 48 -> 64 -> 72 unique works and never calls the next page at the cap", async () => {
    vi.mocked(fetch).mockImplementation(async () => jsonResponse(galleryPage(galleryWorks(1 + vi.mocked(fetch).mock.calls.length * 16), galleryCursor(vi.mocked(fetch).mock.calls.length + 1))));
    const { result } = renderGallery();
    for (const count of [32, 48, 64, 72]) {
      await act(async () => result.current.loadMore());
      expect(result.current.items).toHaveLength(count);
      expect(new Set(result.current.items.map((work) => work.id)).size).toBe(count);
    }
    await act(async () => { await result.current.loadMore(); await result.current.loadMore("auto"); });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(result.current.atLimit).toBe(true);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.canLoadMore).toBe(false);
    for (const [url] of vi.mocked(fetch).mock.calls) expect(new URL(String(url), "https://unit.invalid").searchParams.get("limit")).toBe("16");
  });

  it("deduplicates and clamps the bootstrap as well as appended pages", () => {
    const { result } = renderHook(() => useFeaturedGallery({ works: [createGalleryWork("work_1"), ...galleryWorks(1, 90)] }));
    expect(result.current.items).toHaveLength(72);
    expect(result.current.items.at(-1)?.id).toBe("work_72");
  });

  it("retains the local list/cursor across same-viewer fresh props", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(galleryPage(galleryWorks(17), galleryCursor(2))));
    const { result, rerender } = renderHook((options) => useFeaturedGallery(options), {
      initialProps: { works: galleryWorks(1), initialHasMore: true, initialNextCursor: galleryCursor(1) },
    });
    await act(async () => result.current.loadMore());
    rerender({ works: galleryWorks(200), initialHasMore: false, initialNextCursor: galleryCursor(99) });
    expect(result.current.items[0].id).toBe("work_1");
    expect(result.current.items).toHaveLength(32);
    expect(result.current.nextCursor).toBe(galleryCursor(2));
  });

  it("suspends a duplicate-only auto page, then permits explicit progress on its valid next cursor", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(galleryPage(galleryWorks(1), galleryCursor(2))))
      .mockResolvedValueOnce(jsonResponse(galleryPage(galleryWorks(17))));
    const { result } = renderGallery();
    await act(async () => result.current.loadMore("auto"));
    expect(result.current.items).toHaveLength(16);
    expect(result.current.autoPaused).toBe(true);
    await act(async () => { for (let i = 0; i < 20; i++) await result.current.loadMore("auto"); });
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => result.current.loadMore());
    expect(result.current.items).toHaveLength(32);
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toContain(encodeURIComponent(galleryCursor(2)));
  });

  it.each([
    ["missing envelope", null],
    ["missing items", { hasMore: false, nextCursor: null }],
    ["bad item", galleryPage([{ id: "bad" }] as never[])],
    ["bad boolean", { ...galleryPage(), hasMore: "false" }],
    ["missing cursor", { hasMore: true, items: galleryWorks(17) }],
    ["blank cursor", { hasMore: true, items: galleryWorks(17), nextCursor: "" }],
    ["malformed cursor", galleryPage(galleryWorks(17), "bad cursor/#")],
    ["inconsistent cursor", { ...galleryPage(), nextCursor: galleryCursor(2) }],
    ["oversized page", galleryPage(galleryWorks(17, 17))],
    ["non-advancing cursor", galleryPage(galleryWorks(17), galleryCursor(1))],
  ])("preserves loaded items and the retry cursor for %s", async (_label, payload) => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(payload)).mockResolvedValueOnce(jsonResponse(galleryPage(galleryWorks(17))));
    const { result } = renderGallery();
    await act(async () => result.current.loadMore());
    expect(result.current.items).toHaveLength(16);
    expect(result.current.error).toBeTruthy();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.nextCursor).toBe(galleryCursor(1));
    await act(async () => result.current.loadMore("auto"));
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => result.current.loadMore());
    expect(result.current.error).toBeNull();
    expect(result.current.items).toHaveLength(32);
    expect(vi.mocked(fetch).mock.calls[1][0]).toBe(vi.mocked(fetch).mock.calls[0][0]);
  });

  it("rejects cycling back to a previously consumed cursor", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(galleryPage(galleryWorks(17), galleryCursor(2))))
      .mockResolvedValueOnce(jsonResponse(galleryPage(galleryWorks(33), galleryCursor(1))));
    const { result } = renderGallery();
    await act(async () => result.current.loadMore());
    await act(async () => result.current.loadMore());
    expect(result.current.items).toHaveLength(32);
    expect(result.current.error).toBe(GALLERY_MESSAGES.cursorError);
    expect(result.current.nextCursor).toBe(galleryCursor(2));
  });

  it.each(["http", "network", "json"])("releases the lock after %s failure and retries exactly that page", async (kind) => {
    if (kind === "http") vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(null, 503));
    if (kind === "network") vi.mocked(fetch).mockRejectedValueOnce(new TypeError("offline"));
    if (kind === "json") {
      const response = jsonResponse(null);
      response.json.mockRejectedValueOnce(new SyntaxError("bad json"));
      vi.mocked(fetch).mockResolvedValueOnce(response);
    }
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(galleryPage(galleryWorks(17))));
    const { result } = renderGallery();
    await act(async () => result.current.loadMore());
    expect(result.current.error).toBeTruthy();
    expect(result.current.items).toHaveLength(16);
    await act(async () => result.current.loadMore());
    expect(result.current.error).toBeNull();
    expect(result.current.items).toHaveLength(32);
  });

  it.each(["fetch", "json"])("bounds stalled %s, ignores late old data, and permits retry", async (stage) => {
    vi.useFakeTimers();
    const late = deferred<unknown>();
    const lateResponse = jsonResponse(galleryPage([createGalleryWork("late")], galleryCursor(9)));
    if (stage === "fetch") vi.mocked(fetch).mockReturnValueOnce(late.promise as Promise<Response>);
    else vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(late.promise));
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(galleryPage(galleryWorks(17))));
    const { result } = renderGallery();
    let command!: Promise<void>;
    await act(async () => { command = result.current.loadMore(); await Promise.resolve(); });
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    await act(async () => { await vi.advanceTimersByTimeAsync(GALLERY_REQUEST_TIMEOUT_MS); await command; });
    expect(signal?.aborted).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe(GALLERY_MESSAGES.pageTimeout);
    await act(async () => result.current.loadMore());
    expect(result.current.items).toHaveLength(32);
    await act(async () => { late.resolve(stage === "fetch" ? lateResponse : galleryPage([createGalleryWork("late")])); await late.promise; });
    expect(result.current.items.some((work) => work.id === "late")).toBe(false);
    expect(result.current.error).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["fetch", "json"])("unmount settles ignored-abort %s without publishing into a new viewer", async (stage) => {
    vi.useFakeTimers();
    const pending = deferred<unknown>();
    if (stage === "fetch") vi.mocked(fetch).mockReturnValueOnce(pending.promise as Promise<Response>);
    else vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(pending.promise));
    const old = renderGallery();
    let request!: Promise<void>;
    await act(async () => { request = old.result.current.loadMore(); await Promise.resolve(); });
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    old.unmount();
    await act(async () => request);
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    const fresh = renderHook(() => useFeaturedGallery({ works: [createGalleryWork("new-viewer")] }));
    await act(async () => { pending.resolve(stage === "fetch" ? jsonResponse(galleryPage()) : galleryPage()); await pending.promise; });
    expect(fresh.result.current.items.map((work) => work.id)).toEqual(["new-viewer"]);
  });

  it("supports a fresh first-page retry and an empty successful result in Strict Mode", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(galleryPage([])));
    const { result } = renderHook(() => useFeaturedGallery({ works: [], initialError: true }), { wrapper: StrictMode });
    await act(async () => result.current.loadMore("auto"));
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => result.current.loadMore());
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/works/featured?limit=16");
    expect(result.current.items).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.needsBootstrap).toBe(false);
    expect(result.current.canLoadMore).toBe(false);
  });
});
