import { useMemo, useSyncExternalStore } from "react";
import { vi } from "vitest";

import { CanvasStage, type CanvasStageProps } from "@/components/create/parts/canvas-stage";
import type { CanvasController } from "@/components/create/canvas/controller";
import type { CanvasNodeActions } from "@/components/create/canvas/renderer-types";

export function canvasStageCallbacks() {
  return { onViewImage: vi.fn(), onDownloadImage: vi.fn(), onOpenProviderSettings: vi.fn(), onReturnToChat: vi.fn() };
}

export function canvasNodeActions(): CanvasNodeActions {
  return { updatePrompt: vi.fn(() => true), replaceReference: vi.fn(), acquirePreview: vi.fn(() => null), removeNode: vi.fn(), inspectNode: vi.fn(), runNode: vi.fn(),
    retryTransport: vi.fn(), recoverRuns: vi.fn(), refreshRuntime: vi.fn(), viewImage: vi.fn(), downloadImage: vi.fn(), reportError: vi.fn() };
}

export const canvasStageChannels = [
  { id: "channel-account", name: "账户渠道", defaultModel: "image-account-default", models: ["image-account-default", "image-account-second"], creditCost: 1 },
  { id: "another-channel", name: "备用渠道", defaultModel: "another-default", models: ["another-default"], creditCost: 2 },
];

type CanvasStageHarnessProps = Partial<Omit<CanvasStageProps, "snapshot" | "controller">> & { controller: CanvasController };
export function CanvasStageHarness({ controller, ...props }: CanvasStageHarnessProps) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const callbacks = useMemo(() => canvasStageCallbacks(), []);
  return <CanvasStage channels={canvasStageChannels} {...callbacks} {...props} snapshot={snapshot} controller={controller} />;
}

// jsdom supplies events, not layout. Only DOM geometry/ResizeObserver are faked;
// React Flow, its handles/keyboard behavior and the stage remain real components.
export function installCanvasDom() {
  let automaticResizeDelivery = true;
  const observers = new Set<CanvasResizeObserver>();
  class CanvasResizeObserver implements ResizeObserver {
    private targets = new Set<Element>();
    private reportedSizes = new WeakMap<Element, { width: number; height: number }>();
    constructor(private callback: ResizeObserverCallback) { observers.add(this); }
    observe(target: Element) {
      if (this.targets.has(target)) return;
      this.targets.add(target);
      queueMicrotask(() => { if (automaticResizeDelivery) this.deliver(); });
    }
    deliver() {
      const entries: ResizeObserverEntry[] = [];
      for (const target of this.targets) {
        const contentRect = target.getBoundingClientRect();
        const previous = this.reportedSizes.get(target);
        if (previous?.width === contentRect.width && previous.height === contentRect.height) continue;
        this.reportedSizes.set(target, { width: contentRect.width, height: contentRect.height });
        const size = { inlineSize: contentRect.width, blockSize: contentRect.height };
        entries.push({ target, contentRect, contentBoxSize: [size], borderBoxSize: [size], devicePixelContentBoxSize: [size] });
      }
      if (entries.length) this.callback(entries, this);
    }
    unobserve(target: Element) { this.targets.delete(target); this.reportedSizes.delete(target); }
    disconnect() { this.targets.clear(); this.reportedSizes = new WeakMap(); }
  }
  class CanvasDOMMatrixReadOnly {
    m22 = 1;
    constructor(transform: string) { this.m22 = Number(transform.match(/scale\(([^)]+)\)/)?.[1] ?? 1); }
  }
  vi.stubGlobal("ResizeObserver", CanvasResizeObserver);
  vi.stubGlobal("DOMMatrixReadOnly", CanvasDOMMatrixReadOnly);
  const originalBBox = Object.getOwnPropertyDescriptor(SVGElement.prototype, "getBBox");
  Object.defineProperty(SVGElement.prototype, "getBBox", { configurable: true, value: () => ({ x: 0, y: 0, width: 60, height: 14 }) });
  const originalElementFromPoint = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => null });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("react-flow__node") ? 288 : 1000; });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("react-flow__node") ? 280 : 600; });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const width = this.classList.contains("react-flow__node") ? 288 : 1000;
    const height = this.classList.contains("react-flow__node") ? 280 : 600;
    return { width, height, x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, toJSON: () => ({}) };
  });
  const restore = () => {
    if (originalBBox) Object.defineProperty(SVGElement.prototype, "getBBox", originalBBox); else Reflect.deleteProperty(SVGElement.prototype, "getBBox");
    if (originalElementFromPoint) Object.defineProperty(document, "elementFromPoint", originalElementFromPoint); else Reflect.deleteProperty(document, "elementFromPoint");
  };
  return Object.assign(restore, {
    pauseResizeDelivery: () => { automaticResizeDelivery = false; },
    deliverResizes: () => { for (const observer of observers) observer.deliver(); },
  });
}
