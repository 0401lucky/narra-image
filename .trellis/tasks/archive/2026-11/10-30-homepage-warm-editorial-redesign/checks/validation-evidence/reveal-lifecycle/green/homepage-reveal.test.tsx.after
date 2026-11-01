import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

const scheduler = vi.hoisted(() => {
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => frames.delete(handle));
  return { frames, now: 0 };
});

import { HOME_MEDIA } from "@/components/marketing/homepage/constants";
import { HomeMotionProvider } from "@/components/marketing/homepage/home-motion-provider";
import { HomeReveal } from "@/components/marketing/homepage/home-reveal";
import { useHomeMotion } from "@/components/marketing/homepage/hooks/use-home-motion";

import { installHomeMotionEnvironment } from "./helpers/homepage-motion-fixtures";

let environment: ReturnType<typeof installHomeMotionEnvironment>;

// Yield between frames so Motion's event-loop time cache expires like it does in a browser.
async function advance(milliseconds: number, settled?: HTMLElement) {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 16) {
    scheduler.now += 16;
    await act(async () => {
      const callbacks = [...scheduler.frames.values()];
      scheduler.frames.clear();
      callbacks.forEach((callback) => callback(scheduler.now));
    });
    if (settled) {
      expect(settled.style.opacity).toBe("1");
      expect(settled.style.transform).toBe("none");
    }
  }
}

beforeEach(() => {
  scheduler.now += 1000;
  vi.spyOn(performance, "now").mockImplementation(() => scheduler.now);
  environment = installHomeMotionEnvironment();
});

afterEach(async () => {
  cleanup();
  await advance(1600);
  expect(scheduler.frames.size).toBe(0);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function PauseControl() {
  const motion = useHomeMotion();
  return <button type="button" onClick={motion.togglePaused}>Pause motion</button>;
}

function Wrapper({ children }: { children: ReactNode }) {
  return <HomeMotionProvider>{children}<PauseControl /></HomeMotionProvider>;
}

describe("HomeReveal with the real Motion render scheduler", () => {
  it.each(["offscreen", "hidden", "reduced", "paused", "unmounted"] as const)(
    "keeps interrupted content readable after queued rendering when %s",
    async (reason) => {
      const { container, unmount } = render(<Wrapper><HomeReveal><p>Readable content</p></HomeReveal></Wrapper>);
      const section = container.querySelector<HTMLElement>("[data-home-reveal]")!;
      environment.visibility(true);
      await advance(96);
      expect(Number(section.style.opacity)).toBeGreaterThan(0);
      expect(Number(section.style.opacity)).toBeLessThan(1);

      // stop() samples between frames and can enqueue a DOM render after React cleanup.
      scheduler.now += 8;
      if (reason === "offscreen") environment.visibility(false);
      if (reason === "hidden") environment.setHidden(true);
      if (reason === "reduced") environment.setMedia(HOME_MEDIA.reduced, true);
      if (reason === "paused") fireEvent.click(screen.getByRole("button", { name: "Pause motion" }));
      if (reason === "unmounted") unmount();
      expect(section.style.opacity).toBe("1");
      expect(section.style.transform).toBe("none");

      await advance(160, section);
      await advance(1200, section);
      if (reason === "offscreen") environment.visibility(true);
      if (reason === "hidden") environment.setHidden(false);
      if (reason === "reduced") environment.setMedia(HOME_MEDIA.reduced, false);
      if (reason === "paused") fireEvent.click(screen.getByRole("button", { name: "Pause motion" }));
      await advance(96, section);
    },
  );

  it("settles an entrance interrupted during its stagger delay without a later write", async () => {
    const { container } = render(<Wrapper><HomeReveal delay={0.7}><p>Delayed content</p></HomeReveal></Wrapper>);
    const section = container.querySelector<HTMLElement>("[data-home-reveal]")!;
    environment.visibility(true);
    await advance(64);
    expect(Number(section.style.opacity)).toBe(0);
    scheduler.now += 8;
    environment.visibility(false);
    expect(section.style.opacity).toBe("1");
    expect(section.style.transform).toBe("none");
    await advance(1600, section);
    environment.visibility(true);
    await advance(96, section);
  });

  it("retains staggered motion, reaches the final state and does not replay", async () => {
    const { container } = render(<Wrapper><HomeReveal delay={0.14}><p>One entrance</p></HomeReveal></Wrapper>);
    const section = container.querySelector<HTMLElement>("[data-home-reveal]")!;
    environment.visibility(true);
    await advance(64);
    expect(Number(section.style.opacity)).toBe(0);
    await advance(192);
    expect(Number(section.style.opacity)).toBeGreaterThan(0);
    expect(Number(section.style.opacity)).toBeLessThan(1);
    expect(section.style.transform).not.toBe("none");
    await advance(1000);
    expect(section.style.opacity).toBe("1");
    expect(section.style.transform).toBe("none");
    environment.visibility(false);
    environment.visibility(true);
    await advance(160, section);
  });
});
