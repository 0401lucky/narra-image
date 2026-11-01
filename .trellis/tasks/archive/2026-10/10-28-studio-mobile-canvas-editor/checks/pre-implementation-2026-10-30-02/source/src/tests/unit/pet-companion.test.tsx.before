import type React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PetCompanion } from "@/components/pet/pet-companion";
import { PetToggle } from "@/components/pet/pet-toggle";

vi.mock("motion/react", async () => {
  const React = await import("react");

  type MotionDivProps = React.HTMLAttributes<HTMLDivElement> & {
    animate?: unknown;
    initial?: unknown;
    transition?: unknown;
    whileHover?: unknown;
  };

  const MotionDiv = React.forwardRef<HTMLDivElement, MotionDivProps>(
    (props, ref) => {
      const {
        animate,
        initial,
        transition,
        whileHover,
        ...restProps
      } = props;

      void animate;
      void initial;
      void transition;
      void whileHover;

      return <div ref={ref} {...restProps} />;
    },
  );
  MotionDiv.displayName = "MockMotionDiv";

  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    motion: {
      div: MotionDiv,
    },
  };
});

function mockLocalStorage() {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      clear: vi.fn(() => store.clear()),
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      removeItem: vi.fn((key: string) => {
        store.delete(key);
      }),
      setItem: vi.fn((key: string, value: string) => {
        store.set(key, value);
      }),
    },
  });
}

describe("桌面宠物", () => {
  beforeEach(() => {
    mockLocalStorage();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("通过开关启用后锚定在视口坐标系内", async () => {
    const user = userEvent.setup();

    render(
      <>
        <PetToggle />
        <PetCompanion />
      </>,
    );

    expect(
      screen.queryByRole("button", { name: "桌面宠物，点击有反应" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "宠物：关" }));

    const pet = await screen.findByRole("button", {
      name: "桌面宠物，点击有反应",
    });
    expect(pet).toHaveClass("fixed", "left-0", "top-0");
    expect(pet).toHaveAttribute("data-pet-mood", "idle");
    expect(pet).toHaveAttribute("data-pet-id", "navy");
    expect(pet).toHaveAttribute("data-pet-render-mode", "turnaround");

    const sprite = pet.querySelector("img");
    expect(sprite).toHaveAttribute("src", "/pet/navy-turnaround.png");
  });

  it("点击宠物后会切换到反馈动作帧", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("narra:pet:enabled", "1");

    render(<PetCompanion />);

    const pet = screen.getByRole("button", {
      name: "桌面宠物，点击有反应",
    });

    await user.click(pet);

    expect(pet).toHaveAttribute("data-pet-mood", "react");
    expect(pet).toHaveAttribute("data-pet-render-mode", "action");
    expect(pet.getAttribute("data-pet-frame")).toMatch(/^react-/);
  });

  it("移动过程中会使用原动作图的跑动帧", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.75);
    window.localStorage.setItem("narra:pet:enabled", "1");

    render(<PetCompanion />);

    const pet = screen.getByRole("button", {
      name: "桌面宠物，点击有反应",
    });

    act(() => {
      vi.advanceTimersByTime(560);
    });

    expect(pet).toHaveAttribute("data-pet-mood", "walk");
    expect(pet).toHaveAttribute("data-pet-render-mode", "action");
    expect(pet.getAttribute("data-pet-frame")).toMatch(/^walk-/);
    expect(pet.querySelector("img")).toHaveAttribute("src", "/pet/navy.png");
  });

  it("光标触碰宠物后会触发反馈动作", () => {
    window.localStorage.setItem("narra:pet:enabled", "1");

    render(<PetCompanion />);

    const pet = screen.getByRole("button", {
      name: "桌面宠物，点击有反应",
    });

    fireEvent.pointerOver(pet, {
      pointerType: "mouse",
      clientX: 240,
      clientY: 320,
    });

    expect(pet).toHaveAttribute("data-pet-mood", "react");
    expect(pet.getAttribute("data-pet-frame")).toMatch(/^react-/);
  });

  it("会读取用户选择的宠物素材", () => {
    window.localStorage.setItem("narra:pet:enabled", "1");
    window.localStorage.setItem("narra:pet:selected", "cocoa");

    render(<PetCompanion />);

    const pet = screen.getByRole("button", {
      name: "桌面宠物，点击有反应",
    });

    expect(pet).toHaveAttribute("data-pet-id", "cocoa");
    expect(pet).toHaveAttribute("data-pet-render-mode", "turnaround");
    expect(pet.querySelector("img")).toHaveAttribute(
      "src",
      "/pet/cocoa-turnaround.png",
    );
  });

  it("可以从开关旁的头像下拉里切换宠物", async () => {
    const user = userEvent.setup();

    render(<PetToggle />);

    await user.click(screen.getByRole("button", { name: /选择宠物/ }));
    await user.click(screen.getByRole("option", { name: "选择银灰" }));

    expect(window.localStorage.getItem("narra:pet:selected")).toBe("silver");
    expect(window.localStorage.getItem("narra:pet:enabled")).toBe("1");
    expect(
      screen.getByRole("button", { name: /当前是银灰/ }),
    ).toBeInTheDocument();
  });
});
