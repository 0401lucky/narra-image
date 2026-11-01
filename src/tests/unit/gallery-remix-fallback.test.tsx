import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { router } = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { FeaturedGallery } from "@/components/marketing/featured-gallery";
import { GALLERY_MESSAGES } from "@/components/marketing/homepage/gallery-constants";
import { HOME_MOTION } from "@/components/marketing/homepage/constants";
import type { SerializedFeaturedWork } from "@/lib/prisma-mappers";

import { createGalleryWork, deferred } from "./helpers/gallery-fixtures";

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const requestPrefix = "/create?prompt=";
const viewers = [
  { viewer: "member", authenticated: true, directLabel: "做同款", manualLabel: "前往创作台", manualHref: "/create" },
  { viewer: "guest", authenticated: false, directLabel: "登录后做同款", manualLabel: "先登录", manualHref: "/login" },
] as const;

function clipboard(writeText?: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: writeText ? { writeText } : undefined });
}

function requestTarget(prompt: string) {
  return requestPrefix + encodeURIComponent(prompt);
}

function renderWork(work: SerializedFeaturedWork, authenticated: boolean) {
  render(<FeaturedGallery works={[work]} isAuthenticated={authenticated} />);
  return screen.getByRole("article", { name: work.title });
}

function openPrompt(prompt: string, authenticated: boolean) {
  const article = renderWork(createGalleryWork("remix", { prompt }), authenticated);
  fireEvent.click(within(article).getByRole("button", { name: "查看提示词 title-remix" }));
  return article;
}

function expectNoSideEffects(location: string) {
  expect(fetch).not.toHaveBeenCalled();
  expect(router.push).not.toHaveBeenCalled();
  expect(router.replace).not.toHaveBeenCalled();
  expect(router.refresh).not.toHaveBeenCalled();
  expect(window.history.pushState).not.toHaveBeenCalled();
  expect(window.history.replaceState).not.toHaveBeenCalled();
  expect(Storage.prototype.setItem).not.toHaveBeenCalled();
  expect(window.location.href).toBe(location);
}

function expectManualBranch(article: HTMLElement, viewer: typeof viewers[number]) {
  // Count first so the pre-fix failure does not print an entire oversized URL.
  expect(article.querySelectorAll('a[href^="/create?prompt="]').length).toBe(0);
  expect(article.querySelectorAll("[data-gallery-remix]").length).toBe(0);
  expect(article.querySelectorAll("[data-gallery-manual-create]").length).toBe(1);
  expect(article.querySelectorAll("[data-gallery-remix-fallback]").length).toBe(1);
  const explanation = article.querySelector<HTMLElement>("[data-gallery-remix-fallback]")!;
  const manual = within(article).getByRole("link", { name: viewer.manualLabel });
  const copy = within(article).getByRole("button", { name: "复制提示词" });
  const textarea = within(article).getByRole("textbox") as HTMLTextAreaElement;
  expect(explanation).toHaveTextContent("无法通过链接预填");
  expect(explanation).toHaveTextContent("复制完整内容");
  expect(explanation).toHaveTextContent("手动粘贴");
  expect(explanation).toHaveTextContent("不会携带提示词");
  expect(explanation).toHaveTextContent("手动切回「对话」粘贴");
  expect(manual).toHaveAttribute("href", viewer.manualHref);
  expect(manual).toHaveAttribute("data-gallery-manual-create");
  expect(new URL(manual.getAttribute("href")!, "https://unit.invalid").search).toBe("");
  for (const control of [manual, copy, textarea]) {
    expect(control).toHaveAccessibleDescription(/无法通过链接预填.*手动粘贴/);
    expect(control.getAttribute("aria-describedby")?.split(/\s+/)).toContain(explanation.id);
  }
  expect(textarea).toHaveAttribute("readonly");
  expect(textarea).toHaveAccessibleName("完整公开提示词 title-remix");
  expect(copy).toHaveAttribute("type", "button");
  expect(copy.closest("a")).toBeNull();
  expect(article.querySelector("a button, button a")).toBeNull();
  for (const link of article.querySelectorAll("a[href]")) {
    expect(link.getAttribute("href")!.length).toBeLessThanOrEqual(8192);
  }
  return { copy, manual, textarea, explanation };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
  vi.stubGlobal("IntersectionObserver", undefined);
  vi.spyOn(window.history, "pushState");
  vi.spyOn(window.history, "replaceState");
  vi.spyOn(Storage.prototype, "setItem");
  clipboard(vi.fn().mockResolvedValue(undefined));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
});

describe.each(viewers)("bounded gallery remix for $viewer", (viewer) => {
  const seeds = [
    { kind: "ASCII", leading: "", trailing: "" },
    { kind: "reserved symbols", leading: "&?=+#%/", trailing: "" },
    { kind: "Chinese", leading: "光影".repeat(400), trailing: "" },
    { kind: "emoji", leading: "🦊".repeat(200), trailing: "" },
    { kind: "whitespace, newlines and unnormalized Unicode", leading: " \n\t e\u0301 ", trailing: "  \n " },
  ];
  const boundaries = seeds.flatMap((seed) => [8191, 8192, 8193].map((bytes) => ({ ...seed, bytes })));

  it.each(boundaries)("uses the full $bytes-byte request target for $kind", ({ leading, trailing, bytes }) => {
    const padding = bytes - requestPrefix.length - encodeURIComponent(leading + trailing).length;
    const prompt = leading + "a".repeat(padding) + trailing;
    const target = requestTarget(prompt);
    expect(Buffer.byteLength(target, "utf8")).toBe(bytes);
    const article = openPrompt(prompt, viewer.authenticated);
    expect(within(article).getByRole("textbox")).toHaveValue(prompt);
    if (bytes <= 8192) {
      const direct = within(article).getByRole("link", { name: viewer.directLabel });
      expect(direct).toHaveAttribute("data-gallery-remix");
      expect(direct).toHaveAttribute("href", viewer.authenticated ? target : "/login");
      expect(article.querySelector("[data-gallery-manual-create]")).toBeNull();
      expect(article.querySelector("[data-gallery-remix-fallback]")).toBeNull();
      if (viewer.authenticated) {
        const url = new URL(direct.getAttribute("href")!, "https://unit.invalid");
        expect([...url.searchParams.keys()]).toEqual(["prompt"]);
        expect(url.searchParams.get("prompt")).toBe(prompt);
      }
    } else {
      expectManualBranch(article, viewer);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  const manualPrompts = [
    { kind: "8000 Chinese units", prompt: "中".repeat(8000) },
    { kind: "8001 Chinese units", prompt: "一".repeat(8001) },
    { kind: "8000 emoji units", prompt: "🦊".repeat(4000) },
    { kind: "8000 emoji characters", prompt: "🦊".repeat(8000) },
    { kind: "reserved characters and original whitespace", prompt: `  \n${"&?#+% e\u0301 🦊\n".repeat(500)}\t  ` },
    { kind: "unpaired high surrogate", prompt: "  original \ud800 text\n  " },
    { kind: "unpaired low surrogate", prompt: "  original \udfff text\n  " },
    { kind: "reversed surrogate pair", prompt: "  original \udfff\ud800 text\n  " },
  ];

  it.each(manualPrompts)("copies the complete $kind without navigation, requests or storage", async ({ prompt }) => {
    const user = userEvent.setup();
    const pending = deferred<void>();
    const write = vi.fn().mockReturnValue(pending.promise);
    clipboard(write);
    const location = window.location.href;
    const article = openPrompt(prompt, viewer.authenticated);
    const { copy, textarea, explanation } = expectManualBranch(article, viewer);
    expect(textarea).toHaveValue(prompt);
    expect(article).not.toHaveTextContent("创作台仅预填前");
    if (prompt.length > 8000) {
      expect(explanation).toHaveTextContent("创作台输入上限为 8000 个字符");
      expect(explanation).toHaveTextContent("请先缩短再粘贴");
    } else {
      expect(explanation).not.toHaveTextContent("请先缩短再粘贴");
    }
    if (!viewer.authenticated) {
      expect(screen.getByText(/登录后请返回首页社区精选，重新选择作品/)).toBeInTheDocument();
    }
    await user.click(copy);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(prompt);
    expect(within(article).getByRole("button", { name: "复制中" })).toBeDisabled();
    expect(within(article).queryByText("完整提示词已复制。")).not.toBeInTheDocument();
    expectNoSideEffects(location);
    await act(async () => pending.resolve());
    expect(within(article).getByRole("status")).toHaveTextContent("完整提示词已复制。");
    expect(textarea).toHaveValue(prompt);
    expectNoSideEffects(location);
  });

  it.each(["denied", "absent"])("selects the complete long text when Clipboard is %s", async (mode) => {
    const user = userEvent.setup();
    const prompt = `  \n${"保留原文🦊".repeat(1600)}\n  `;
    const write = vi.fn().mockRejectedValue(new Error("NotAllowed"));
    clipboard(mode === "denied" ? write : undefined);
    const location = window.location.href;
    const article = openPrompt(prompt, viewer.authenticated);
    const { copy, textarea, manual } = expectManualBranch(article, viewer);
    await user.click(copy);
    await waitFor(() => expect(within(article).getByRole("status")).toHaveTextContent(GALLERY_MESSAGES.clipboardManual));
    expect(textarea).toHaveValue(prompt);
    expect(textarea).toHaveFocus();
    expect(textarea.selectionStart).toBe(0);
    expect(textarea.selectionEnd).toBe(prompt.length);
    expect(within(article).queryByText("完整提示词已复制。")).not.toBeInTheDocument();
    expect(manual).toHaveAttribute("href", viewer.manualHref);
    expectNoSideEffects(location);
  });

  it("keeps the existing copy deadline and ignores late completion in the manual branch", async () => {
    vi.useFakeTimers();
    const prompt = "中".repeat(8000);
    const pending = deferred<void>();
    clipboard(vi.fn().mockReturnValue(pending.promise));
    const location = window.location.href;
    const article = openPrompt(prompt, viewer.authenticated);
    const { copy, textarea } = expectManualBranch(article, viewer);
    fireEvent.click(copy);
    await act(async () => { vi.advanceTimersByTime(HOME_MOTION.clipboardDeadlineMs); });
    expect(within(article).getByRole("status")).toHaveTextContent(GALLERY_MESSAGES.clipboardManual);
    expect(textarea).toHaveFocus();
    expect(textarea.selectionEnd).toBe(prompt.length);
    await act(async () => pending.resolve());
    expect(within(article).getByRole("status")).toHaveTextContent(GALLERY_MESSAGES.clipboardManual);
    expect(within(article).queryByText("完整提示词已复制。")).not.toBeInTheDocument();
    expectNoSideEffects(location);
  });

  it.each(["private", "missing", "blank"])("does not expose any prompt action when permission/text is %s", (kind) => {
    const hidden = "UNAUTHORIZED_RAW_PROMPT_" + "中".repeat(8000);
    const work = createGalleryWork("remix", { prompt: kind === "blank" ? " \n\t " : hidden, showPromptPublic: kind !== "private" });
    if (kind === "missing") delete (work as Partial<SerializedFeaturedWork>).showPromptPublic;
    const article = renderWork(work, viewer.authenticated);
    fireEvent.click(within(article).getByRole("button", { name: "查看提示词 title-remix" }));
    expect(article.textContent?.includes("UNAUTHORIZED_RAW_PROMPT_")).toBe(false);
    expect(within(article).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(article).queryByRole("button", { name: "复制提示词" })).not.toBeInTheDocument();
    expect(article.querySelector("[data-gallery-remix], [data-gallery-manual-create], [data-gallery-remix-fallback]")).toBeNull();
    expect(within(article).getByText(kind === "blank" ? GALLERY_MESSAGES.emptyPrompt : GALLERY_MESSAGES.hiddenPrompt)).toBeInTheDocument();
    expect(within(article).getByRole("link", { name: "查看作品 title-remix" })).toBeInTheDocument();
    expect(within(article).getByRole("button", { name: "点赞 title-remix" })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the manual path reachable by disclosure, keyboard copy and ordinary link focus", async () => {
    const user = userEvent.setup();
    const prompt = "中".repeat(8000);
    const write = vi.fn().mockResolvedValue(undefined);
    clipboard(write);
    const location = window.location.href;
    const article = renderWork(createGalleryWork("remix", { prompt }), viewer.authenticated);
    expect(within(article).queryByRole("textbox")).not.toBeInTheDocument();
    await user.tab();
    expect(within(article).getByRole("link", { name: "查看作品 title-remix" })).toHaveFocus();
    await user.keyboard("{Escape}");
    const disclosure = within(article).getByRole("button", { name: "查看提示词 title-remix" });
    expect(disclosure).toHaveFocus();
    await user.keyboard("{Enter}");
    const { copy, manual, textarea } = expectManualBranch(article, viewer);
    await user.tab();
    expect(textarea).toHaveFocus();
    await user.tab();
    expect(copy).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(write).toHaveBeenCalledWith(prompt));
    await user.tab();
    expect(manual).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(disclosure).toHaveFocus();
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(within(article).queryByRole("textbox")).not.toBeInTheDocument();
    expectNoSideEffects(location);
  });
});

it.each([8000, 8001])("preserves the complete %s-unit ASCII URL and copy with the truthful prefill warning", async (length) => {
  const user = userEvent.setup();
  const prompt = "a".repeat(length);
  const write = vi.fn().mockResolvedValue(undefined);
  clipboard(write);
  const location = window.location.href;
  const article = openPrompt(prompt, true);
  expect(within(article).getByRole("textbox")).toHaveValue(prompt);
  expect(within(article).getByRole("link", { name: "做同款" })).toHaveAttribute("href", requestTarget(prompt));
  expect(article.querySelector("[data-gallery-remix-fallback]")).toBeNull();
  const warning = within(article).queryByText("创作台仅预填前 8000 个字符；复制保留完整内容。");
  if (length > 8000) expect(warning).toBeInTheDocument();
  else expect(warning).not.toBeInTheDocument();
  await user.click(within(article).getByRole("button", { name: "复制提示词" }));
  await waitFor(() => expect(within(article).getByRole("status")).toHaveTextContent("完整提示词已复制。"));
  expect(write).toHaveBeenCalledWith(prompt);
  expectNoSideEffects(location);
});
