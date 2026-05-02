import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FeaturedGallery } from "@/components/marketing/featured-gallery";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

function createWork(id: string) {
  return {
    authorAvatar: null,
    authorName: `作者-${id}`,
    featuredAt: "2026-04-25T10:00:00.000Z",
    id,
    image: `https://example.com/${id}.png`,
    likeCount: 0,
    likedByMe: false,
    prompt: `prompt-${id}`,
    size: "1024x1024",
    title: `title-${id}`,
  };
}

describe("首页精选瀑布流", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("触底后拉取下一页，并对重复作品去重", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        hasMore: false,
        items: [createWork("work_24"), createWork("work_25")],
        nextCursor: "cursor_2",
      }),
      ok: true,
    });

    const observerEntries: Array<{
      disconnect: ReturnType<typeof vi.fn>;
      observe: ReturnType<typeof vi.fn>;
      trigger: () => void;
    }> = [];

    vi.stubGlobal("fetch", fetchMock);
    function MockIntersectionObserver(callback: IntersectionObserverCallback) {
      const instance = {
        disconnect: vi.fn(),
        observe: vi.fn(),
        trigger: () =>
          callback(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            instance as unknown as IntersectionObserver,
          ),
      };
      observerEntries.push(instance);
      return instance;
    }

    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

    render(
      <FeaturedGallery
        initialHasMore
        initialNextCursor="cursor_1"
        works={Array.from({ length: 24 }, (_, index) => createWork(`work_${index + 1}`))}
      />,
    );

    expect(screen.getAllByRole("link")).toHaveLength(24);
    await waitFor(() => {
      expect(observerEntries).toHaveLength(1);
    });

    await act(async () => {
      observerEntries[0]?.trigger();
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/works/featured?cursor=cursor_1&limit=16");
    });

    expect(screen.getAllByRole("link")).toHaveLength(25);
    expect(screen.getByRole("link", { name: /title-work_25/i })).toBeInTheDocument();
  }, 20000);
});
