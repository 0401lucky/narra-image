import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";

import { GeneratorStudio } from "@/components/create/generator-studio";
import type { GenerationItem } from "@/components/create/types";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

function makeRecord(id: string, overrides: Partial<GenerationItem> = {}): GenerationItem {
  return {
    id,
    prompt: `提示词 ${id}`,
    model: "gpt-image-2",
    size: "1024x1024",
    quality: "auto",
    outputFormat: "png",
    outputCompression: null,
    moderation: "auto",
    count: 1,
    creditsSpent: 5,
    generationType: "text_to_image",
    providerMode: "built_in",
    status: "succeeded",
    createdAt: "2026-11-20T09:00:00.000Z",
    updatedAt: "2026-11-20T09:00:30.000Z",
    durationMs: 30_000,
    images: [{ id: `img_${id}`, url: `https://cdn.example/${id}.png`, availability: "available" }],
    sourceImageUrls: [],
    ...overrides,
  };
}

const baseProps: ComponentProps<typeof GeneratorStudio> = {
  ownerId: "owner_1",
  currentUser: { credits: 100, role: "user" },
  checkInSummary: { checkInReward: 50, checkedInToday: false },
  channels: [{ id: "ch_1", name: "主力渠道", defaultModel: "gpt-image-2", models: ["gpt-image-2"], creditCost: 5 }],
};

beforeEach(() => {
  router.push.mockClear();
  router.refresh.mockClear();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("生图工作台：扁平生成记录、翻页与批量隐藏", () => {
  it("提交开始生成直接创建独立记录，不调用会话接口，并保留中栏草稿", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(globalThis.fetch as ReturnType<typeof vi.fn>);
    const created = makeRecord("job_new", { prompt: "赛博朋克雨夜街景", status: "pending", images: [] });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { generation: created } }), { status: 200 }),
    );

    render(<GeneratorStudio {...baseProps} initialGenerations={[makeRecord("job_old")]} />);

    const promptInput = screen.getByLabelText("提示词");
    await user.type(promptInput, "赛博朋克雨夜街景");
    await user.click(screen.getByRole("button", { name: /开始生成/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/generate");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/conversations"))).toBe(false);

    // 提交后保留中栏草稿，左栏新增记录并自动选中
    expect(promptInput).toHaveValue("赛博朋克雨夜街景");
    const rail = screen.getByRole("complementary", { name: "生成记录" });
    expect(within(rail).getByText("赛博朋克雨夜街景")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "图片生成中" })).toBeInTheDocument();
  });

  it("支持全选批量删除隐藏终态记录、跳过生成中任务，且刷新不复活", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(globalThis.fetch as ReturnType<typeof vi.fn>);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { hiddenIds: ["job_done"], skippedPendingIds: [] } }), { status: 200 }),
    );

    const done = makeRecord("job_done", { prompt: "已完成作品" });
    const running = makeRecord("job_running", { prompt: "正在生成作品", status: "pending", images: [] });
    const { rerender } = render(<GeneratorStudio {...baseProps} initialGenerations={[done, running]} />);

    const rail = screen.getByRole("complementary", { name: "生成记录" });
    await user.click(within(rail).getByRole("button", { name: "全选" }));
    await user.click(within(rail).getByRole("button", { name: /删除\(2\)/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/me/generations/hide",
      expect.objectContaining({ method: "POST" }),
    ));
    expect(within(rail).queryByText("已完成作品")).not.toBeInTheDocument();
    expect(within(rail).getByText("正在生成作品")).toBeInTheDocument();
    expect(within(rail).getByText(/跳过 1 条生成中的任务/)).toBeInTheDocument();

    // 模拟 router.refresh() 再次下发包含旧记录的 initialGenerations，不得复活已隐藏项
    rerender(<GeneratorStudio {...baseProps} initialGenerations={[done, running]} />);
    expect(within(rail).queryByText("已完成作品")).not.toBeInTheDocument();
  });

  it("支持点击加载更多游标翻页并追加历史记录", async () => {
    const fetchMock = vi.mocked(globalThis.fetch as ReturnType<typeof vi.fn>);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        data: {
          generations: [makeRecord("job_page_2", { prompt: "第二页历史图" })],
          hasMore: false,
          nextCursor: null,
        },
      }), { status: 200 }),
    );

    render(
      <GeneratorStudio
        {...baseProps}
        initialGenerations={[makeRecord("job_page_1", { prompt: "第一页历史图" })]}
        initialHasMore={true}
        initialNextCursor="cursor_1"
      />,
    );

    const rail = screen.getByRole("complementary", { name: "生成记录" });
    fireEvent.click(within(rail).getByRole("button", { name: "加载更多记录" }));

    expect(await within(rail).findByText("第二页历史图")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/me/generations?scope=studio&cursor=cursor_1",
      expect.objectContaining({ method: "GET" }),
    );
    expect(within(rail).queryByRole("button", { name: "加载更多记录" })).not.toBeInTheDocument();
  });
});
