import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { router } = vi.hoisted(() => ({ router: { push: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { FeaturedGallery } from "@/components/marketing/featured-gallery";
import { GALLERY_MESSAGES } from "@/components/marketing/homepage/gallery-constants";
import type { SerializedFeaturedWork } from "@/lib/prisma-mappers";

import { createGalleryWork, deferred, galleryCursor, galleryPage, galleryWorks, installGalleryObserver, jsonResponse } from "./helpers/gallery-fixtures";

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
function clipboard(writeText?: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: writeText ? { writeText } : undefined });
}
function card(id = "work_1") { return screen.getByRole("article", { name: `title-${id}` }); }
function disclose(id = "work_1") { fireEvent.click(within(card(id)).getByRole("button", { name: /^查看提示词/ })); }
function detailLinks() { return screen.queryAllByRole("link", { name: /^查看作品 / }); }

beforeEach(() => {
  router.push.mockReset();
  vi.stubGlobal("fetch", vi.fn());
  vi.stubGlobal("IntersectionObserver", undefined);
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

describe("live editorial gallery", () => {
  it("loads real next-page data through the shared observer/button command and deduplicates", async () => {
    const observer = installGalleryObserver();
    const pending = deferred<ReturnType<typeof jsonResponse>>();
    vi.mocked(fetch).mockReturnValue(pending.promise);
    render(<FeaturedGallery works={galleryWorks(1)} initialHasMore initialNextCursor={galleryCursor(1)} />);
    expect(detailLinks()).toHaveLength(16);
    const oldObserver = observer.sentinel();
    act(() => {
      oldObserver.trigger();
      fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
      oldObserver.trigger();
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "加载中..." })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("正在加载精选作品");
    await act(async () => { pending.resolve(jsonResponse(galleryPage([createGalleryWork("work_16"), createGalleryWork("work_17")]))); });
    expect(detailLinks()).toHaveLength(17);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(`/api/works/featured?cursor=${encodeURIComponent(galleryCursor(1))}&limit=16`);
    expect(screen.getByText(/本次精选已浏览完/)).toBeInTheDocument();
    expect(oldObserver.disconnect).toHaveBeenCalled();
  });

  it("shows an honest empty feed separately from an initial failure and retries the first page", async () => {
    const { rerender } = render(<FeaturedGallery key="empty" works={[]} />);
    expect(screen.getByText(/精选作品还在筹备中/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    rerender(<FeaturedGallery key="failed" works={[]} initialError />);
    expect(screen.queryByText(/精选作品还在筹备中/)).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(GALLERY_MESSAGES.bootstrapError);
    vi.mocked(fetch).mockResolvedValue(jsonResponse(galleryPage([createGalleryWork("recovered")])));
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    await waitFor(() => expect(detailLinks()).toHaveLength(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/works/featured?limit=16");
  });

  it("keeps successful works on error, suppresses stale auto callbacks and retries explicitly", async () => {
    const observers = installGalleryObserver();
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(null, 503)).mockResolvedValueOnce(jsonResponse(galleryPage(galleryWorks(17))));
    render(<FeaturedGallery works={galleryWorks(1)} initialHasMore initialNextCursor={galleryCursor(1)} />);
    const old = observers.sentinel();
    await act(async () => old.trigger());
    expect(screen.getByRole("alert")).toHaveTextContent(GALLERY_MESSAGES.pageError);
    expect(detailLinks()).toHaveLength(16);
    await act(async () => { old.trigger(); old.trigger(); });
    expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    await waitFor(() => expect(detailLinks()).toHaveLength(32));
    expect(vi.mocked(fetch).mock.calls[1][0]).toBe(vi.mocked(fetch).mock.calls[0][0]);
  });

  it("labels the 72-work display limit rather than claiming the collection is exhausted", () => {
    render(<FeaturedGallery works={galleryWorks(1, 80)} initialHasMore initialNextCursor={galleryCursor(5)} />);
    expect(detailLinks()).toHaveLength(72);
    expect(screen.getByText(/已达首页展示上限/)).toHaveTextContent("72");
    expect(screen.queryByText(/本次精选已浏览完/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "加载更多" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /全部作品|公共展厅/ })).not.toBeInTheDocument();
  });

  it.each(["absent", "throwing"])("keeps the manual command usable with an %s observer", async (mode) => {
    if (mode === "throwing") vi.stubGlobal("IntersectionObserver", class { constructor() { throw new Error("unavailable"); } });
    vi.mocked(fetch).mockResolvedValue(jsonResponse(galleryPage(galleryWorks(17))));
    render(<FeaturedGallery works={galleryWorks(1)} initialHasMore initialNextCursor={galleryCursor(1)} />);
    fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
    await waitFor(() => expect(detailLinks()).toHaveLength(32));
  });

  it("falls back from optimized preview to original once, then keeps detail navigation on failure", () => {
    render(<FeaturedGallery works={[createGalleryWork("work_1", { size: "1792x1024" })]} />);
    const image = screen.getByAltText("title-work_1");
    expect(image).toHaveAttribute("src", expect.stringContaining("/_next/image"));
    fireEvent.error(image);
    expect(image).toHaveAttribute("src", "https://images.example.invalid/work_1.png");
    expect(image).not.toHaveAttribute("srcset");
    fireEvent.error(image);
    expect(screen.getByText(/图片暂时无法加载/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看作品 title-work_1" })).toHaveAttribute("href", "/works/work_1");
  });

  it("separates the entrance/tilt/clipping/depth layers and the five controls", () => {
    const { container } = render(<FeaturedGallery works={[createGalleryWork("work_1")]} isAuthenticated />);
    disclose();
    const tilt = container.querySelector("[data-gallery-tilt]")!;
    expect(tilt.closest("[data-home-reveal]")).not.toBe(tilt);
    const clipping = tilt.querySelector("[data-gallery-image-layer]")!;
    expect(clipping).not.toContainElement(tilt.querySelector("[data-gallery-info]"));
    expect(clipping).not.toContainElement(tilt.querySelector("[data-gallery-glare]"));
    expect(container.querySelector("a button, button a")).toBeNull();
    expect(within(card()).getByRole("link", { name: "做同款" })).toBeInTheDocument();
    expect(within(card()).getByRole("button", { name: "复制提示词" })).toBeInTheDocument();
    expect(within(card()).getByRole("button", { name: "点赞 title-work_1" })).toBeInTheDocument();
  });
});

describe("public prompt controls", () => {
  it.each([false, undefined])("fails closed with public permission %s even if raw text is nonempty", (flag) => {
    const work = createGalleryWork("work_1", { prompt: "HIDDEN_SENTINEL_DO_NOT_RENDER", showPromptPublic: flag as boolean });
    const { container } = render(<FeaturedGallery works={[work]} isAuthenticated />);
    disclose();
    expect(container).not.toHaveTextContent("HIDDEN_SENTINEL_DO_NOT_RENDER");
    expect(container.querySelector("textarea")).toBeNull();
    expect(screen.getByText(GALLERY_MESSAGES.hiddenPrompt)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "复制提示词" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /做同款/ })).not.toBeInTheDocument();
    expect(detailLinks()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "点赞 title-work_1" })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects blank public text, but accepts genuinely public text equal to the old placeholder", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    clipboard(write);
    const { rerender } = render(<FeaturedGallery key="blank" works={[createGalleryWork("work_1", { prompt: " \n\t " })]} />);
    disclose();
    expect(screen.getByText(GALLERY_MESSAGES.emptyPrompt)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "复制提示词" })).not.toBeInTheDocument();
    rerender(<FeaturedGallery key="public" works={[createGalleryWork("work_1", { prompt: "作者未公开提示词" })]} isAuthenticated />);
    disclose();
    fireEvent.click(screen.getByRole("button", { name: "复制提示词" }));
    await waitFor(() => expect(screen.getByText("完整提示词已复制。")).toBeInTheDocument());
    expect(write).toHaveBeenCalledWith("作者未公开提示词");
    expect(screen.getByRole("link", { name: "做同款" })).toHaveAttribute("href", `/create?prompt=${encodeURIComponent("作者未公开提示词")}`);
  });

  it("copies and encodes the entire selected positive prompt verbatim, never the title or a preview", async () => {
    const full = `  光影 & ? # + %\n${"长提示词".repeat(70)}\n终章 🦊  `;
    const write = vi.fn().mockResolvedValue(undefined);
    clipboard(write);
    render(<FeaturedGallery works={[createGalleryWork("work_1", { prompt: full }), createGalleryWork("work_2")]} isAuthenticated />);
    disclose();
    expect(screen.getByRole("textbox", { name: "完整公开提示词 title-work_1" })).toHaveValue(full);
    const remix = screen.getByRole("link", { name: "做同款" });
    const url = new URL(remix.getAttribute("href")!, "https://unit.invalid");
    expect(url.pathname).toBe("/create");
    expect([...url.searchParams.keys()]).toEqual(["prompt"]);
    expect(url.searchParams.get("prompt")).toBe(full);
    fireEvent.click(screen.getByRole("button", { name: "复制提示词" }));
    await waitFor(() => expect(screen.getByText("完整提示词已复制。")).toBeInTheDocument());
    expect(write).toHaveBeenCalledWith(full);
    expect(fetch).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it.each(["denied", "absent"])("offers selected complete manual text when clipboard is %s", async (mode) => {
    const full = "  完整提示词\n保留换行和空白  ";
    clipboard(mode === "denied" ? vi.fn().mockRejectedValue(new Error("NotAllowed")) : undefined);
    render(<FeaturedGallery works={[createGalleryWork("work_1", { prompt: full })]} />);
    disclose();
    fireEvent.click(screen.getByRole("button", { name: "复制提示词" }));
    await waitFor(() => expect(screen.getByText(GALLERY_MESSAGES.clipboardManual)).toBeInTheDocument());
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea).toHaveValue(full);
    expect(textarea).toHaveFocus();
    expect(textarea.selectionStart).toBe(0);
    expect(textarea.selectionEnd).toBe(full.length);
    expect(screen.queryByText("完整提示词已复制。")).not.toBeInTheDocument();
  });

  it("keeps guest copying available and explains login-and-return instead of promising continuation", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    clipboard(write);
    render(<FeaturedGallery works={[createGalleryWork("work_1")]} />);
    expect(screen.getByText(/登录后请返回首页社区精选，重新选择作品/)).toBeInTheDocument();
    expect(screen.getByText(/手动切回「对话」/)).toBeInTheDocument();
    disclose();
    expect(screen.getByRole("link", { name: "登录后做同款" })).toHaveAttribute("href", "/login");
    fireEvent.click(screen.getByRole("button", { name: "复制提示词" }));
    await waitFor(() => expect(write).toHaveBeenCalledWith("public prompt work_1"));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves full ASCII text and warns about the existing 8000-unit prefill boundary", () => {
    const full = "a".repeat(8001);
    render(<FeaturedGallery works={[createGalleryWork("work_1", { prompt: full })]} isAuthenticated />);
    disclose();
    expect(screen.getByText(/创作台仅预填前 8000 个字符/)).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue(full);
    expect(new URL(screen.getByRole("link", { name: "做同款" }).getAttribute("href")!, "https://unit.invalid").searchParams.get("prompt")).toBe(full);
  });

  it("makes public/old-cache appended cards obey the same permission contract", async () => {
    const publicWork = createGalleryWork("appended", { prompt: "追加作品的完整公开原文" });
    const cached = createGalleryWork("old-cache") as Partial<SerializedFeaturedWork>;
    delete cached.showPromptPublic;
    vi.mocked(fetch).mockResolvedValue(jsonResponse(galleryPage([publicWork, cached as SerializedFeaturedWork])));
    render(<FeaturedGallery works={[createGalleryWork("work_1")]} initialHasMore initialNextCursor={galleryCursor(1)} isAuthenticated />);
    fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
    await waitFor(() => expect(detailLinks()).toHaveLength(3));
    disclose("appended");
    expect(within(card("appended")).getByRole("textbox")).toHaveValue(publicWork.prompt);
    disclose("old-cache");
    expect(within(card("old-cache")).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(card("old-cache")).getByText(GALLERY_MESSAGES.hiddenPrompt)).toBeInTheDocument();
  });

  it("supports keyboard focus, explicit disclosure, Escape close/focus return, and reopening", async () => {
    const user = userEvent.setup();
    render(<FeaturedGallery works={[createGalleryWork("work_1")]} isAuthenticated />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await user.tab();
    expect(screen.getByRole("link", { name: "查看作品 title-work_1" })).toHaveFocus();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    const disclosure = screen.getByRole("button", { name: "查看提示词 title-work_1" });
    expect(disclosure).toHaveFocus();
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(disclosure).toHaveFocus();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("opens from mouse hover, but touch can open without hover and without following the detail link", () => {
    class TestPointerEvent extends MouseEvent {
      pointerType: string;
      constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerType = init.pointerType ?? "mouse"; }
    }
    vi.stubGlobal("PointerEvent", TestPointerEvent);
    render(<FeaturedGallery works={[createGalleryWork("work_1")]} />);
    fireEvent.pointerEnter(card(), { pointerType: "mouse" });
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    fireEvent.pointerLeave(card(), { pointerType: "mouse" });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.pointerEnter(card(), { pointerType: "touch" });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    const disclosure = screen.getByRole("button", { name: "查看提示词 title-work_1" });
    act(() => disclosure.focus());
    fireEvent.click(disclosure);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });
});
