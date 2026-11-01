import type { SerializedFeaturedWork } from "@/lib/prisma-mappers";

export function createGalleryWork(id: string, overrides: Partial<SerializedFeaturedWork> = {}): SerializedFeaturedWork {
  return {
    authorAvatar: null,
    authorName: `作者-${id}`,
    featuredAt: "2026-10-30T10:00:00.000Z",
    id,
    image: `https://images.example.invalid/${id}.png`,
    likeCount: 0,
    likedByMe: false,
    prompt: `public prompt ${id}`,
    showPromptPublic: true,
    size: "1024x1024",
    title: `title-${id}`,
    ...overrides,
  };
}

export function galleryWorks(start: number, count = 16) {
  return Array.from({ length: count }, (_, index) => createGalleryWork(`work_${start + index}`));
}

export function galleryCursor(page: number) {
  return Buffer.from(JSON.stringify({ featuredAt: "2026-10-30T10:00:00.000Z", id: `page_${page}` })).toString("base64url");
}

export function galleryPage(items = galleryWorks(17), nextCursor: string | null = null) {
  return { items, hasMore: nextCursor !== null, nextCursor };
}

export function jsonResponse(payload: unknown, status = 200): Response & { json: ReturnType<typeof vi.fn> } {
  return Object.assign(new Response(null, { status }), { json: vi.fn().mockResolvedValue(payload) });
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

export function installGalleryObserver() {
  const observers: Array<{ target: Element | null; disconnect: ReturnType<typeof vi.fn>; trigger: (intersecting?: boolean) => void }> = [];
  class Observer {
    target: Element | null = null;
    disconnect = vi.fn();
    constructor(private callback: IntersectionObserverCallback) { observers.push(this); }
    observe(target: Element) { this.target = target; }
    unobserve() {}
    trigger(intersecting = true) {
      this.callback([{ target: this.target, isIntersecting: intersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
  }
  vi.stubGlobal("IntersectionObserver", Observer);
  return {
    observers,
    sentinel: () => observers.filter((observer) => observer.target?.hasAttribute("data-gallery-sentinel")).at(-1)!,
  };
}
