import { act, cleanup, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { canvasVisibleBounds } from "@/components/create/canvas/mobile-interaction";
import { useCanvasMobileViewport } from "@/components/create/hooks/use-canvas-mobile-viewport";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("scoped canvas visible bounds", () => {
  it("intersects element bounds with actual visual viewport offsets rather than changing the scene camera", () => {
    expect(canvasVisibleBounds({ top: 100, left: 20, width: 390, height: 650 }, { offsetTop: 180, offsetLeft: 0, width: 390, height: 300 }, { width: 390, height: 800 }))
      .toEqual({ top: 180, left: 20, width: 370, height: 300 });
    expect(canvasVisibleBounds({ top: 100, left: 20, width: 390, height: 650 }, { offsetTop: 0, offsetLeft: 50, width: 300, height: 250 }, { width: 390, height: 800 }))
      .toEqual({ top: 100, left: 50, width: 300, height: 150 });
  });

  it("returns a finite fallback for broken/missing metrics, and never negative intersection sizes", () => {
    expect(canvasVisibleBounds(null, null, { width: NaN, height: Infinity })).toEqual({ top: 0, left: 0, width: 360, height: 640 });
    const bounds = canvasVisibleBounds({ top: 600, left: 800, width: 390, height: 600 }, { offsetTop: 0, offsetLeft: 0, width: 390, height: 300 }, { width: 390, height: 800 });
    expect(bounds.width).toBe(0); expect(bounds.height).toBe(0);
  });

  it("observes element/keyboard resize and scroll, keeps focused DOM, and cleans every listener, observer and scheduled frame", () => {
    const viewport = Object.assign(new EventTarget(), { offsetTop: 0, offsetLeft: 0, width: 390, height: 780 });
    const add = vi.spyOn(viewport, "addEventListener");
    const remove = vi.spyOn(viewport, "removeEventListener");
    vi.stubGlobal("visualViewport", viewport);
    let scopeHeight = 640;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ top: 100, left: 0, width: 390, height: scopeHeight, right: 390, bottom: 100 + scopeHeight, x: 0, y: 100, toJSON: () => ({}) }));
    const disconnect = vi.fn();
    let notifyResize: ResizeObserverCallback | undefined;
    vi.stubGlobal("ResizeObserver", class { constructor(callback: ResizeObserverCallback) { notifyResize = callback; } observe = vi.fn(); disconnect = disconnect; });
    const frames = new Map<number, FrameRequestCallback>();
    let sequence = 0;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; }));
    const cancel = vi.fn((id: number) => { frames.delete(id); });
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const flush = () => act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback(0)); });
    function Probe() {
      const scope = useRef<HTMLDivElement>(null);
      const visible = useCanvasMobileViewport(scope);
      return <div ref={scope} style={visible.style} data-testid="visible"><input aria-label="stable input" defaultValue="中文" /></div>;
    }
    const view = render(<Probe />);
    flush();
    const element = screen.getByTestId("visible");
    const input = screen.getByLabelText("stable input");
    act(() => input.focus());
    expect(element.style.getPropertyValue("--canvas-visible-height")).toBe("640px");
    act(() => { viewport.offsetTop = 130; viewport.height = 260; viewport.dispatchEvent(new Event("resize")); viewport.dispatchEvent(new Event("scroll")); });
    flush();
    expect(element.style.getPropertyValue("--canvas-visible-top")).toBe("130px");
    expect(element.style.getPropertyValue("--canvas-visible-height")).toBe("260px");
    expect(element.style.getPropertyValue("--canvas-panel-height")).toBe("260px");
    scopeHeight = 100;
    act(() => notifyResize?.([], {} as ResizeObserver));
    flush();
    expect(element.style.getPropertyValue("--canvas-visible-height")).toBe("70px");
    expect(screen.getByLabelText("stable input")).toBe(input);
    expect(input).toHaveFocus();
    act(() => viewport.dispatchEvent(new Event("scroll")));
    view.unmount();
    expect(frames.size).toBe(0);
    expect(cancel).toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledOnce();
    for (const [name, listener] of add.mock.calls) expect(remove).toHaveBeenCalledWith(name, listener);
  });
});
