import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { GeneratorStudio } from "@/components/create/generator-studio";
import type { GenerationItem } from "@/components/create/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

beforeEach(() => {
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:preview") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const succeededRecord: GenerationItem = {
  id: "job_1",
  prompt: "电影感夜景肖像",
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
  createdAt: "2026-11-20T08:00:00.000Z",
  updatedAt: "2026-11-20T08:00:25.000Z",
  durationMs: 25_000,
  images: [{ id: "image_1", url: "https://example.com/image.png", availability: "available" }],
  sourceImageUrls: [],
};

describe("生图工作台：参考图自动模式、剪切板与多张图生图", () => {
  it("不展示手动文生图/图生图切换按钮，加入参考图保留当前提示词并自动切换图生图且支持 1~4 张", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = init?.body as FormData;
      return new Response(JSON.stringify({
        data: {
          generation: {
            ...succeededRecord,
            id: "job_edit_multi",
            generationType: "image_to_image",
            count: Number(body.get("count")),
            prompt: String(body.get("prompt")),
            status: "pending",
            images: [],
          },
        },
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <GeneratorStudio
        ownerId="owner_test"
        checkInSummary={{ checkInReward: 50, checkedInToday: false }}
        currentUser={{ credits: 500, role: "user" }}
        channels={[{ id: "ch_1", name: "默认渠道", defaultModel: "gpt-image-2", models: ["gpt-image-2"], creditCost: 5 }]}
        initialGenerations={[succeededRecord]}
      />,
    );

    // 无手动生成模式按钮组
    expect(screen.queryByRole("group", { name: "生成模式" })).not.toBeInTheDocument();

    // 输入提示词后点「加入参考图」，提示词不被清空，状态自动切为图生图
    const promptInput = screen.getByLabelText("提示词");
    await user.type(promptInput, "保留人物构图，改为冬日雪景");
    await user.click(screen.getByRole("button", { name: "加入参考图" }));

    expect(promptInput).toHaveValue("保留人物构图，改为冬日雪景");
    expect(screen.getByText("图生图 · 1 张参考图")).toBeInTheDocument();

    // 选择 3 张，按张计费显示 15 积分，FormData 携带 count=3
    await user.click(within(screen.getByRole("group", { name: "生成张数" })).getByRole("button", { name: "3 张" }));
    const submitBtn = screen.getByRole("button", { name: /开始生成/ });
    expect(submitBtn).toHaveTextContent("15 积分");

    await user.click(submitBtn);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const formData = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(formData).toBeInstanceOf(FormData);
    expect(formData.get("generationType")).toBe("image_to_image");
    expect(formData.get("count")).toBe("3");
    expect(formData.get("prompt")).toBe("保留人物构图，改为冬日雪景");
    expect(formData.getAll("referenceImageUrls")).toEqual(["https://example.com/image.png"]);
  });

  it("点击剪切板按钮在浏览器拒绝或不支持时给出友好回退提示", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        read: vi.fn().mockRejectedValue(new DOMException("Denied", "NotAllowedError")),
      },
    });

    render(
      <GeneratorStudio
        ownerId="owner_test"
        checkInSummary={{ checkInReward: 50, checkedInToday: false }}
        currentUser={{ credits: 500, role: "user" }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "剪切板" }));
    expect(await screen.findByText(/请直接按 Ctrl\+V 粘贴图片/)).toBeInTheDocument();
  });
});
