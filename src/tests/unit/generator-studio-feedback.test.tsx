import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";

import { GeneratorStudio } from "@/components/create/generator-studio";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

Object.defineProperty(URL, "createObjectURL", {
  configurable: true,
  value: vi.fn((file: File) => `blob:${file.name}`),
});

Object.defineProperty(URL, "revokeObjectURL", {
  configurable: true,
  value: vi.fn(),
});

Object.defineProperty(HTMLElement.prototype, "scrollTo", {
  configurable: true,
  value: vi.fn(),
});

function mockLocalStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    clear: vi.fn(() => store.clear()),
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
  });
}

const baseProps = {
  checkInSummary: {
    checkInReward: 50,
    checkedInToday: false,
  },
  currentUser: {
    credits: 500,
    role: "user" as const,
  },
};

type StudioProps = ComponentProps<typeof GeneratorStudio>;
type Generation = NonNullable<StudioProps["initialGenerations"]>[number];

function createSucceededGeneration(overrides: Partial<Generation> = {}): Generation {
  return {
    count: 1,
    createdAt: "2026-04-23T08:00:00.000Z",
    creditsSpent: 5,
    generationType: "text_to_image",
    id: "job_1",
    images: [
      {
        actualHeight: 1152,
        actualSize: "2048x1152",
        actualWidth: 2048,
        id: "image_1",
        url: "https://example.com/image.png",
      },
    ],
    model: "gpt-image-2",
    moderation: "low",
    negativePrompt: "低清晰度",
    outputCompression: 82,
    outputFormat: "webp",
    prompt: "电影感夜景肖像",
    providerChannelId: "channel_a",
    providerMode: "built_in",
    quality: "high",
    size: "2048x1152",
    sourceImageUrl: null,
    sourceImageUrls: [],
    status: "succeeded",
    ...overrides,
  };
}

function renderStudio(props: Partial<StudioProps> = {}) {
  return render(
    <GeneratorStudio
      {...baseProps}
      channels={[
        {
          creditCost: 5,
          defaultModel: "gpt-image-2",
          id: "channel_a",
          models: ["gpt-image-2", "seedream"],
          name: "主渠道",
        },
      ]}
      {...props}
    />,
  );
}

function getComposerDropTarget() {
  const textarea = screen.getByRole("textbox");
  const target = textarea.closest(".composer-silk");
  if (!target) throw new Error("找不到输入区");
  return target;
}

describe("创作台反馈改进", () => {
  beforeEach(() => {
    mockLocalStorage();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        blob: async () => new Blob(["fake-image"], { type: "image/png" }),
        ok: true,
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("支持把图片拖入输入区作为参考图", () => {
    renderStudio();

    const file = new File(["fake-a"], "source-a.png", { type: "image/png" });
    fireEvent.drop(getComposerDropTarget(), {
      dataTransfer: {
        files: [file],
        types: ["Files"],
      },
    });

    expect(screen.getByAltText("Reference")).toHaveAttribute("src", "blob:source-a.png");
    expect(screen.getByPlaceholderText("描述你希望如何修改这些参考图...")).toBeInTheDocument();
  });

  it("按底部输入区实际高度同步消息流留白", async () => {
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 180,
      height: 180,
      left: 0,
      right: 360,
      top: 0,
      width: 360,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    try {
      renderStudio();

      const chatStream = screen.getByText("你好，你想创作什么？").closest(".premium-scrollbar");
      expect(chatStream).not.toBeNull();
      await waitFor(() => {
        expect(chatStream).toHaveStyle({ paddingBottom: "192px" });
      });
    } finally {
      rectSpy.mockRestore();
    }
  });

  it("参考图可以用按钮调整提交顺序", async () => {
    const user = userEvent.setup();
    renderStudio();

    fireEvent.drop(getComposerDropTarget(), {
      dataTransfer: {
        files: [
          new File(["fake-a"], "source-a.png", { type: "image/png" }),
          new File(["fake-b"], "source-b.png", { type: "image/png" }),
        ],
        types: ["Files"],
      },
    });

    expect(screen.getAllByAltText("Reference").map((item) => item.getAttribute("src"))).toEqual([
      "blob:source-a.png",
      "blob:source-b.png",
    ]);

    await user.click(screen.getByRole("button", { name: "参考图 2 前移" }));

    expect(screen.getAllByAltText("Reference").map((item) => item.getAttribute("src"))).toEqual([
      "blob:source-b.png",
      "blob:source-a.png",
    ]);
  });

  it("结果图固定展示实际分辨率和比例", () => {
    renderStudio({
      initialGenerations: [createSucceededGeneration()],
    });

    expect(screen.getByText("2048x1152")).toBeInTheDocument();
    expect(screen.getByText("16:9")).toBeInTheDocument();
  });

  it("可以复用历史生成配置并回填参考图", async () => {
    const user = userEvent.setup();
    renderStudio({
      initialGenerations: [
        createSucceededGeneration({
          generationType: "image_to_image",
          sourceImageUrl: "https://example.com/source.png",
          sourceImageUrls: ["https://example.com/source.png"],
        }),
      ],
    });

    await user.click(screen.getByRole("button", { name: "复用配置" }));

    expect(screen.getByRole("textbox")).toHaveValue("电影感夜景肖像");
    expect(screen.getByRole("combobox", { name: "尺寸" })).toHaveValue("2048x1152");
    expect(screen.getByPlaceholderText("描述你希望如何修改这些参考图...")).toBeInTheDocument();
    expect(screen.getAllByAltText("Reference").some((item) => item.getAttribute("src") === "https://example.com/source.png")).toBe(true);
  });
});
