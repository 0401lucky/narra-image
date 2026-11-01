import { render } from "@testing-library/react";
import type { ComponentProps } from "react";

const mocks = vi.hoisted(() => ({
  user: vi.fn(), conversations: vi.fn(), content: vi.fn(), provider: vi.fn(), studio: vi.fn(), stale: vi.fn(), redirect: vi.fn(), env: vi.fn(),
}));
vi.mock("@/lib/server/current-user", () => ({ getCurrentUserRecord: mocks.user }));
vi.mock("@/lib/server/conversation-generations", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/server/conversation-generations")>(),
  listStudioConversations: mocks.conversations,
  listConversationGenerations: mocks.content,
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
import { ConversationContentError } from "@/lib/server/conversation-generations";
import { conversationGeneration, conversationPage } from "./helpers/conversation-fixtures";

const ownerId = "owner_fixture";
const summary = (id: string) => ({ id, title: id, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", generationCount: 50_000 });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.env.mockReturnValue({ CANVAS_ENABLED: true });
  mocks.user.mockResolvedValue({ id: ownerId, credits: 500, role: "USER", email: "fixture@unit.invalid", nickname: "Fixture", avatarUrl: null, oauthProvider: null });
  mocks.provider.mockResolvedValue(null);
  mocks.studio.mockReturnValue(null);
  mocks.conversations.mockResolvedValue([summary("conversation_a"), summary("conversation_b")]);
  mocks.content.mockResolvedValue(conversationPage([conversationGeneration("initial_job")], "older_page"));
  mocks.redirect.mockImplementation(() => { throw new Error("redirected"); });
});

function studioProps() {
  return mocks.studio.mock.calls.at(-1)![0] as ComponentProps<typeof GeneratorStudio>;
}

describe("create page scoped bootstrap", () => {
  it("loads bounded summaries and only the selected conversation's first page", async () => {
    render(await CreatePage({ searchParams: { prompt: "Seed chat only" } }));
    expect(mocks.conversations).toHaveBeenCalledWith(ownerId);
    expect(mocks.content).toHaveBeenCalledExactlyOnceWith({ ownerId, conversationId: "conversation_a" });
    const props = studioProps();
    expect(props.ownerId).toBe(ownerId);
    expect(props.canvasEnabled).toBe(true);
    expect(props.initialPrompt).toBe("Seed chat only");
    expect(props.initialGenerations).toBeUndefined();
    expect(props.initialGenerationPage).toEqual(conversationPage([conversationGeneration("initial_job")], "older_page"));
    expect(props.initialConversations).toEqual([
      { ...summary("conversation_a"), generationIds: [] }, { ...summary("conversation_b"), generationIds: [] },
    ]);
    expect(mocks.stale).toHaveBeenCalledWith({ userId: ownerId });
    // The DB mock has no job/conversation delegates: global/history bootstrap queries fail this test.
  });

  it("passes the staged-off flag without changing conversation bootstrap", async () => {
    mocks.env.mockReturnValue({ CANVAS_ENABLED: false });
    render(await CreatePage({}));
    expect(studioProps().canvasEnabled).toBe(false);
    expect(studioProps().initialGenerationPage?.conversationId).toBe("conversation_a");
  });

  it("does not fetch orphan or canvas content when there are no conversations", async () => {
    mocks.conversations.mockResolvedValue([]);
    render(await CreatePage({}));
    expect(mocks.content).not.toHaveBeenCalled();
    expect(studioProps().initialGenerationPage).toBeNull();
    expect(studioProps().initialConversations).toEqual([]);
  });

  it("does not replace a concurrently deleted selected parent with unrelated content", async () => {
    mocks.content.mockRejectedValue(new ConversationContentError("CONVERSATION_NOT_FOUND"));
    render(await CreatePage({}));
    expect(studioProps().initialGenerationPage).toBeNull();
    expect(mocks.content).toHaveBeenCalledTimes(1);
  });

  it("does not mask ordinary content failures as a successful empty bootstrap", async () => {
    mocks.content.mockRejectedValue(new Error("unavailable"));
    await expect(CreatePage({})).rejects.toThrow("unavailable");
    expect(mocks.studio).not.toHaveBeenCalled();
  });

  it("redirects unauthenticated visitors before any content or metadata load", async () => {
    mocks.user.mockResolvedValue(null);
    await expect(CreatePage({})).rejects.toThrow("redirected");
    expect(mocks.redirect).toHaveBeenCalledWith("/login");
    expect(mocks.content).not.toHaveBeenCalled();
    expect(mocks.conversations).not.toHaveBeenCalled();
  });
});
