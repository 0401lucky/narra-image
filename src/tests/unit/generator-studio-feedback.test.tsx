import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";

import { GeneratorStudio } from "@/components/create/generator-studio";
import { HISTORY_IMAGE_DRAG_MIME } from "@/components/create/constants";

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

function createPendingGeneration(overrides: Partial<Generation> = {}): Generation {
  return {
    count: 1,
    createdAt: "2026-04-23T08:00:00.000Z",
    creditsSpent: 0,
    generationType: "text_to_image",
    id: "job_custom",
    images: [],
    model: "gpt-image-1",
    moderation: "auto",
    negativePrompt: null,
    outputCompression: null,
    outputFormat: "png",
    prompt: "第三方 API 生成测试",
    providerChannelId: null,
    providerMode: "custom",
    quality: "auto",
    size: "auto",
    sourceImageUrl: null,
    sourceImageUrls: [],
    status: "pending",
    ...overrides,
  };
}

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
  const textarea =
    screen.queryByPlaceholderText("输入提示词生成图片，或直接粘贴图片进入图生图...")
    ?? screen.queryByPlaceholderText("描述你希望如何修改这些参考图...");
  if (!textarea) throw new Error("找不到主输入框");
  const target = textarea.closest(".composer-silk");
  if (!target) throw new Error("找不到输入区");
  return target;
}

function getFirstTextbox(name: string) {
  const input = screen.getAllByRole("textbox", { name })[0];
  if (!input) throw new Error(`找不到输入框：${name}`);
  return input;
}

function getFirstLabelText(name: string) {
  const input = screen.getAllByLabelText(name)[0];
  if (!input) throw new Error(`找不到输入框：${name}`);
  return input;
}

function getFirstButton(name: string) {
  const button = screen.getAllByRole("button", { name })[0];
  if (!button) throw new Error(`找不到按钮：${name}`);
  return button;
}

function mockGenerateFetch() {
  const generateRequests: RequestInit[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url === "/api/me/conversations" && init?.method === "POST") {
      return {
        json: async () => ({
          data: {
            conversation: {
              createdAt: "2026-04-23T08:00:00.000Z",
              generationIds: [],
              id: "conversation_1",
              title: "新对话",
              updatedAt: "2026-04-23T08:00:00.000Z",
            },
          },
        }),
        ok: true,
      };
    }

    if (url === "/api/generate") {
      generateRequests.push(init ?? {});
      return {
        json: async () => ({
          data: {
            generation: createPendingGeneration({
              conversationId: "conversation_1",
            }),
          },
        }),
        ok: true,
      };
    }

    return {
      blob: async () => new Blob(["fake-image"], { type: "image/png" }),
      json: async () => ({ data: {} }),
      ok: true,
    };
  });

  vi.stubGlobal("fetch", fetchMock);

  return {
    fetchMock,
    generateRequests,
  };
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

  it("支持把历史图片拖入输入区作为参考图", () => {
    renderStudio({
      initialGenerations: [createSucceededGeneration()],
    });

    fireEvent.drop(getComposerDropTarget(), {
      dataTransfer: {
        files: [],
        getData: (type: string) => (type === HISTORY_IMAGE_DRAG_MIME ? "https://example.com/image.png" : ""),
        types: [HISTORY_IMAGE_DRAG_MIME],
      },
    });

    expect(screen.getByAltText("Reference")).toHaveAttribute("src", "https://example.com/image.png");
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

  it("历史栏右键菜单可以复用生成配置", async () => {
    const user = userEvent.setup();
    renderStudio({
      initialGenerations: [createSucceededGeneration()],
    });

    fireEvent.contextMenu(screen.getByTitle("点击放大查看，右键可复用配置"), {
      clientX: 300,
      clientY: 120,
    });

    await user.click(screen.getByRole("menuitem", { name: "复用配置" }));

    expect(screen.getByRole("textbox")).toHaveValue("电影感夜景肖像");
    expect(screen.getByRole("combobox", { name: "尺寸" })).toHaveValue("2048x1152");
  });

  it("自填 API 文生图提交时发送 customProvider", async () => {
    const user = userEvent.setup();
    const { generateRequests } = mockGenerateFetch();
    renderStudio();

    await user.click(getFirstButton("高级设置"));
    await user.click(getFirstButton("自填 API"));
    await user.clear(getFirstTextbox("第三方 Base URL"));
    await user.type(getFirstTextbox("第三方 Base URL"), "https://api.custom.test/v1");
    await user.type(getFirstLabelText("第三方 API Key"), "sk-custom-key");
    await user.clear(getFirstLabelText("第三方模型"));
    await user.type(getFirstLabelText("第三方模型"), "custom-image-model");
    await user.clear(getFirstTextbox("第三方配置名称"));
    await user.type(getFirstTextbox("第三方配置名称"), "测试渠道");
    await user.type(screen.getByPlaceholderText("输入提示词生成图片，或直接粘贴图片进入图生图..."), "第三方 API 生成测试");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(generateRequests).toHaveLength(1);
    });

    const body = JSON.parse(String(generateRequests[0].body)) as {
      channelId?: string;
      customProvider?: {
        apiKey: string;
        baseUrl: string;
        label: string;
        model: string;
        remember: boolean;
      };
      model: string;
      providerMode: string;
    };

    expect(body.providerMode).toBe("custom");
    expect(body.channelId).toBeUndefined();
    expect(body.model).toBe("custom-image-model");
    expect(body.customProvider).toMatchObject({
      apiKey: "sk-custom-key",
      baseUrl: "https://api.custom.test/v1",
      label: "测试渠道",
      model: "custom-image-model",
      remember: false,
    });
  });

  it("自填 API 图生图提交时发送 FormData 参数", async () => {
    const user = userEvent.setup();
    const { generateRequests } = mockGenerateFetch();
    renderStudio();

    await user.click(getFirstButton("高级设置"));
    await user.click(getFirstButton("自填 API"));
    await user.clear(getFirstTextbox("第三方 Base URL"));
    await user.type(getFirstTextbox("第三方 Base URL"), "https://api.custom.test/v1");
    await user.type(getFirstLabelText("第三方 API Key"), "sk-custom-key");
    await user.clear(getFirstLabelText("第三方模型"));
    await user.type(getFirstLabelText("第三方模型"), "custom-image-model");

    fireEvent.drop(getComposerDropTarget(), {
      dataTransfer: {
        files: [new File(["fake-a"], "source-a.png", { type: "image/png" })],
        types: ["Files"],
      },
    });
    await user.type(screen.getByPlaceholderText("描述你希望如何修改这些参考图..."), "把参考图改成电影感");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(generateRequests).toHaveLength(1);
    });

    const body = generateRequests[0].body;
    expect(body).toBeInstanceOf(FormData);
    const formData = body as FormData;
    expect(formData.get("providerMode")).toBe("custom");
    expect(formData.get("customBaseUrl")).toBe("https://api.custom.test/v1");
    expect(formData.get("customApiKey")).toBe("sk-custom-key");
    expect(formData.get("customModel")).toBe("custom-image-model");
    expect(formData.get("rememberProvider")).toBe("false");
    expect(formData.get("channelId")).toBeNull();
    expect((formData.get("referenceImages") as File | null)?.name).toBe("source-a.png");
  });

  it("历史图片作为参考图提交时发送 referenceImageUrls", async () => {
    const user = userEvent.setup();
    const { generateRequests } = mockGenerateFetch();
    renderStudio({
      initialGenerations: [createSucceededGeneration()],
    });

    fireEvent.drop(getComposerDropTarget(), {
      dataTransfer: {
        files: [],
        getData: (type: string) => (type === HISTORY_IMAGE_DRAG_MIME ? "https://example.com/image.png" : ""),
        types: [HISTORY_IMAGE_DRAG_MIME],
      },
    });
    await user.type(screen.getByPlaceholderText("描述你希望如何修改这些参考图..."), "换成海报风格");
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(generateRequests).toHaveLength(1);
    });

    const body = generateRequests[0].body;
    expect(body).toBeInstanceOf(FormData);
    const formData = body as FormData;
    expect(formData.get("referenceImageUrls")).toBe("https://example.com/image.png");
    expect(formData.get("referenceImages")).toBeNull();
  });
});
