import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";

const { router } = vi.hoisted(() => ({ router: { push: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { FeaturedGallery } from "@/components/marketing/featured-gallery";
import { GALLERY_MESSAGES, GALLERY_REQUEST_TIMEOUT_MS } from "@/components/marketing/homepage/gallery-constants";
import { useWorkLike } from "@/components/marketing/homepage/hooks/use-work-like";

import { createGalleryWork, deferred, galleryCursor, galleryPage, galleryWorks, jsonResponse } from "./helpers/gallery-fixtures";

beforeEach(() => {
  router.push.mockReset();
  vi.stubGlobal("fetch", vi.fn());
  vi.stubGlobal("IntersectionObserver", undefined);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("real gallery like command", () => {
  it("serializes each work independently and applies only acknowledged server counts", async () => {
    const a = deferred<ReturnType<typeof jsonResponse>>();
    const b = deferred<ReturnType<typeof jsonResponse>>();
    vi.mocked(fetch).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const { result } = renderHook(() => ({
      a: useWorkLike(createGalleryWork("a", { likeCount: 3 })),
      b: useWorkLike(createGalleryWork("b", { likeCount: 8, likedByMe: true })),
    }));
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.a.toggleLike();
      void result.current.a.toggleLike();
      second = result.current.b.toggleLike();
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.current.a.likeCount).toBe(3);
    expect(result.current.a.likedByMe).toBe(false);
    expect(result.current.a.pending).toBe(true);
    await act(async () => {
      a.resolve(jsonResponse({ data: { likeCount: 6, liked: true } }));
      b.resolve(jsonResponse({ data: { likeCount: 7, liked: false } }));
      await Promise.all([first, second]);
    });
    expect(result.current.a).toMatchObject({ likeCount: 6, likedByMe: true, pending: false });
    expect(result.current.b).toMatchObject({ likeCount: 7, likedByMe: false, pending: false });
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/works/a/like");
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ method: "PUT", credentials: "same-origin" });
  });

  it("redirects a real 401 to bare login without changing the previous like state", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(null, 401));
    const { result } = renderHook(() => useWorkLike(createGalleryWork("work_1", { likeCount: 4, likedByMe: true })));
    await act(async () => result.current.toggleLike());
    expect(router.push).toHaveBeenCalledWith("/login");
    expect(result.current).toMatchObject({ likeCount: 4, likedByMe: true, pending: false });
  });

  it.each([
    ["negative count", { data: { likeCount: -1, liked: false } }],
    ["fractional count", { data: { likeCount: 1.5, liked: false } }],
    ["string count", { data: { likeCount: "10", liked: false } }],
    ["invalid boolean", { data: { likeCount: 10, liked: "yes" } }],
    ["missing envelope", { likeCount: 10, liked: true }],
  ])("preserves the previous value with visible uncertainty for %s", async (_label, body) => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(body));
    render(<FeaturedGallery works={[createGalleryWork("work_1", { likeCount: 9, likedByMe: true })]} />);
    fireEvent.click(screen.getByRole("button", { name: "取消点赞 title-work_1" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(GALLERY_MESSAGES.likeUnconfirmed));
    expect(screen.getByRole("button", { name: "取消点赞 title-work_1" })).toHaveTextContent("9");
    expect(screen.getByRole("button", { name: "取消点赞 title-work_1" })).toHaveAttribute("aria-pressed", "true");
  });

  it("preserves old state on a rejected response and permits an explicit retry", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(null, 503)).mockResolvedValueOnce(jsonResponse({ data: { likeCount: 4, liked: true } }));
    render(<FeaturedGallery works={[createGalleryWork("work_1", { likeCount: 3 })]} />);
    fireEvent.click(screen.getByRole("button", { name: "点赞 title-work_1" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(GALLERY_MESSAGES.likeError));
    expect(screen.getByRole("button", { name: "点赞 title-work_1" })).toHaveTextContent("3");
    fireEvent.click(screen.getByRole("button", { name: "点赞 title-work_1" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "取消点赞 title-work_1" })).toHaveTextContent("4"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each(["fetch", "json"])("bounds a stuck %s and refuses late results after retry", async (stage) => {
    vi.useFakeTimers();
    const late = deferred<unknown>();
    if (stage === "fetch") vi.mocked(fetch).mockReturnValueOnce(late.promise as Promise<Response>);
    else vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(late.promise));
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ data: { likeCount: 2, liked: true } }));
    const { result } = renderHook(() => useWorkLike(createGalleryWork("work_1", { likeCount: 1 })));
    let pending!: Promise<void>;
    await act(async () => { pending = result.current.toggleLike(); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(GALLERY_REQUEST_TIMEOUT_MS); await pending; });
    expect(result.current).toMatchObject({ pending: false, likeCount: 1, likedByMe: false, error: GALLERY_MESSAGES.likeTimeout });
    await act(async () => result.current.toggleLike());
    const stale = { data: { likeCount: 99, liked: false } };
    await act(async () => { late.resolve(stage === "fetch" ? jsonResponse(stale) : stale); await late.promise; });
    expect(result.current).toMatchObject({ likeCount: 2, likedByMe: true, error: null });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("settles on unmount and rejects a late old viewer 401", async () => {
    vi.useFakeTimers();
    const late = deferred<ReturnType<typeof jsonResponse>>();
    vi.mocked(fetch).mockReturnValueOnce(late.promise);
    const { result, unmount } = renderHook(() => useWorkLike(createGalleryWork("work_1")), { wrapper: StrictMode });
    let pending!: Promise<void>;
    act(() => { pending = result.current.toggleLike(); });
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    unmount();
    await act(async () => pending);
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => { late.resolve(jsonResponse(null, 401)); await late.promise; });
    expect(router.push).not.toHaveBeenCalled();
  });

  it("settles a stalled response body on unmount without changing a newly mounted viewer", async () => {
    vi.useFakeTimers();
    const late = deferred<unknown>();
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(late.promise));
    const previous = renderHook(() => useWorkLike(createGalleryWork("work_1", { likeCount: 3 })));
    let pending!: Promise<void>;
    await act(async () => { pending = previous.result.current.toggleLike(); await Promise.resolve(); });
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    previous.unmount();
    await act(async () => pending);
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    const current = renderHook(() => useWorkLike(createGalleryWork("work_1", { likeCount: 5, likedByMe: true })));
    await act(async () => {
      late.resolve({ data: { likeCount: 99, liked: false } });
      await late.promise;
    });
    expect(current.result.current).toMatchObject({ likeCount: 5, likedByMe: true, pending: false, error: null });
    expect(router.push).not.toHaveBeenCalled();
  });

  it("retains appended cards and local likes on same-viewer refresh but resets on an actual viewer key", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(galleryPage(galleryWorks(17))))
      .mockResolvedValueOnce(jsonResponse({ data: { likeCount: 21, liked: true } }));
    const { rerender } = render(<FeaturedGallery key="viewer-a" works={galleryWorks(1)} initialHasMore initialNextCursor={galleryCursor(1)} isAuthenticated />);
    fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
    await waitFor(() => expect(screen.getAllByRole("link", { name: /^查看作品/ })).toHaveLength(32));
    fireEvent.click(screen.getByRole("button", { name: "点赞 title-work_1" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "取消点赞 title-work_1" })).toHaveTextContent("21"));
    rerender(<FeaturedGallery key="viewer-a" works={galleryWorks(1)} isAuthenticated />);
    expect(screen.getAllByRole("link", { name: /^查看作品/ })).toHaveLength(32);
    expect(screen.getByRole("button", { name: "取消点赞 title-work_1" })).toHaveTextContent("21");
    rerender(<FeaturedGallery key="viewer-b" works={galleryWorks(1)} isAuthenticated />);
    expect(screen.getAllByRole("link", { name: /^查看作品/ })).toHaveLength(16);
    expect(screen.getByRole("button", { name: "点赞 title-work_1" })).toHaveTextContent("0");
  });
});
