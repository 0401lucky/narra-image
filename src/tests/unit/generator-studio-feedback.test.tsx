import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { GeneratorStudio } from "@/components/create/generator-studio";
import type { GenerationItem } from "@/components/create/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const recordA: GenerationItem = {
  id: "job_a",
  prompt: "海边落日胶片风",
  model: "gpt-image-2",
  size: "1536x2048",
  quality: "high",
  outputFormat: "webp",
  outputCompression: 85,
  moderation: "low",
  negativePrompt: "低画质",
  count: 2,
  creditsSpent: 10,
  generationType: "text_to_image",
  providerChannelId: "ch_1",
  providerMode: "built_in",
  status: "succeeded",
  createdAt: "2026-11-20T09:10:00.000Z",
  updatedAt: "2026-11-20T09:10:30.000Z",
  durationMs: 30_000,
  images: [{ id: "img_a", url: "https://cdn.example/a.png", availability: "available" }],
  sourceImageUrls: [],
};

const recordB: GenerationItem = {
  ...recordA,
  id: "job_b",
  prompt: "古风白衣剑客",
  size: "1024x1024",
  quality: "medium",
  count: 4,
  creditsSpent: 20,
  createdAt: "2026-11-20T08:00:00.000Z",
  images: [{ id: "img_b", url: "https://cdn.example/b.png", availability: "available" }],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("生图工作台：草稿保护、复用参数、提示词库与我的作品联动", () => {
  it("切换左栏记录不覆盖中栏草稿，点复用参数才回填，点新建清空草稿", async () => {
    const user = userEvent.setup();
    render(
      <GeneratorStudio
        ownerId="owner_1"
        checkInSummary={{ checkInReward: 50, checkedInToday: false }}
        currentUser={{ credits: 100, role: "user" }}
        channels={[{ id: "ch_1", name: "主力", defaultModel: "gpt-image-2", models: ["gpt-image-2"], creditCost: 5 }]}
        initialGenerations={[recordA, recordB]}
      />,
    );

    const promptInput = screen.getByLabelText("提示词");
    await user.type(promptInput, "我写到一半的新草稿");

    // 切换左栏记录，只更新右栏，中栏草稿保持原样
    const rail = screen.getByRole("complementary", { name: "生成记录" });
    await user.click(within(rail).getByText("古风白衣剑客"));
    expect(promptInput).toHaveValue("我写到一半的新草稿");

    // 右栏只聚焦图片与操作，不重复渲染提示词正文块，且图片使用 next.config 允许宽度并支持点击放大
    const stage = screen.getByRole("region", { name: "生成结果" });
    expect(within(stage).queryByText("古风白衣剑客")).not.toBeInTheDocument();
    expect(within(stage).queryByRole("button", { name: "复制提示词" })).not.toBeInTheDocument();
    const resultImg = within(stage).getByAltText("生成结果 1");
    expect(resultImg).toHaveAttribute("src", expect.stringContaining("w=1080"));
    expect(resultImg.getAttribute("src")).not.toContain("w=1024");
    await user.click(resultImg);
    expect(await screen.findByAltText("放大查看")).toHaveAttribute("src", "https://cdn.example/b.png");
    await user.click(screen.getByRole("button", { name: "关闭" }));

    // 点右栏「复用参数」，中栏回填 recordB 的提示词与张数
    await user.click(within(stage).getByRole("button", { name: "复用参数" }));
    expect(promptInput).toHaveValue("古风白衣剑客");
    expect(screen.getByRole("button", { name: /开始生成/ })).toHaveTextContent("20 积分");

    // 点左栏「新建」，清空草稿
    await user.click(within(rail).getByRole("button", { name: "新建" }));
    expect(promptInput).toHaveValue("");
  });

  it("可通过提示词库与我的作品弹窗分别填入提示词与添加参考图", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.startsWith("/api/prompts")) {
        return new Response(JSON.stringify({
          data: {
            categories: [{ id: "src_1", slug: "featured", name: "精选源", itemCount: 1 }],
            items: [{
              id: "p_1",
              title: "晨光玻璃花房",
              prompt: "清晨阳光穿透玻璃花房，柔和散景",
              coverUrl: null,
              preview: null,
              tags: ["风景"],
              source: { id: "src_1", slug: "featured", name: "精选源" },
            }],
            total: 1,
          },
        }), { status: 200 });
      }
      if (url.startsWith("/api/me/works")) {
        return new Response(JSON.stringify({
          data: {
            items: [{
              id: "w_1",
              url: "https://cdn.example/work-1.png",
              prompt: "旧作品提示词",
              size: "1024x1024",
              model: "gpt-image-2",
              availability: "available",
              createdAt: "2026-11-19T10:00:00.000Z",
            }],
            hasMore: false,
            nextCursor: null,
          },
        }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }));

    render(
      <GeneratorStudio
        ownerId="owner_1"
        checkInSummary={{ checkInReward: 50, checkedInToday: false }}
        currentUser={{ credits: 100, role: "user" }}
      />,
    );

    // 打开提示词库并填入提示词
    await user.click(screen.getByRole("button", { name: "提示词库" }));
    const promptDialog = await screen.findByRole("dialog", { name: "选择提示词" });
    await user.click(await within(promptDialog).findByRole("button", { name: "填入提示词" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByLabelText("提示词")).toHaveValue("清晨阳光穿透玻璃花房，柔和散景");

    // 打开我的作品并加入参考图，同时保留刚填入的提示词
    await user.click(screen.getByRole("button", { name: "我的作品" }));
    const worksDialog = await screen.findByRole("dialog", { name: "选择我的作品" });
    await user.click(await within(worksDialog).findByRole("button", { name: "参考图" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByLabelText("提示词")).toHaveValue("清晨阳光穿透玻璃花房，柔和散景");
    expect(screen.getByAltText("参考图 1")).toBeInTheDocument();
  });
});
