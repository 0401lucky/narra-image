import { Role } from "@prisma/client";
import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";

const mocks = vi.hoisted(() => ({
  adminBoard: vi.fn(),
  currentUser: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  findVideo: vi.fn(),
  notFound: vi.fn(),
  panel: vi.fn(),
  redirect: vi.fn(),
  requireAdmin: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    generationImage: { findMany: mocks.findMany, findUnique: mocks.findUnique },
    generatedVideo: { findUnique: mocks.findVideo },
  },
}));
vi.mock("@/lib/server/current-user", () => ({
  getCurrentUserRecord: mocks.currentUser,
  requireAdminRecord: mocks.requireAdmin,
}));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ APP_URL: "https://homepage.unit.invalid" }),
}));
vi.mock("@/lib/benefits/config", () => ({
  getBenefitConfig: async () => ({ autoApproveShowcase: false }),
}));
vi.mock("@/components/marketing/site-header", () => ({ SiteHeader: () => null }));
vi.mock("@/components/works/work-detail-panel", () => ({ WorkDetailPanel: mocks.panel }));
vi.mock("@/components/admin/admin-works-board", () => ({ AdminWorksBoard: mocks.adminBoard }));
vi.mock("@/components/admin/showcase-auto-approve-toggle", () => ({
  ShowcaseAutoApproveToggle: () => null,
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound, redirect: mocks.redirect }));

import AdminWorksPage from "@/app/admin/works/page";
import WorkDetailPage from "@/app/works/[id]/page";
import type { AdminWorksBoard } from "@/components/admin/admin-works-board";
import type { WorkDetailPanel } from "@/components/works/work-detail-panel";
import { serializeAdminWork, serializeWork } from "@/lib/prisma-mappers";
import { getAdminWorkById } from "@/lib/server/works";
import { workShowcaseStatuses } from "@/lib/work-showcase";

import {
  createPrivacyUser,
  createPrivacyWork,
  publicWorkDetailKeys,
  workPrivacySentinels,
} from "./helpers/work-privacy-fixtures";

const viewers = [
  { label: "anonymous", user: null },
  { label: "signed-in non-owner", user: createPrivacyUser("other_viewer") },
  { label: "admin visiting the public route", user: createPrivacyUser("admin_viewer", Role.ADMIN) },
];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.currentUser.mockResolvedValue(null);
  mocks.requireAdmin.mockResolvedValue(createPrivacyUser("admin_viewer", Role.ADMIN));
  mocks.findUnique.mockResolvedValue(createPrivacyWork());
  mocks.findMany.mockResolvedValue([]);
  mocks.findVideo.mockResolvedValue(null);
  mocks.panel.mockReturnValue(null);
  mocks.adminBoard.mockReturnValue(null);
  mocks.notFound.mockImplementation(() => { throw new Error("NEXT_NOT_FOUND"); });
  mocks.redirect.mockImplementation(() => { throw new Error("NEXT_REDIRECT"); });
});

function panelProps() {
  const call = mocks.panel.mock.calls.at(-1);
  expect(call).toBeDefined();
  return call![0] as ComponentProps<typeof WorkDetailPanel>;
}

async function renderDetail() {
  render(await WorkDetailPage({ params: Promise.resolve({ id: "work_privacy_fixture" }) }));
}

function expectNoInternalData(work: unknown) {
  const serialized = JSON.stringify(work);
  for (const sentinel of [
    workPrivacySentinels.authorEmail,
    workPrivacySentinels.ownerId,
    workPrivacySentinels.jobId,
    workPrivacySentinels.reviewNote,
    workPrivacySentinels.reviewedAt,
    workPrivacySentinels.reviewerEmail,
    workPrivacySentinels.reviewerId,
    workPrivacySentinels.submittedAt,
  ]) {
    expect(serialized).not.toContain(sentinel);
  }
}

describe.each(viewers)("image detail transfer: $label", ({ user }) => {
  it.each([false, true])("projects actual client props for prompt-public=%s", async (showPromptPublic) => {
    mocks.currentUser.mockResolvedValue(user);
    mocks.findUnique.mockResolvedValue(createPrivacyWork({ showPromptPublic }));

    await renderDetail();

    const props = panelProps();
    expect(props.isOwner).toBe(false);
    expect(props.detailUrl).toBe("https://homepage.unit.invalid/works/work_privacy_fixture");
    expect(Object.keys(props.work).sort()).toEqual(publicWorkDetailKeys);
    expect(props.work.prompt).toBe(showPromptPublic ? workPrivacySentinels.prompt : null);
    expect(props.work.negativePrompt).toBe(showPromptPublic ? workPrivacySentinels.negativePrompt : null);
    expect(props.work.showPromptPublic).toBe(showPromptPublic);
    expect(props.work.url).toBe("https://media.unit.invalid/full-original-image.png");
    expectNoInternalData(props.work);
    if (!showPromptPublic) {
      expect(JSON.stringify(props)).not.toContain(workPrivacySentinels.prompt.split("\n")[0]);
      expect(JSON.stringify(props)).not.toContain(workPrivacySentinels.negativePrompt.split("\n")[0]);
    }
    expect(mocks.findVideo).not.toHaveBeenCalled();
  });

  it.each(
    workShowcaseStatuses
      .filter((status) => status !== "FEATURED")
      .flatMap((showcaseStatus) => [false, true].map((showPromptPublic) => ({ showcaseStatus, showPromptPublic }))),
  )("keeps $showcaseStatus inaccessible with prompt-public=$showPromptPublic", async (options) => {
    mocks.currentUser.mockResolvedValue(user);
    mocks.findUnique.mockResolvedValue(createPrivacyWork(options));

    await expect(renderDetail()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.panel).not.toHaveBeenCalled();
    expect(mocks.findVideo).not.toHaveBeenCalled();
  });
});

describe("owner and administration compatibility", () => {
  it.each(
    workShowcaseStatuses.flatMap((showcaseStatus) =>
      [false, true].map((showPromptPublic) => ({ showcaseStatus, showPromptPublic })),
    ),
  )("keeps owner data intact for $showcaseStatus / $showPromptPublic", async (options) => {
    const work = createPrivacyWork(options);
    mocks.currentUser.mockResolvedValue(createPrivacyUser(work.job.userId));
    mocks.findUnique.mockResolvedValue(work);

    await renderDetail();

    const props = panelProps();
    expect(props.isOwner).toBe(true);
    expect(props.work).toEqual(serializeWork(work));
    expect(props.work.prompt).toBe(workPrivacySentinels.prompt);
    expect(props.work.negativePrompt).toBe(workPrivacySentinels.negativePrompt);
    expect(props.work).toHaveProperty("reviewNote", workPrivacySentinels.reviewNote);
  });

  it("does not mutate raw data reused by a later owner or admin request", async () => {
    const work = createPrivacyWork();
    const before = JSON.stringify(work);
    mocks.findUnique.mockResolvedValue(work);

    await renderDetail();
    expect(panelProps().work.prompt).toBeNull();
    mocks.currentUser.mockResolvedValue(createPrivacyUser(work.job.userId));
    await renderDetail();

    expect(panelProps().work).toEqual(serializeWork(work));
    expect(await getAdminWorkById(work.id)).toEqual(serializeAdminWork(work));
    expect(JSON.stringify(work)).toBe(before);
  });

  it("retains the actual authorized admin page's review and author payload", async () => {
    const work = createPrivacyWork();
    mocks.findMany.mockResolvedValue([work]);

    render(await AdminWorksPage());

    const props = mocks.adminBoard.mock.calls.at(-1)![0] as ComponentProps<typeof AdminWorksBoard>;
    expect(props.works).toEqual([serializeAdminWork(work)]);
    expect(props.works[0].author.email).toBe(workPrivacySentinels.authorEmail);
    expect(props.works[0].reviewer?.email).toBe(workPrivacySentinels.reviewerEmail);
    expect(props.works[0].negativePrompt).toBe(workPrivacySentinels.negativePrompt);
  });

  it("still redirects unauthorized admin visitors before querying works", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("not an admin"));

    await expect(AdminWorksPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/login");
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.adminBoard).not.toHaveBeenCalled();
  });
});

describe("missing-image and video fallback compatibility", () => {
  it("returns 404 when neither an image nor a video exists", async () => {
    mocks.findUnique.mockResolvedValue(null);
    await expect(renderDetail()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.panel).not.toHaveBeenCalled();
  });

  it.each([false, true])("keeps the existing server-rendered public video behavior: %s", async (showPromptPublic) => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.findVideo.mockResolvedValue({
      id: "work_privacy_fixture",
      job: { prompt: "Video prompt fixture", userId: "video_owner" },
      posterUrl: null,
      showcaseStatus: "FEATURED",
      showPromptPublic,
      url: "https://media.unit.invalid/video.mp4",
    });

    await renderDetail();

    expect(screen.getByText(showPromptPublic ? "Video prompt fixture" : "作者未公开提示词")).toBeInTheDocument();
    expect(mocks.panel).not.toHaveBeenCalled();
  });

  it("does not broaden non-owner private video access", async () => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.findVideo.mockResolvedValue({ showcaseStatus: "PRIVATE", job: { userId: "video_owner" } });
    await expect(renderDetail()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.panel).not.toHaveBeenCalled();
  });
});
