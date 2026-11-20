import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { GeneratorStudio } from "@/components/create/generator-studio";
import type { GenerationItem } from "@/components/create/types";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const baseUser = { credits: 500, role: "user" as const };
const baseCheckIn = { checkInReward: 50, checkedInToday: false };

function makeJob(overrides: Partial<GenerationItem>): GenerationItem {
  return {
    id: "job_base",
    prompt: "重试与取消用例",
    model: "gpt-image-2",
    size: "1024x1024",
    quality: "auto",
    outputFormat: "png",
    outputCompression: null,
    moderation: "auto",
    count: 2,
    creditsSpent: 10,
    generationType: "text_to_image",
    providerMode: "built_in",
    status: "pending",
    createdAt: "2026-11-20T09:00:00.000Z",
    updatedAt: "2026-11-20T09:00:00.000Z",
    images: [],
    sourceImageUrls: [],
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  router.refresh.mockClear();
});

describe("生图工作台：失败重新生成与取消生成", () => {
  it("失败记录显示重新生成按钮，点击后发起新独立任务并置顶选中", async () => {
    const user = userEvent.setup();
    const retryCreated = makeJob({
      id: "job_retry_new",
      prompt: "重试用例",
      status: "pending",
      count: 2,
    });
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ data: { generation: retryCreated } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <GeneratorStudio
        ownerId="owner_test"
        checkInSummary={baseCheckIn}
        currentUser={baseUser}
        initialGenerations={[
          makeJob({
            id: "job_failed",
            prompt: "重试用例",
            status: "failed",
            errorMessage: "渠道暂时不可用",
            creditsSpent: 0,
          }),
        ]}
      />,
    );

    const stage = screen.getByRole("region", { name: "生成结果" });
    expect(within(stage).getByText("渠道暂时不可用")).toBeInTheDocument();

    const retryButtons = within(stage).getAllByRole("button", { name: "重新生成" });
    await user.click(retryButtons[0]);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/generate");
    expect(await screen.findByRole("status", { name: "图片生成中" })).toBeInTheDocument();
  });

  it("生成中任务支持取消生成并回写终态", async () => {
    const user = userEvent.setup();
    const cancelled = makeJob({
      id: "job_pending",
      status: "failed",
      errorMessage: "用户取消生成。",
      creditsSpent: 0,
    });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { generation: cancelled } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <GeneratorStudio
        ownerId="owner_test"
        checkInSummary={baseCheckIn}
        currentUser={baseUser}
        initialGenerations={[makeJob({ id: "job_pending", status: "pending", count: 3 })]}
      />,
    );

    const stage = screen.getByRole("region", { name: "生成结果" });
    expect(within(stage).getByText(/第 3 \/ 3 张/)).toBeInTheDocument();

    await user.click(within(stage).getByRole("button", { name: "取消生成" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/me/generations/job_pending",
      expect.objectContaining({ method: "DELETE" }),
    ));
    expect(await within(stage).findByText("用户取消生成。")).toBeInTheDocument();
  });
});
