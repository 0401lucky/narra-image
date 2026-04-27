import { render, screen } from "@testing-library/react";
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

describe("创作台连续编辑", () => {
  beforeEach(() => {
    mockLocalStorage();
  });

  beforeEach(() => {
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

  it("已有结果图时提供加入编辑入口", () => {
    render(
      <GeneratorStudio
        checkInSummary={{
          checkInReward: 50,
          checkedInToday: false,
        }}
        currentUser={{
          credits: 500,
          role: "user",
        }}
        initialGenerations={[
          {
            count: 1,
            createdAt: "2026-04-23T08:00:00.000Z",
            creditsSpent: 5,
            generationType: "text_to_image",
            id: "job_1",
            images: [
              {
                id: "image_1",
                url: "https://example.com/image.png",
              },
            ],
            model: "gpt-image-1",
            negativePrompt: null,
            prompt: "电影感夜景肖像",
            providerMode: "built_in",
            size: "1024x1024",
            sourceImageUrl: null,
            status: "succeeded",
          },
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: "加入编辑" })).toBeInTheDocument();
  });

  it("点击加入编辑后切到图生图模式", async () => {
    const user = userEvent.setup();

    render(
      <GeneratorStudio
        checkInSummary={{
          checkInReward: 50,
          checkedInToday: false,
        }}
        currentUser={{
          credits: 500,
          role: "user",
        }}
        initialGenerations={[
          {
            count: 1,
            createdAt: "2026-04-23T08:00:00.000Z",
            creditsSpent: 5,
            generationType: "text_to_image",
            id: "job_1",
            images: [
              {
                id: "image_1",
                url: "https://example.com/image.png",
              },
            ],
            model: "gpt-image-1",
            negativePrompt: null,
            prompt: "电影感夜景肖像",
            providerMode: "built_in",
            size: "1024x1024",
            sourceImageUrl: null,
            status: "succeeded",
          },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "加入编辑" }));

    expect(screen.getByRole("button", { name: "图生图" })).toHaveClass("bg-white", "text-black", "shadow-sm");
    expect(screen.getByPlaceholderText("描述你希望如何修改这些参考图...")).toBeInTheDocument();
    expect(screen.getByAltText("Reference")).toBeInTheDocument();
  });
});
