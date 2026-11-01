import { render } from "@testing-library/react";
import type { ComponentProps } from "react";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  findMany: vi.fn(),
  gallery: vi.fn(),
}));

vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(callback: T) => callback,
}));
vi.mock("@/lib/db", () => ({
  db: { generationImage: { findMany: mocks.findMany } },
}));
vi.mock("@/lib/server/current-user", () => ({ getCurrentUserRecord: mocks.currentUser }));
vi.mock("@/components/marketing/site-header", () => ({ SiteHeader: () => null }));
vi.mock("@/components/marketing/featured-gallery", () => ({ FeaturedGallery: mocks.gallery }));

import Home from "@/app/page";
import { GET } from "@/app/api/works/featured/route";
import type { FeaturedGallery } from "@/components/marketing/featured-gallery";

import {
  createPrivacyUser,
  createPrivacyWork,
  workPrivacySentinels,
} from "./helpers/work-privacy-fixtures";

const publicFeaturedKeys = [
  "authorAvatar",
  "authorName",
  "featuredAt",
  "id",
  "image",
  "likeCount",
  "likedByMe",
  "prompt",
  "showPromptPublic",
  "size",
  "title",
].sort();

beforeEach(() => {
  vi.resetAllMocks();
  mocks.currentUser.mockResolvedValue(null);
  mocks.gallery.mockReturnValue(null);
});

describe.each([
  { label: "anonymous", user: null },
  { label: "author visiting public feed", user: createPrivacyUser(workPrivacySentinels.ownerId) },
  { label: "other signed-in viewer", user: createPrivacyUser("other_viewer") },
])("featured transfer parity: $label", ({ user }) => {
  it.each([false, true])("keeps the same public allowlist and permission in Home and API: %s", async (showPromptPublic) => {
    mocks.currentUser.mockResolvedValue(user);
    const rawWork = createPrivacyWork({ showPromptPublic });
    mocks.findMany.mockResolvedValue([rawWork]);

    render(await Home());
    const galleryProps = mocks.gallery.mock.calls.at(-1)![0] as ComponentProps<typeof FeaturedGallery>;
    const initialWork = galleryProps.works[0];
    const response = await GET(new Request("https://homepage.unit.invalid/api/works/featured?limit=16"));
    const apiPage = await response.json();

    expect(response.status).toBe(200);
    expect(apiPage.items).toEqual([initialWork]);
    expect(Object.keys(initialWork).sort()).toEqual(publicFeaturedKeys);
    expect(initialWork).toHaveProperty("showPromptPublic", showPromptPublic);
    expect(initialWork.prompt).toBe(showPromptPublic ? workPrivacySentinels.prompt : "作者未公开提示词");
    const transferred = JSON.stringify({ initialWork, apiPage });
    for (const sentinel of [
      workPrivacySentinels.negativePrompt.split("\n")[0],
      workPrivacySentinels.reviewNote,
      workPrivacySentinels.reviewerEmail,
      workPrivacySentinels.reviewerId,
      workPrivacySentinels.authorEmail,
      workPrivacySentinels.jobId,
      workPrivacySentinels.ownerId,
    ]) {
      expect(transferred).not.toContain(sentinel);
    }
    if (!showPromptPublic) {
      expect(transferred).not.toContain(workPrivacySentinels.prompt.split("\n")[0]);
    }
    expect(response.headers.get("Cache-Control")).toBe(user
      ? "private, no-store"
      : "public, s-maxage=60, stale-while-revalidate=120");
    for (const [query] of mocks.findMany.mock.calls) {
      expect(query.take).toBe(17);
      expect(query.where.showcaseStatus).toBe("FEATURED");
      expect(query.include.likes).toEqual(user
        ? { where: { userId: user.id }, select: { userId: true }, take: 1 }
        : undefined);
    }
  });
});
