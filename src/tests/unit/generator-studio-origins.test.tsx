import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps, Ref } from "react";

import { GeneratorStudio } from "@/components/create/generator-studio";
import { POLL_DELAYS_MS } from "@/components/create/constants";
import type { GenerationItem } from "@/components/create/types";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const challenge = vi.hoisted(() => ({ reset: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/auth/turnstile-widget", async () => {
  const { useImperativeHandle } = await import("react");
  return {
    TurnstileWidget: ({ onVerify, ref }: { onVerify: (token: string) => void; ref: Ref<{ reset: () => void }> }) => {
      useImperativeHandle(ref, () => ({ reset: challenge.reset }), []);
      return (
        <>
          <button type="button" onClick={() => onVerify("first-token")}>Verify first</button>
          <button type="button" onClick={() => onVerify("next-token")}>Verify next</button>
        </>
      );
    },
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function makeJob(id: string, overrides: Partial<GenerationItem> = {}): GenerationItem {
  return {
    id,
    prompt: `Prompt ${id}`,
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
    updatedAt: "2026-11-20T09:00:30.000Z",
    durationMs: 30_000,
    images: [{ id: `img_${id}`, url: `https://cdn.example/${id}.png`, availability: "available" }],
    sourceImageUrls: [],
    ...overrides,
  };
}

const baseProps: ComponentProps<typeof GeneratorStudio> = {
  ownerId: "owner_a",
  currentUser: { credits: 500, role: "user" },
  checkInSummary: { checkInReward: 50, checkedInToday: false },
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("workbench owner isolation, turnstile consumption, and availability convergence", () => {
  it("isolates in-flight submissions and drafts across owner switches", async () => {
    const pendingSubmit = deferred<Response>();
    let capturedSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return pendingSubmit.promise;
    }));

    const { rerender } = render(<GeneratorStudio {...baseProps} initialPrompt="Owner A draft" />);
    fireEvent.click(screen.getByRole("button", { name: /开始生成/ }));

    // Switch account before the request finishes
    rerender(<GeneratorStudio {...baseProps} ownerId="owner_b" initialPrompt="Owner B draft" />);
    await act(async () => {
      pendingSubmit.resolve(new Response(JSON.stringify({ data: { generation: makeJob("late_a") } }), { status: 200 }));
    });

    expect(capturedSignal?.aborted).toBe(true);
    expect(screen.getByLabelText("提示词")).toHaveValue("Owner B draft");
    const rail = screen.getByRole("complementary", { name: "生成记录" });
    expect(within(rail).queryByText("Prompt late_a")).not.toBeInTheDocument();
  });

  it("resets consumed turnstile challenge without wiping a fresh challenge completed mid-flight", async () => {
    const gate = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => gate.promise));
    challenge.reset.mockClear();

    render(
      <GeneratorStudio
        {...baseProps}
        initialPrompt="Verified prompt"
        turnstile={{ isEnabled: true, siteKey: "test-key", protectGenerate: true }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Verify first" }));
    fireEvent.click(screen.getByRole("button", { name: /开始生成/ }));
    await act(async () => {
      gate.resolve(new Response(JSON.stringify({ data: { generation: makeJob("job_v1") } }), { status: 200 }));
    });

    await waitFor(() => expect(challenge.reset).toHaveBeenCalledTimes(1));
  });

  it("converges canonical media availability with useStudioJobs and never resurrects cleaned images", async () => {
    vi.useFakeTimers();
    const pendingJob = makeJob("job_poll", { status: "pending", images: [] });
    const cleanedTerminal = makeJob("job_poll", {
      status: "succeeded",
      updatedAt: "2026-11-20T09:01:00.000Z",
      images: [{ id: "img_poll", url: "", availability: "cleaned" }],
    });

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { generation: cleanedTerminal } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(<GeneratorStudio {...baseProps} initialGenerations={[pendingJob]} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_DELAYS_MS[0] + 50);
    });

    expect(screen.getByText(/图片已清理/)).toBeInTheDocument();

    // Even if a stale server refresh arrives with available URL for the same image ID, cleaned must win
    const staleAvailable = makeJob("job_poll", {
      status: "succeeded",
      updatedAt: "2026-11-20T09:02:00.000Z",
      images: [{ id: "img_poll", url: "https://cdn.example/stale.png", availability: "available" }],
    });
    rerender(<GeneratorStudio {...baseProps} initialGenerations={[staleAvailable]} />);

    expect(screen.getByText(/图片已清理/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "加入参考图" })).toBeDisabled();
  });
});
