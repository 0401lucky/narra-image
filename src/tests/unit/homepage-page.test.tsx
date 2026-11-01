import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";

const mocks = vi.hoisted(() => ({ currentUser: vi.fn(), feed: vi.fn(), gallery: vi.fn(), header: vi.fn(), cache: vi.fn() }));
vi.mock("next/cache", () => ({ unstable_cache: <T extends (...args: never[]) => unknown>(callback: T, keys: string[], options: unknown) => { mocks.cache(keys, options); return callback; } }));
vi.mock("@/lib/server/current-user", () => ({ getCurrentUserRecord: mocks.currentUser }));
vi.mock("@/lib/server/works", () => ({ listFeaturedWorksPage: mocks.feed }));
vi.mock("@/components/marketing/site-header", () => ({ SiteHeader: mocks.header }));
vi.mock("@/components/marketing/featured-gallery", () => ({ FeaturedGallery: mocks.gallery }));
vi.mock("@/components/marketing/homepage/home-hero", () => ({ HomeHero: () => <section id="hero">固定三场景</section> }));
vi.mock("@/components/marketing/homepage/capability-section", () => ({ CapabilitySection: () => <section id="capabilities" /> }));
vi.mock("@/components/marketing/homepage/home-motion-provider", () => ({ HomeMotionProvider: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/marketing/homepage/home-reveal", () => ({ HomeReveal: ({ children, id }: { children: ReactNode; id?: string }) => <section id={id}>{children}</section> }));

import Home, { dynamic } from "@/app/page";
import type { FeaturedGallery } from "@/components/marketing/featured-gallery";
import { createPrivacyUser } from "./helpers/work-privacy-fixtures";

beforeEach(() => {
  mocks.currentUser.mockResolvedValue(null);
  mocks.feed.mockResolvedValue({ items: [], hasMore: false, nextCursor: null });
  mocks.header.mockReturnValue(null);
  mocks.gallery.mockReturnValue(null);
});
afterEach(() => { cleanup(); mocks.currentUser.mockReset(); mocks.feed.mockReset(); mocks.gallery.mockReset(); mocks.header.mockReset(); vi.restoreAllMocks(); });

describe("Home server bootstrap", () => {
  it("keeps dynamic rendering and the anonymous 60-second tagged cache", async () => {
    expect(dynamic).toBe("force-dynamic");
    expect(mocks.cache).toHaveBeenCalledWith(["featured-home-anonymous"], { revalidate: 60, tags: ["featured-works"] });
    render(await Home());
    expect(mocks.feed).toHaveBeenCalledWith({ limit: 16 });
    const props = mocks.gallery.mock.calls.at(-1)![0] as ComponentProps<typeof FeaturedGallery>;
    expect(props).toMatchObject({ works: [], initialError: false, isAuthenticated: false });
    expect(screen.getByText("固定三场景")).toBeInTheDocument();
  });

  it("uses uncached viewer-qualified data and an explicit home header for a signed-in account", async () => {
    mocks.currentUser.mockResolvedValue(createPrivacyUser("viewer-next"));
    render(await Home());
    expect(mocks.feed).toHaveBeenCalledWith({ limit: 16, viewerId: "viewer-next" });
    expect(mocks.gallery.mock.calls.at(-1)![0]).toMatchObject({ isAuthenticated: true });
    expect(mocks.header.mock.calls.at(-1)![0]).toMatchObject({ variant: "home", activeHref: "/", currentUser: { id: "viewer-next" } });
  });

  it("distinguishes a failed first page from a truly empty feed without replacing the fixed hero", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.feed.mockRejectedValue(new Error("synthetic unavailable"));
    const { container } = render(await Home());
    expect(mocks.gallery.mock.calls.at(-1)![0]).toMatchObject({ works: [], initialError: true });
    for (const id of ["hero", "capabilities", "gallery", "footer"]) expect(container.querySelector(`#${id}`)).not.toBeNull();
    expect(screen.getByText("固定三场景")).toBeInTheDocument();
  });

  it("retains guest fallback when account lookup fails without querying a previous viewer", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.currentUser.mockRejectedValue(new Error("synthetic auth unavailable"));
    render(await Home());
    expect(mocks.feed).toHaveBeenCalledWith({ limit: 16 });
    expect(mocks.header.mock.calls.at(-1)![0]).toMatchObject({ currentUser: null });
  });
});
