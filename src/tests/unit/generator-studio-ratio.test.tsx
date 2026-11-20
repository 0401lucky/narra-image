import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { GeneratorStudio } from "@/components/create/generator-studio";
import type { GenerationItem } from "@/components/create/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

const downgradedRecord: GenerationItem = {
  id: "job_downgraded",
  prompt: "超宽屏建筑摄影",
  model: "gpt-image-2",
  size: "3840x2160",
  quality: "high",
  outputFormat: "png",
  outputCompression: null,
  moderation: "auto",
  count: 1,
  creditsSpent: 5,
  generationType: "text_to_image",
  providerMode: "built_in",
  status: "succeeded",
  createdAt: "2026-11-20T08:00:00.000Z",
  updatedAt: "2026-11-20T08:00:35.000Z",
  durationMs: 35_000,
  images: [
    {
      id: "img_down",
      url: "https://cdn.example/down.png",
      actualWidth: 1024,
      actualHeight: 576,
      actualSize: "1024x576",
      availability: "available",
    },
  ],
  sourceImageUrls: [],
};

describe("生图工作台：尺寸/分辨率/宽高比联动与结果尺寸校验", () => {
  it("选择分辨率与宽高比自动同步 W×H 并随提交发送准确尺寸", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      data: { generation: { ...downgradedRecord, id: "job_new", size: "1536x2048", status: "pending", images: [] } },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <GeneratorStudio
        ownerId="owner_1"
        checkInSummary={{ checkInReward: 50, checkedInToday: false }}
        currentUser={{ credits: 100, role: "user" }}
      />,
    );

    // 点 2K 分辨率 + 3:4 宽高比 -> W=1536, H=2048
    await user.click(within(screen.getByRole("group", { name: "分辨率" })).getByRole("button", { name: "2K" }));
    await user.click(within(screen.getByRole("group", { name: "宽高比" })).getByRole("button", { name: "3:4" }));

    expect(screen.getByLabelText("宽度")).toHaveValue("1536");
    expect(screen.getByLabelText("高度")).toHaveValue("2048");

    // 互换宽高 -> W=2048, H=1536
    await user.click(screen.getByRole("button", { name: "互换宽高" }));
    expect(screen.getByLabelText("宽度")).toHaveValue("2048");
    expect(screen.getByLabelText("高度")).toHaveValue("1536");

    // 切回 3:4 并提交
    await user.click(within(screen.getByRole("group", { name: "宽高比" })).getByRole("button", { name: "3:4" }));
    fireEvent.change(screen.getByLabelText("提示词"), { target: { value: "极简人像棚拍" } });
    await user.click(screen.getByRole("button", { name: /开始生成/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const submitted = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { size: string };
    expect(submitted.size).toBe("1536x2048");
  });

  it("右栏结果展示实际尺寸、比例并在渠道降级时显示告警条", () => {
    render(
      <GeneratorStudio
        ownerId="owner_1"
        checkInSummary={{ checkInReward: 50, checkedInToday: false }}
        currentUser={{ credits: 100, role: "user" }}
        initialGenerations={[downgradedRecord]}
      />,
    );

    const stage = screen.getByRole("region", { name: "生成结果" });
    const card = within(stage).getByRole("article");
    expect(within(card).getByText("1024x576")).toBeInTheDocument();
    expect(within(card).getByText(/16:9/)).toBeInTheDocument();
    expect(within(card).getByText(/渠道降级了请求尺寸：请求 3840x2160，实际 1024x576/)).toBeInTheDocument();
  });
});
