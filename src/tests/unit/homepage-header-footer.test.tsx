import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({ summary: vi.fn(), refresh: vi.fn(), pathname: vi.fn(() => "/") }));
vi.mock("@/lib/benefits/config", () => ({ getCheckInSummary: mocks.summary }));
vi.mock("next/navigation", () => ({ usePathname: mocks.pathname, useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }) }));

import { HeaderShell } from "@/components/marketing/header-shell";
import { MobileNav } from "@/components/marketing/mobile-nav";
import { SiteHeader } from "@/components/marketing/site-header";
import { HomeFooter } from "@/components/marketing/homepage/home-footer";
import { HomeMotionProvider } from "@/components/marketing/homepage/home-motion-provider";
import { HOME_MEDIA } from "@/components/marketing/homepage/constants";
import { writePetEnabled } from "@/components/pet/pet-state";

import { installHomeMotionEnvironment } from "./helpers/homepage-motion-fixtures";

let environment: ReturnType<typeof installHomeMotionEnvironment>;
const user = { id: "viewer-one", credits: 321, role: "user" as const, nickname: "纸上旅人", avatarUrl: "/avatar.png" };

beforeEach(() => {
  environment = installHomeMotionEnvironment();
  mocks.summary.mockResolvedValue({ checkedInToday: false, checkInReward: 10 });
  mocks.pathname.mockReturnValue("/");
  mocks.refresh.mockReset();
  writePetEnabled(false);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.style.overflow = "";
  document.body.style.paddingRight = "";
});

describe("homepage header variant and account behavior", () => {
  it.each([null, user, { ...user, role: "admin" as const }])("retains existing permission-sensitive routes: %j", async (currentUser) => {
    const { container } = render(await SiteHeader({ currentUser, variant: "home", activeHref: "/" }));
    const navigation = screen.getByRole("navigation", { name: "主导航" });
    for (const [name, href] of [["首页", "/"], ["创作台", "/create"], ["提示词库", "/prompts"], ["视频", "/video"], ["作品", "/works"]]) {
      expect(within(navigation).getByRole("link", { name })).toHaveAttribute("href", href);
    }
    expect(Boolean(within(navigation).queryByRole("link", { name: "API" }))).toBe(Boolean(currentUser));
    expect(Boolean(within(navigation).queryByRole("link", { name: "管理后台" }))).toBe(currentUser?.role === "admin");
    expect(within(navigation).getByRole("link", { name: "首页" })).toHaveAttribute("aria-current", "page");
    expect(container.querySelector("[data-header-variant]")).toHaveAttribute("data-header-variant", "home");
    if (currentUser) {
      expect(screen.getByText("321")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "个人设置" })).toHaveAttribute("href", "/settings");
      expect(screen.getByRole("button", { name: /签到 \+10/ })).toBeEnabled();
    } else {
      expect(screen.getByRole("link", { name: "登录开启" })).toHaveAttribute("href", "/login");
    }
  });

  it("calls the existing real check-in/logout endpoints and real pet store, not decorative actions", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { checkedIn: true, credits: 331, rewardCredits: 10 } }) });
    vi.stubGlobal("fetch", fetch);
    render(await SiteHeader({ currentUser: user, variant: "home" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /签到 \+10/ })));
    expect(fetch).toHaveBeenCalledWith("/api/me/check-in", { method: "POST" });
    expect(screen.getByRole("button", { name: /今日已签/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "宠物：关" }));
    expect(screen.getByRole("button", { name: "宠物：开" })).toHaveAttribute("aria-pressed", "true");
    await act(async () => fireEvent.click(screen.getByTitle("退出登录")));
    expect(fetch).toHaveBeenCalledWith("/api/auth/logout", { method: "POST" });
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("keeps default shell hide-on-scroll while home never installs that handler", () => {
    const listeners = vi.spyOn(window, "addEventListener");
    const { container, rerender, unmount } = render(<HeaderShell><p>默认页</p></HeaderShell>);
    Object.defineProperty(window, "scrollY", { configurable: true, value: 160 });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    fireEvent.scroll(window);
    environment.frame(16);
    expect(container.firstElementChild).toHaveClass("-translate-y-full");
    const before = listeners.mock.calls.filter(([event]) => event === "scroll").length;
    rerender(<HeaderShell variant="home"><p>首页</p></HeaderShell>);
    fireEvent.scroll(window);
    expect(environment.frames.size).toBe(0);
    expect(container.firstElementChild).not.toHaveClass("-translate-y-full");
    expect(listeners.mock.calls.filter(([event]) => event === "scroll")).toHaveLength(before);
    unmount();
    expect(environment.frames.size).toBe(0);
  });

  it("defaults the header and mobile presentation to the original route classes", async () => {
    const { container } = render(await SiteHeader({ currentUser: null }));
    expect(container.querySelector("[data-header-variant]")).toHaveAttribute("data-header-variant", "default");
    expect(container.querySelector("header")).toHaveClass("max-w-[104rem]");
    expect(container.querySelector('[data-home-nav-portal]')).toBeNull();
    expect(screen.getByRole("button", { name: "打开导航菜单" }).parentElement).toHaveClass("lg:hidden");
  });

  it("portals the home dialog outside ancestors, traps keyboard focus and returns focus/scroll on Escape", async () => {
    const keyboard = userEvent.setup();
    document.body.style.overflow = "auto";
    const { container } = render(<HomeMotionProvider><MobileNav variant="home" currentUser={null} links={[{ href: "/", label: "首页" }, { href: "/create", label: "创作台" }]} checkInSummary={null} /></HomeMotionProvider>);
    const trigger = screen.getByRole("button", { name: "打开导航菜单" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: /导航菜单/ });
    expect(dialog.closest("[data-home-nav-portal]")?.parentElement).toBe(document.body);
    expect(container.querySelector("[data-home-nav-portal]")).toBeNull();
    expect(container).toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("hidden");
    const close = screen.getByRole("button", { name: "关闭导航菜单" });
    expect(close).toHaveFocus();
    await keyboard.tab({ shift: true });
    expect(screen.getByRole("link", { name: "注册新账号" })).toHaveFocus();
    await keyboard.tab();
    expect(close).toHaveFocus();
    await keyboard.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe("auto");
    expect(container).not.toHaveAttribute("inert");
  });

  it("restores scroll and inert state on route-unmount without a leaked focus trap", () => {
    document.body.style.paddingRight = "7px";
    const { container, unmount } = render(<MobileNav variant="home" currentUser={user} links={[{ href: "/", label: "首页" }]} checkInSummary={null} />);
    fireEvent.click(screen.getByRole("button", { name: "打开导航菜单" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(container).toHaveAttribute("inert");
    unmount();
    expect(document.body.style.paddingRight).toBe("7px");
    expect(document.body.style.overflow).toBe("");
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    expect(outside).toHaveFocus();
    outside.remove();
  });

  it("closes the mobile portal at the desktop breakpoint without clearing preexisting inert state", () => {
    const alreadyInert = document.createElement("div");
    alreadyInert.setAttribute("inert", "existing");
    document.body.append(alreadyInert);
    try {
      document.body.style.overflow = "auto";
      const { container } = render(<MobileNav variant="home" currentUser={null} links={[{ href: "/", label: "首页" }]} checkInSummary={null} />);
      const trigger = screen.getByRole("button", { name: "打开导航菜单" });
      fireEvent.click(trigger);
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      environment.setMedia(HOME_MEDIA.fullNavigation, true);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(container).not.toHaveAttribute("inert");
      expect(alreadyInert).toHaveAttribute("inert", "existing");
      expect(document.body.style.overflow).toBe("auto");
      expect(environment.media.get(HOME_MEDIA.fullNavigation)?.callbacks.size).toBe(0);
    } finally {
      alreadyInert.remove();
    }
  });
});

describe("truthful home footer", () => {
  it.each([false, true])("uses only actual destinations with auth-sensitive API: %s", (isAuthenticated) => {
    const { container } = render(<HomeFooter isAuthenticated={isAuthenticated} />);
    expect(container.querySelector("footer")).toHaveAttribute("id", "footer");
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(["创作空间", "工具与账户", "发现 Narra"]);
    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual(expect.arrayContaining(["#hero", "/create", "/prompts", "/video", "/works", "/settings", "#capabilities", "#gallery", "https://github.com/0401lucky/narra-image"]));
    expect(hrefs.includes("/api-keys")).toBe(isAuthenticated);
    expect(hrefs).not.toContain("#footer");
    expect(container.textContent).not.toMatch(/服务状态|版权保护|社区精选规范|Narra Film/);
    if (!isAuthenticated) expect(screen.getByRole("link", { name: "登录账号" })).toHaveAttribute("href", "/login");
  });
});
