import { act } from "@testing-library/react";

import { HOME_MEDIA } from "@/components/marketing/homepage/constants";

export function installHomeMotionEnvironment() {
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  let hidden = false;
  const media = new Map<string, { matches: boolean; callbacks: Set<() => void> }>();
  const observers: ControlledIntersectionObserver[] = [];
  const resizeObservers: ControlledResizeObserver[] = [];

  class ControlledIntersectionObserver implements IntersectionObserver {
    root = null;
    rootMargin = "0px";
    thresholds = [0.05];
    targets = new Set<Element>();
    disconnected = false;
    constructor(readonly callback: IntersectionObserverCallback) { observers.push(this); }
    observe(target: Element) { this.targets.add(target); }
    unobserve(target: Element) { this.targets.delete(target); }
    disconnect() { this.disconnected = true; this.targets.clear(); }
    takeRecords() { return []; }
    emit(target: Element, isIntersecting: boolean) {
      this.callback([{ target, isIntersecting, intersectionRatio: isIntersecting ? 1 : 0, time: 0, boundingClientRect: target.getBoundingClientRect(), intersectionRect: target.getBoundingClientRect(), rootBounds: null }], this);
    }
  }
  class ControlledResizeObserver implements ResizeObserver {
    targets = new Set<Element>();
    disconnected = false;
    constructor(readonly callback: ResizeObserverCallback) { resizeObservers.push(this); }
    observe(target: Element) { this.targets.add(target); }
    unobserve(target: Element) { this.targets.delete(target); }
    disconnect() { this.disconnected = true; this.targets.clear(); }
  }

  vi.stubGlobal("IntersectionObserver", ControlledIntersectionObserver);
  vi.stubGlobal("ResizeObserver", ControlledResizeObserver);
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    const id = ++frameId;
    frames.set(id, callback);
    return id;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => frames.delete(id)));
  vi.stubGlobal("matchMedia", vi.fn((query: string): MediaQueryList => {
    if (!media.has(query)) media.set(query, { matches: query === HOME_MEDIA.finePointer, callbacks: new Set() });
    const state = media.get(query)!;
    return {
      get matches() { return state.matches; },
      media: query,
      onchange: null,
      addEventListener: (_type: string, callback: EventListenerOrEventListenerObject) => state.callbacks.add(callback as () => void),
      removeEventListener: (_type: string, callback: EventListenerOrEventListenerObject) => state.callbacks.delete(callback as () => void),
      addListener: (callback) => state.callbacks.add(callback as () => void),
      removeListener: (callback) => state.callbacks.delete(callback as () => void),
      dispatchEvent: () => true,
    };
  }));
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);

  return {
    frames, media, observers, resizeObservers,
    frame(time: number) {
      act(() => {
        const callbacks = [...frames.values()];
        frames.clear();
        callbacks.forEach((callback) => callback(time));
      });
    },
    visibility(visible: boolean) {
      act(() => observers.forEach((observer) => [...observer.targets].forEach((target) => observer.emit(target, visible))));
    },
    setMedia(query: string, matches: boolean) {
      act(() => {
        const state = media.get(query);
        if (!state) { media.set(query, { matches, callbacks: new Set() }); return; }
        state.matches = matches;
        state.callbacks.forEach((callback) => callback());
      });
    },
    setHidden(value: boolean) {
      act(() => {
        hidden = value;
        document.dispatchEvent(new Event("visibilitychange"));
      });
    },
  };
}

export function installControlledImages() {
  const images: ControlledImage[] = [];
  class ControlledImage {
    src = "";
    complete = false;
    naturalWidth = 0;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    resolveDecode: () => void = () => {};
    rejectDecode: () => void = () => {};
    decode = vi.fn(() => new Promise<void>((resolve, reject) => { this.resolveDecode = resolve; this.rejectDecode = () => reject(new Error("decode failed")); }));
    constructor() { images.push(this); }
    load() { this.complete = true; this.naturalWidth = 1200; this.onload?.(); }
    fail() { this.onerror?.(); }
  }
  vi.stubGlobal("Image", ControlledImage);
  return images;
}

export function pointerMove(element: Element, clientX: number, clientY: number, pointerType = "mouse") {
  const event = new Event("pointermove", { bubbles: true });
  Object.defineProperties(event, { clientX: { value: clientX }, clientY: { value: clientY }, pointerType: { value: pointerType } });
  act(() => element.dispatchEvent(event));
}
