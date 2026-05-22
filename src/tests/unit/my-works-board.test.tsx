import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { MyWorksBoard } from "@/components/works/my-works-board";
import type { SerializedWork } from "@/lib/prisma-mappers";

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
});
