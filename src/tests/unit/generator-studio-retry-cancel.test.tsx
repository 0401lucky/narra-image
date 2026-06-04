import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { GeneratorStudio } from "@/components/create/generator-studio";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

Object.defineProperty(URL, "createObjectURL", {
  configurable: true,
  value: vi.fn(() => "blob:preview"),
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

const baseUser = {
  credits: 500,
  role: "user" as const,
};
const baseCheckIn = {
  checkInReward: 50,
  checkedInToday: false,
};

describe("创作台：失败重试 / 取消生成 入口", () => {
  beforeEach(() => {
    mockLocalStorage();
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

  it("失败 generation 显示重试按钮", () => {
    render(
      <GeneratorStudio
        checkInSummary={baseCheckIn}
        currentUser={baseUser}
        initialGenerations={[
          {
            count: 1,
            createdAt: "2026-04-23T08:00:00.000Z",
            creditsSpent: 0,
            errorMessage: "渠道暂时不可用",
            generationType: "text_to_image",
            id: "job_failed",
            images: [],
            model: "gpt-image-1",
            negativePrompt: null,
            prompt: "重试用例",
            providerMode: "built_in",
            size: "1024x1024",
            sourceImageUrl: null,
            status: "failed",
          },
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    expect(screen.getByText(/生成失败：渠道暂时不可用/)).toBeInTheDocument();
  });

  it("重试成功创建新任务后覆盖旧失败消息", async () => {
    const user = userEvent.setup();
    const generateRequests: RequestInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/generate") {
          generateRequests.push(init ?? {});
          return {
            json: async () => ({
              data: {
                generation: {
                  conversationId: "conversation_1",
                  count: 1,
                  createdAt: "2026-04-23T08:01:00.000Z",
                  creditsSpent: 5,
                  generationType: "text_to_image",
                  id: "job_retry",
                  images: [],
                  model: "gpt-image-1",
                  negativePrompt: null,
                  prompt: "重试用例",
                  providerMode: "built_in",
                  size: "1024x1024",
                  sourceImageUrl: null,
                  status: "pending",
                },
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
      }),
    );

    const { container } = render(
      <GeneratorStudio
        checkInSummary={baseCheckIn}
        currentUser={baseUser}
        initialConversations={[
          {
            createdAt: "2026-04-23T08:00:00.000Z",
            generationIds: ["job_failed"],
            id: "conversation_1",
            title: "重试用例",
          },
        ]}
        initialGenerations={[
          {
            conversationId: "conversation_1",
            count: 1,
            createdAt: "2026-04-23T08:00:00.000Z",
            creditsSpent: 0,
            errorMessage: "渠道暂时不可用",
            generationType: "text_to_image",
            id: "job_failed",
            images: [],
            model: "gpt-image-1",
            negativePrompt: null,
            prompt: "重试用例",
            providerMode: "built_in",
            size: "1024x1024",
            sourceImageUrl: null,
            status: "failed",
          },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "重试" }));

    await waitFor(() => {
      expect(generateRequests).toHaveLength(1);
    });

    const body = JSON.parse(String(generateRequests[0].body)) as {
      replaceGenerationId?: string;
    };
    expect(body.replaceGenerationId).toBe("job_failed");
    expect(screen.queryByText(/生成失败：渠道暂时不可用/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消生成" })).toBeInTheDocument();
    expect(container.querySelectorAll(".generation-bubble")).toHaveLength(1);
  });

  it("pending generation 显示取消按钮，点击后变成已取消", async () => {
    const user = userEvent.setup();
    render(
      <GeneratorStudio
        checkInSummary={baseCheckIn}
        currentUser={baseUser}
        initialGenerations={[
          {
            count: 1,
            createdAt: "2026-04-23T08:00:00.000Z",
            creditsSpent: 5,
            generationType: "text_to_image",
            id: "job_pending",
            images: [],
            model: "gpt-image-1",
            negativePrompt: null,
            prompt: "正在生成",
            providerMode: "built_in",
            size: "1024x1024",
            sourceImageUrl: null,
            status: "pending",
          },
        ]}
      />,
    );

    const cancelButton = screen.getByRole("button", { name: "取消生成" });
    await user.click(cancelButton);

    // 取消后状态变 failed，errorMessage 出现"已被用户取消"，重试按钮取代取消按钮
    expect(screen.queryByRole("button", { name: "取消生成" })).not.toBeInTheDocument();
    expect(screen.getByText(/已被用户取消/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });

  it("成功 generation 不显示重试或取消按钮", () => {
    render(
      <GeneratorStudio
        checkInSummary={baseCheckIn}
        currentUser={baseUser}
        initialGenerations={[
          {
            count: 1,
            createdAt: "2026-04-23T08:00:00.000Z",
            creditsSpent: 5,
            generationType: "text_to_image",
            id: "job_ok",
            images: [
              {
                id: "image_ok",
                url: "https://example.com/image.png",
              },
            ],
            model: "gpt-image-1",
            negativePrompt: null,
            prompt: "成功用例",
            providerMode: "built_in",
            size: "1024x1024",
            sourceImageUrl: null,
            status: "succeeded",
          },
        ]}
      />,
    );

    expect(screen.queryByRole("button", { name: "重试" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "取消生成" })).not.toBeInTheDocument();
    // 但仍能看到"加入编辑"
    expect(screen.getByRole("button", { name: "加入编辑" })).toBeInTheDocument();
  });
});

describe("创作台：模式切换可访问性", () => {
  beforeEach(() => {
    mockLocalStorage();
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

  it("模式切换按钮通过 aria-pressed 标识当前模式", () => {
    render(
      <GeneratorStudio
        checkInSummary={baseCheckIn}
        currentUser={baseUser}
        initialGenerations={[]}
      />,
    );

    const group = screen.getByRole("group", { name: "生成模式" });
    const textBtn = within(group).getByRole("button", { name: "文生图" });
    const imageBtn = within(group).getByRole("button", { name: "图生图" });
    expect(textBtn).toHaveAttribute("aria-pressed", "true");
    expect(imageBtn).toHaveAttribute("aria-pressed", "false");
  });
});
