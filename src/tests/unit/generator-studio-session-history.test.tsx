import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { GeneratorStudio } from "@/components/create/generator-studio";
import type { GenerationItem } from "@/components/create/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

function makeRecord(id: string, prompt: string): GenerationItem {
  return {
    id,
    prompt,
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
    updatedAt: "2026-11-20T09:00:20.000Z",
    durationMs: 20_000,
    images: [{ id: `img_${id}`, url: `https://cdn.example/${id}.png`, availability: "available" }],
    sourceImageUrls: [],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("生图工作台：空状态、单条删除与刷新保持", () => {
  it("无记录时在左栏与右栏展示清晰空状态", () => {
    render(
      <GeneratorStudio
        ownerId="owner_empty"
        checkInSummary={{ checkInReward: 50, checkedInToday: false }}
        currentUser={{ credits: 100, role: "user" }}
        initialGenerations={[]}
      />,
    );

    const rail = screen.getByRole("complementary", { name: "生成记录" });
    const stage = screen.getByRole("region", { name: "生成结果" });
    expect(within(rail).getByText("暂无生成记录")).toBeInTheDocument();
    expect(within(stage).getByText("准备好开始创作了吗")).toBeInTheDocument();
  });

  it("删除当前选中的记录后自动切换到下一条，删除失败时回滚", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { hiddenIds: ["job_1"], skippedPendingIds: [] } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "服务暂不可用" }), { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <GeneratorStudio
        ownerId="owner_1"
        checkInSummary={{ checkInReward: 50, checkedInToday: false }}
        currentUser={{ credits: 100, role: "user" }}
        initialGenerations={[makeRecord("job_1", "第一条记录"), makeRecord("job_2", "第二条记录")]}
      />,
    );

    const rail = screen.getByRole("complementary", { name: "生成记录" });
    const stage = screen.getByRole("region", { name: "生成结果" });

    // 删除第一条 -> 自动选中第二条，右栏切换展示 job_2 的结果图
    await user.click(within(rail).getByRole("button", { name: /删除记录 第一条记录/ }));
    await waitFor(() => expect(within(rail).queryByText("第一条记录")).not.toBeInTheDocument());
    expect(within(stage).getByAltText("生成结果 1")).toHaveAttribute("src", expect.stringContaining("job_2.png"));

    // 删除第二条失败 -> 回滚恢复并提示错误
    await user.click(within(rail).getByRole("button", { name: /删除记录 第二条记录/ }));
    expect(await within(rail).findByText("服务暂不可用")).toBeInTheDocument();
    expect(within(rail).getByText("第二条记录")).toBeInTheDocument();
  });
});
