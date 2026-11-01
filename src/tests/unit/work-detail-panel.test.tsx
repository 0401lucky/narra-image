import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({ download: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/components/works/download-image", () => ({ downloadImage: mocks.download }));

import { WorkDetailPanel } from "@/components/works/work-detail-panel";
import { serializePublicWorkDetail, serializeWork } from "@/lib/prisma-mappers";

import { createPrivacyWork, workPrivacySentinels } from "./helpers/work-privacy-fixtures";

const detailUrl = "https://homepage.unit.invalid/works/work_privacy_fixture";

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("public image detail consumer", () => {
  it("renders redacted null prompts without exposing owner controls and retains full-image actions", async () => {
    const user = userEvent.setup();
    const work = serializePublicWorkDetail(serializeWork(createPrivacyWork()));

    render(<WorkDetailPanel detailUrl={detailUrl} isOwner={false} work={work} />);

    expect(screen.getByText("作者未公开提示词。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看完整提示词" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "申请下架" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "返回作品页" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "下载图片" }));
    expect(mocks.download).toHaveBeenCalledWith(work.url);
    await user.click(screen.getByRole("button", { name: "作品图片" }));
    const enlarged = await screen.findByRole("img", { name: "作品大图" });
    const imageSource = new URL(enlarged.getAttribute("src")!, detailUrl);
    expect(imageSource.searchParams.get("url")).toBe(work.url);
    expect(enlarged).toHaveClass("object-contain");
  });

  it("allows full published positive and negative prompts without management data", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const work = serializePublicWorkDetail(serializeWork(createPrivacyWork({ showPromptPublic: true })));

    render(<WorkDetailPanel detailUrl={detailUrl} isOwner={false} work={work} />);
    await user.click(screen.getByRole("button", { name: "查看完整提示词" }));
    await user.click(screen.getByRole("button", { name: "复制提示词" }));

    expect(writeText).toHaveBeenCalledWith(
      `主提示词:\n${workPrivacySentinels.prompt}\n\n负向提示词:\n${workPrivacySentinels.negativePrompt}`,
    );
    expect(screen.queryByText(workPrivacySentinels.reviewNote)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "申请下架" })).not.toBeInTheDocument();
  });
});

describe("owner detail management compatibility", () => {
  it("retains private prompts, rejection notes and opt-in submission", async () => {
    const user = userEvent.setup();
    const work = serializeWork(createPrivacyWork({ showcaseStatus: "PRIVATE" }));
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkDetailPanel detailUrl={detailUrl} isOwner work={work} />);

    expect(screen.getByText(workPrivacySentinels.reviewNote)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看完整提示词" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回作品页" })).toHaveAttribute("href", "/works");
    await user.click(screen.getByRole("button", { name: "投稿首页" }));
    const publishPrompt = screen.getByRole("checkbox", { name: "允许公开页面显示完整提示词" });
    expect(publishPrompt).not.toBeChecked();
    await user.click(publishPrompt);
    await user.click(screen.getByRole("button", { name: "确认投稿" }));

    expect(fetchMock).toHaveBeenCalledWith(`/api/me/works/${work.id}/showcase`, expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ action: "submit", showPromptPublic: true }),
    }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });

  it.each([
    { showcaseStatus: "PENDING", label: "撤回投稿", action: "withdraw" },
    { showcaseStatus: "FEATURED", label: "申请下架", action: "request_unfeature" },
  ] as const)("retains $label for the owner", async ({ showcaseStatus, label, action }) => {
    const user = userEvent.setup();
    const work = serializeWork(createPrivacyWork({ showcaseStatus }));
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkDetailPanel detailUrl={detailUrl} isOwner work={work} />);
    await user.click(screen.getByRole("button", { name: label }));

    expect(fetchMock).toHaveBeenCalledWith(`/api/me/works/${work.id}/showcase`, expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ action }),
    }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });
});
