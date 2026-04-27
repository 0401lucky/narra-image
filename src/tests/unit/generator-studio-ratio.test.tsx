import { cleanup, render, screen } from "@testing-library/react";
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
  value: vi.fn(() => "blob:preview"),
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

function createSucceededGeneration(overrides: Partial<Generation> = {}) {
  return {
    count: 1,
    createdAt: "2026-04-23T08:00:00.000Z",
    creditsSpent: 5,
    generationType: "text_to_image" as const,
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
    providerMode: "built_in" as const,
    size: "1024x1024",
    sourceImageUrl: null,
    status: "succeeded" as const,
    ...overrides,
  };
}

describe("创作台宽高比", () => {
  beforeEach(() => {
    mockLocalStorage();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("在模式切换后仍可选择宽高比", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        blob: async () => new Blob(["fake-image"], { type: "image/png" }),
        ok: true,
      })),
    );

    render(
      <GeneratorStudio
        {...baseProps}
        initialGenerations={[createSucceededGeneration()]}
      />,
    );

    const sizeSelect = screen.getByRole("combobox", { name: "宽高比" });
    await user.selectOptions(sizeSelect, "9:16");

    expect(sizeSelect).toHaveValue("9:16");

    await user.click(screen.getByRole("button", { name: "加入编辑" }));

    expect(screen.getByRole("combobox", { name: "宽高比" })).toHaveValue("9:16");
    expect(await screen.findByPlaceholderText("描述你希望如何修改这些参考图...")).toBeInTheDocument();
  });

  it("历史结果会把旧尺寸值映射成正确比例展示", () => {
    render(
      <GeneratorStudio
        {...baseProps}
        initialGenerations={[
          createSucceededGeneration({
            id: "legacy_size_job",
            size: "1024x1536",
          }),
        ]}
      />,
    );

    expect(screen.getByText("gpt-image-1 • 竖版 3:4")).toBeInTheDocument();

    const resultImage = screen.getByAltText("生成结果");
    expect(resultImage.parentElement).toHaveStyle({ aspectRatio: "3 / 4" });
  });
});
