import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";

import { ChatPane } from "@/components/create/parts/chat-pane";
import { ImageZoomModal } from "@/components/create/parts/image-zoom-modal";

type Props = ComponentProps<typeof ChatPane>;
function paneProps(): Props {
  return {
    focusRequest: 0,
    stream: { generations: [], onZoom: vi.fn(), onDownload: vi.fn(), onUseForEdit: vi.fn() },
    composer: {
      prompt: "Retained draft", onChangePrompt: vi.fn(), onPaste: vi.fn(), onKeyDownEnter: vi.fn(),
      isPending: false, error: null, onDismissError: vi.fn(), generationType: "text_to_image", onChangeGenerationType: vi.fn(),
      referenceImages: [{ id: "local", file: new File(["original"], "original.png", { type: "image/png" }), previewUrl: "blob:original" }],
      onPickFiles: vi.fn(), onPickImageUrl: vi.fn(), onRemoveReference: vi.fn(), onMoveReference: vi.fn(), onReorderReference: vi.fn(),
      size: "auto", sizeSelectValue: "auto", onSizeSelect: vi.fn(), showSettings: false, onToggleSettings: vi.fn(),
      channels: [], selectedChannelId: null, onChangeChannel: vi.fn(), modelOptions: ["gpt-image-2"], model: "gpt-image-2", onChangeModel: vi.fn(),
      providerMode: "built_in", activeModel: "gpt-image-2", onOpenCustomProviderSettings: vi.fn(),
      onSubmit: vi.fn(), canSubmit: true, onClickImageMode: vi.fn(),
    },
  };
}

class ObservedResize implements ResizeObserver {
  target: Element | null = null;
  disconnect = vi.fn();
  unobserve = vi.fn();
  constructor(readonly callback: ResizeObserverCallback) { observers.push(this); }
  observe(target: Element) { this.target = target; }
  resize() { this.callback([], this); }
}

let observers: ObservedResize[];
let frames: Map<number, FrameRequestCallback>;
let frameId: number;
let height: number;

function streamElement() { return screen.getByText("你好，你想创作什么？").closest(".premium-scrollbar") as HTMLElement; }

beforeEach(() => {
  observers = []; frames = new Map(); frameId = 0; height = 180;
  vi.stubGlobal("ResizeObserver", ObservedResize);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => { frames.delete(id); }));
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({
    bottom: height, height, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0, toJSON: () => ({}),
  }));
  vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get").mockReturnValue(230);
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("chat pane DOM lifetime", () => {
  it("reattaches composer observation and textarea sizing on remount without owning draft/reference cleanup", () => {
    const props = paneProps();
    const { rerender } = render(<ChatPane {...props} />);
    expect(streamElement()).toHaveStyle({ paddingBottom: "192px" });
    expect(screen.getByRole("textbox")).toHaveStyle({ height: "144px" });
    const firstShell = observers[0].target;
    height = 280;
    act(() => observers[0].resize());
    expect(streamElement()).toHaveStyle({ paddingBottom: "292px" });
    rerender(<div>Other renderer</div>);
    expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    height = 210;
    rerender(<ChatPane {...props} />);
    expect(observers[1].target).not.toBe(firstShell);
    expect(streamElement()).toHaveStyle({ paddingBottom: "222px" });
    expect(screen.getByRole("textbox")).toHaveValue("Retained draft");
    expect(screen.getByRole("textbox")).toHaveStyle({ height: "144px" });
    expect(screen.getByAltText("Reference")).toHaveAttribute("src", "blob:original");
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it("keeps IME/Shift-Enter local and focuses only the live remounted textarea", () => {
    const props = paneProps();
    const { rerender } = render(<ChatPane {...props} focusRequest={1} />);
    const firstTextarea = screen.getByRole("textbox");
    fireEvent.compositionStart(firstTextarea);
    fireEvent.keyDown(firstTextarea, { key: "Enter" });
    expect(props.composer.onKeyDownEnter).not.toHaveBeenCalled();
    rerender(<div>Other renderer</div>);
    expect(cancelAnimationFrame).toHaveBeenCalled();
    rerender(<ChatPane {...props} focusRequest={1} />);
    const nextTextarea = screen.getByRole("textbox");
    act(() => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback(0)); });
    expect(nextTextarea).toHaveFocus();
    expect(nextTextarea).not.toBe(firstTextarea);
    fireEvent.keyDown(nextTextarea, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(nextTextarea, { key: "Enter", isComposing: true });
    expect(props.composer.onKeyDownEnter).not.toHaveBeenCalled();
    fireEvent.keyDown(nextTextarea, { key: "Enter" });
    expect(props.composer.onKeyDownEnter).toHaveBeenCalledTimes(1);
  });

  it("does not drag a reader to the bottom and cleans up the resize fallback", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const props = paneProps();
    const { rerender, unmount } = render(<ChatPane {...props} />);
    const element = streamElement();
    const scroll = vi.fn();
    Object.defineProperties(element, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 100 },
      scrollTo: { configurable: true, value: scroll },
    });
    element.scrollTop = 100;
    rerender(<ChatPane {...props} stream={{ ...props.stream, generations: [] }} />);
    expect(scroll).not.toHaveBeenCalled();
    element.scrollTop = 850;
    rerender(<ChatPane {...props} stream={{ ...props.stream, generations: [] }} />);
    expect(scroll).toHaveBeenCalledWith({ top: 1000, behavior: "smooth" });
    height = 250;
    fireEvent.resize(window);
    expect(streamElement()).toHaveStyle({ paddingBottom: "262px" });
    const listener = add.mock.calls.find(([event]) => event === "resize")?.[1];
    expect(listener).toBeDefined();
    unmount();
    expect(remove).toHaveBeenCalledWith("resize", listener);
  });

  it("omits the viewer edit action when the caller supplies no writable target", () => {
    const download = vi.fn();
    const edit = vi.fn();
    const close = vi.fn();
    const src = "https://example.test/image.png";
    const { rerender } = render(<ImageZoomModal src={src} onDownload={download} onClose={close} />);
    expect(screen.queryByRole("button", { name: "加入编辑" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "保存高清原图" }));
    expect(download).toHaveBeenCalledWith(src);
    rerender(<ImageZoomModal src={src} onDownload={download} onClose={close} onUseForEdit={edit} />);
    fireEvent.click(screen.getByRole("button", { name: "加入编辑" }));
    expect(edit).toHaveBeenCalledWith(src);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
