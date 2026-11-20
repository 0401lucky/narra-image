import { render } from "@testing-library/react";
import type { ComponentProps } from "react";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  studioGenerations: vi.fn(),
  provider: vi.fn(),
  studio: vi.fn(),
  stale: vi.fn(),
  redirect: vi.fn(),
  env: vi.fn(),
}));
vi.mock("@/lib/server/current-user", () => ({ getCurrentUserRecord: mocks.user }));
vi.mock("@/lib/server/studio-generations", () => ({
  listStudioGenerations: mocks.studioGenerations,
}));
vi.mock("@/lib/db", () => ({ db: { savedProviderConfig: { findUnique: mocks.provider } } }));
vi.mock("@/lib/env", () => ({ getEnv: mocks.env }));
vi.mock("@/lib/generation/job-refund", () => ({ failStalePendingGenerationJobs: mocks.stale }));
vi.mock("@/lib/benefits/config", () => ({ getCheckInSummary: async () => ({ checkInReward: 50, checkedInToday: false }) }));
vi.mock("@/lib/auth/turnstile", () => ({ getPublicTurnstileConfig: async () => ({ isEnabled: false, siteKey: null, protectGenerate: false }) }));
vi.mock("@/lib/providers/built-in-provider", () => ({ getActiveChannels: async () => [] }));
vi.mock("@/components/create/generator-studio", () => ({ GeneratorStudio: mocks.studio }));
vi.mock("@/components/marketing/site-header", () => ({ SiteHeader: () => null }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import CreatePage from "@/app/create/page";
import type { GeneratorStudio } from "@/components/create/generator-studio";
import { conversationGeneration } from "./helpers/conversation-fixtures";

const ownerId = "owner_fixture";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.env.mockReturnValue({ CANVAS_ENABLED: true });
  mocks.user.mockResolvedValue({
    id: ownerId,
    credits: 500,
    role: "USER",
    email: "fixture@unit.invalid",
    nickname: "Fixture",
    avatarUrl: null,
    oauthProvider: null,
  });
  mocks.provider.mockResolvedValue(null);
  mocks.studio.mockReturnValue(null);
  mocks.studioGenerations.mockResolvedValue({
    generations: [conversationGeneration("initial_job")],
    hasMore: true,
    nextCursor: "older_page_cursor",
  });
  mocks.redirect.mockImplementation(() => {
    throw new Error("redirected");
  });
});

function studioProps() {
  return mocks.studio.mock.calls.at(-1)![0] as ComponentProps<typeof GeneratorStudio>;
}

describe("create page workbench bootstrap", () => {
  it("loads bounded flat image generation records for the current owner", async () => {
    render(await CreatePage({ searchParams: { prompt: "Seed workbench prompt" } }));
    expect(mocks.studioGenerations).toHaveBeenCalledExactlyOnceWith({ ownerId });
    const props = studioProps();
    expect(props.ownerId).toBe(ownerId);
    expect(props.canvasEnabled).toBe(true);
    expect(props.initialPrompt).toBe("Seed workbench prompt");
    expect(props.initialGenerations).toEqual([conversationGeneration("initial_job")]);
    expect(props.initialHasMore).toBe(true);
    expect(props.initialNextCursor).toBe("older_page_cursor");
    expect(mocks.stale).toHaveBeenCalledWith({ userId: ownerId });
  });

  it("passes the staged-off canvas flag without changing workbench bootstrap", async () => {
    mocks.env.mockReturnValue({ CANVAS_ENABLED: false });
    render(await CreatePage({}));
    expect(studioProps().canvasEnabled).toBe(false);
    expect(studioProps().initialGenerations).toHaveLength(1);
  });

  it("passes empty initial list when user has no visible image records", async () => {
    mocks.studioGenerations.mockResolvedValue({ generations: [], hasMore: false, nextCursor: null });
    render(await CreatePage({}));
    expect(studioProps().initialGenerations).toEqual([]);
    expect(studioProps().initialHasMore).toBe(false);
    expect(studioProps().initialNextCursor).toBeNull();
  });

  it("does not mask loader failures as an empty bootstrap", async () => {
    mocks.studioGenerations.mockRejectedValue(new Error("unavailable"));
    await expect(CreatePage({})).rejects.toThrow("unavailable");
    expect(mocks.studio).not.toHaveBeenCalled();
  });

  it("redirects unauthenticated visitors before any content load", async () => {
    mocks.user.mockResolvedValue(null);
    await expect(CreatePage({})).rejects.toThrow("redirected");
    expect(mocks.redirect).toHaveBeenCalledWith("/login");
    expect(mocks.studioGenerations).not.toHaveBeenCalled();
  });
});
