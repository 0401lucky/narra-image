import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";

import { emptyCanvasControllerSnapshot } from "@/components/create/canvas/controller-types";
import type { CanvasStageProps } from "@/components/create/parts/canvas-stage";

const loader = vi.hoisted(() => ({
  failure: null as Error | null,
  pending: null as Promise<{ default: ComponentType<CanvasStageProps> }> | null,
  calls: 0,
}));
vi.mock("next/dynamic", async () => {
  const { lazy, Suspense } = await import("react");
  return { default: () => {
    const Stage = lazy(() => {
      loader.calls += 1;
      // Model Turbopack's rejected import promise: a new React.lazy cannot clear it.
      loader.pending ??= loader.failure ? Promise.reject(loader.failure)
        : Promise.resolve({ default: () => <div>Loaded canvas</div> });
      return loader.pending;
    });
    return function LazyFixture(props: CanvasStageProps) {
      return <Suspense fallback={<div role="status">Loading canvas</div>}><Stage {...props} /></Suspense>;
    };
  } };
});

function props(): CanvasStageProps {
  return {
    controller: null,
    snapshot: emptyCanvasControllerSnapshot({ ownerId: "owner-one", enabled: true, readOnly: false }),
    channels: [], onViewImage: vi.fn(), onDownloadImage: vi.fn(),
    onOpenProviderSettings: vi.fn(), onReturnToChat: vi.fn(),
  };
}

beforeEach(() => {
  vi.resetModules();
  loader.failure = null;
  loader.pending = null;
  loader.calls = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("offers honest manual-reload guidance for a cached chunk failure without a broken in-place retry", async () => {
  const failure = new Error("Failed to load chunk /_next/static/chunks/canvas.js from module 123");
  failure.name = "ChunkLoadError";
  loader.failure = failure;
  const { CanvasLazyPane } = await import("@/components/create/parts/canvas-lazy-pane");
  const input = props();
  const scripts = [...document.scripts];
  const location = window.location.href;
  render(<CanvasLazyPane {...input} />);
  await screen.findByText(/\u5f53\u524d\u9875\u9762\u65e0\u6cd5\u76f4\u63a5\u91cd\u8bd5/);
  expect(screen.getByText(/\u672a\u53d1\u9001\u7684\u5bf9\u8bdd\u5185\u5bb9/)).toBeInTheDocument();
  expect(screen.getByText(/\u672c\u5730\u4fdd\u5b58/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "\u91cd\u8bd5\u52a0\u8f7d\u753b\u5e03" })).not.toBeInTheDocument();
  loader.failure = null;
  fireEvent.click(screen.getByRole("button", { name: "\u8fd4\u56de\u5bf9\u8bdd" }));
  expect(input.onReturnToChat).toHaveBeenCalledOnce();
  expect(loader.calls).toBe(1);
  expect([...document.scripts]).toEqual(scripts);
  expect(window.location.href).toBe(location);
});
