import { act, cleanup, render, screen } from "@testing-library/react";

import { VideoGeneratingProgress } from "@/components/video/parts/video-generating-progress";

function valueNow() {
  return Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"));
}

describe("视频生成进度", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T00:00:00.000Z"));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("刚提交时进度接近 0 并显示预计时间提示", () => {
    render(<VideoGeneratingProgress startedAt="2026-06-01T00:00:00.000Z" />);

    expect(valueNow()).toBeLessThanOrEqual(5);
    expect(screen.getByText(/预计/)).toBeInTheDocument();
  });

  it("随等待时间推进，进度单调增大且封顶 95（不卡死、不满）", () => {
    render(<VideoGeneratingProgress startedAt="2026-06-01T00:00:00.000Z" />);
    const initial = valueNow();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    const after60s = valueNow();
    expect(after60s).toBeGreaterThan(initial);

    // 远超预估时长（再 +10 分钟）仍只逼近、不超过 95，避免「卡在 100%」的假象。
    act(() => {
      vi.advanceTimersByTime(600_000);
    });
    const afterLong = valueNow();
    expect(afterLong).toBeGreaterThan(after60s);
    expect(afterLong).toBeLessThanOrEqual(95);
  });
});
