import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MyWorksBoard } from "@/components/works/my-works-board";
import type { SerializedWork } from "@/lib/prisma-mappers";

const mocks = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock("@/components/works/download-image", () => ({ downloadImage: mocks.download }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  motion: {
    article: ({
      animate: _animate,
      children,
      initial: _initial,
      transition: _transition,
      ...props
    }: {
      animate?: unknown;
      children?: ReactNode;
      initial?: unknown;
      transition?: unknown;
      [key: string]: unknown;
    }) => <article {...props}>{children}</article>,
    div: ({
      animate: _animate,
      children,
      initial: _initial,
      transition: _transition,
      ...props
    }: {
      animate?: unknown;
      children?: ReactNode;
      initial?: unknown;
      transition?: unknown;
      [key: string]: unknown;
    }) => <div {...props}>{children}</div>,
  },
}));

afterEach(() => { vi.unstubAllGlobals(); });

function createWork(input: Partial<SerializedWork> = {}): SerializedWork {
  return {
    authorNickname: "作者",
    createdAt: "2026-05-12T10:00:00.000Z",
    featuredAt: "2026-05-12T11:00:00.000Z",
    generationCreatedAt: "2026-05-12T10:00:00.000Z",
    generationStatus: "succeeded",
    id: "work_1",
    jobId: "job_1",
    model: "gpt-image-2",
    negativePrompt: null,
    ownerId: "user_1",
    prompt: "作者自己的完整提示词",
    reviewNote: null,
    reviewedAt: null,
    reviewedById: null,
    reviewer: null,
    showcaseStatus: "FEATURED",
    showPromptPublic: false,
    size: "1024x1024",
    submittedAt: "2026-05-12T10:30:00.000Z",
    url: "http://image.example.com/work.png",
    ...input,
  };
}

describe("我的作品面板", () => {
  it("作者查看自己的精选作品时仍显示完整提示词", () => {
    render(
      <MyWorksBoard
        counts={{ featured: 1, pending: 0, total: 1 }}
        initialCursor={null}
        initialHasMore={false}
        initialItems={[createWork()]}
      />,
    );

    expect(screen.getAllByText("作者自己的完整提示词").length).toBeGreaterThan(0);
    expect(screen.queryByText("作者未公开提示词")).not.toBeInTheDocument();
  });

  it("保留已清理作品的提示词和详情，但不显示或下载图片", async () => {
    mocks.download.mockClear();
    const user = userEvent.setup();
    const work = createWork({ availability: "cleaned", showcaseStatus: "PRIVATE" });
    render(<MyWorksBoard counts={{ featured: 0, pending: 0, total: 1 }} initialCursor={null} initialHasMore={false} initialItems={[work]} />);

    expect(screen.getByRole("article")).toHaveAttribute("data-availability", "cleaned");
    expect(screen.getByRole("article")).toHaveAttribute("data-work-id", work.id);
    expect(screen.getAllByText("图片已清理").length).toBeGreaterThan(0);
    expect(screen.getAllByText(work.prompt).length).toBeGreaterThan(0);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    for (const name of ["放大预览", "下载作品", "下载", "投稿首页"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toBeDisabled();
      await user.click(button);
    }
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("刷新合并清理状态并关闭旧预览，迟到快照不能重新启用图片", async () => {
    mocks.download.mockClear();
    const user = userEvent.setup();
    const work = createWork({ availability: "available", showcaseStatus: "PRIVATE" });
    const props = { counts: { featured: 0, pending: 0, total: 1 }, initialCursor: null, initialHasMore: false };
    const { rerender } = render(<MyWorksBoard {...props} initialItems={[work]} />);
    await user.click(screen.getByRole("button", { name: "放大预览" }));
    expect(await screen.findByRole("button", { name: "下载这张图" })).toBeEnabled();

    rerender(<MyWorksBoard {...props} initialItems={[{ ...work, availability: "cleaned" }]} />);
    expect(screen.getByRole("article")).toHaveAttribute("data-availability", "cleaned");
    expect(screen.queryByRole("button", { name: "下载这张图" })).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();

    rerender(<MyWorksBoard {...props} initialItems={[{ ...work, availability: "available" }]} />);
    expect(screen.getByRole("article")).toHaveAttribute("data-availability", "cleaned");
    expect(screen.getAllByText(work.prompt).length).toBeGreaterThan(0);
    const download = screen.getByRole("button", { name: "下载作品" });
    expect(download).toBeDisabled();
    await user.click(download);
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("刷新图片可用性时保留已加载分页、搜索和选择，并允许暂时不可用恢复", async () => {
    const user = userEvent.setup();
    const first = createWork({ availability: "unavailable", showcaseStatus: "PRIVATE" });
    const second = createWork({ id: "work_2", jobId: "job_2", prompt: "第二页作品提示词", url: "https://image.example.com/second.png", availability: "available", showcaseStatus: "PRIVATE" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: { items: [second], hasMore: false, nextCursor: null } })));
    const props = { counts: { featured: 0, pending: 0, total: 2 }, initialCursor: "first-page-cursor", initialHasMore: true };
    const { rerender } = render(<MyWorksBoard {...props} initialItems={[first]} />);
    await user.click(screen.getByRole("button", { name: "加载更多" }));
    const secondCard = screen.getAllByRole("article").find((card) => card.getAttribute("data-work-id") === second.id)!;
    await user.click(secondCard);
    const search = screen.getByPlaceholderText("搜索作品或提示词");
    await user.type(search, "第二页");

    rerender(<MyWorksBoard {...props} initialItems={[{ ...first, availability: "available" }]} />);
    expect(search).toHaveValue("第二页");
    expect(screen.getByRole("article")).toHaveAttribute("data-work-id", second.id);
    expect(screen.queryByRole("button", { name: "加载更多" })).not.toBeInTheDocument();
    await user.clear(search);
    expect(screen.getAllByRole("article")).toHaveLength(2);
    const firstCard = screen.getAllByRole("article").find((card) => card.getAttribute("data-work-id") === first.id)!;
    expect(firstCard).toHaveAttribute("data-availability", "available");
    expect(within(firstCard).getByRole("button", { name: "下载作品" })).toBeEnabled();
    for (const image of screen.getAllByRole("img", { name: "选中作品预览" })) {
      expect(new URL(image.getAttribute("src")!, "https://works.unit.invalid").searchParams.get("url")).toBe(second.url);
    }
  });

  it("纳管后的同状态刷新更新缩略图、已打开的大图和下载地址", async () => {
    mocks.download.mockClear();
    const user = userEvent.setup();
    const work = createWork({ availability: "available", showcaseStatus: "PRIVATE" });
    const publicUrl = `https://app.history.invalid/media/images/${"a".repeat(64)}`;
    const props = { counts: { featured: 0, pending: 0, total: 1 }, initialCursor: null, initialHasMore: false };
    const { rerender } = render(<MyWorksBoard {...props} initialItems={[work]} />);
    await user.click(screen.getByRole("button", { name: "放大预览" }));
    await screen.findByRole("button", { name: "下载这张图" });

    rerender(<MyWorksBoard {...props} initialItems={[{ ...work, url: publicUrl }]} />);
    expect(screen.getByRole("article")).toHaveAttribute("data-work-id", work.id);
    for (const image of screen.getAllByRole("img")) {
      expect(new URL(image.getAttribute("src")!, "https://works.unit.invalid").searchParams.get("url")).toBe(publicUrl);
    }
    await user.click(screen.getByRole("button", { name: "下载这张图" }));
    expect(mocks.download).toHaveBeenCalledWith(publicUrl);
    expect(work.url).toBe("http://image.example.com/work.png");
  });
});
