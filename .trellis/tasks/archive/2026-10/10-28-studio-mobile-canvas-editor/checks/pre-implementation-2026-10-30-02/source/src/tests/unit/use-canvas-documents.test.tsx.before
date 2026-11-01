import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useCanvasDocuments } from "@/components/create/hooks/use-canvas-documents";
import type { CanvasControllerOptions } from "@/components/create/canvas/controller";

import { canvasControllerFixture, canvasUuid, createFakeCanvasApi, createFakeCanvasJobs, deferred, metadata } from "./helpers/canvas-controller-fixtures";

afterEach(cleanup);

function Viewer({ options, pane = "canvas" }: { options: CanvasControllerOptions; pane?: "canvas" | "chat" }) {
  const state = useCanvasDocuments(options);
  return <div>
    <span>{state.snapshot.ready ? "ready" : "loading"}</span>
    <span>{state.snapshot.ownerId}</span>
    {pane === "canvas" ? <span>{state.snapshot.active?.scene.nodes.length ?? 0} nodes</span> : <span>chat pane</span>}
    <button type="button" onClick={() => { void state.controller?.newCanvas(); }}>New</button>
  </div>;
}

describe("mounted canvas documents hook", () => {
  it("SSR does not open local storage, read preferences, or request metadata", () => {
    const f = canvasControllerFixture();
    const preferences = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    const html = renderToString(<Viewer options={{ ...f.options, preferences }} />);
    expect(html).toContain("loading");
    expect(f.api.port.list).not.toHaveBeenCalled();
    expect(f.store.port.list).not.toHaveBeenCalled();
    expect(preferences.getItem).not.toHaveBeenCalled();
    f.controller.dispose();
  });

  it("bootstraps after mount and fresh server props never replace the local draft", async () => {
    const f = canvasControllerFixture();
    const { result, rerender, unmount } = renderHook((options: CanvasControllerOptions) => useCanvasDocuments(options), { initialProps: f.options });
    await waitFor(() => expect(result.current.snapshot.ready).toBe(true));
    const controller = result.current.controller!;
    let id!: string;
    await act(async () => { id = await controller.newCanvas("Local"); });
    let prompt!: string;
    act(() => { prompt = controller.addPrompt(id, { x: 0, y: 0 }, "browser-only text"); });
    const listCount = vi.mocked(f.api.port.list).mock.calls.length;
    rerender({ ...f.options, initialCanvases: [metadata(id, { title: "stale title" })], defaultParameters: { ...f.options.defaultParameters, model: "updated-account-default" } });
    expect(result.current.controller).toBe(controller);
    expect(result.current.snapshot.active?.scene.nodes.find((node) => node.id === prompt)).toMatchObject({ text: "browser-only text" });
    expect(result.current.snapshot.active?.document.title).toBe("Local");
    expect(f.api.port.list).toHaveBeenCalledTimes(listCount);
    act(() => { controller.addGeneration(id, { x: 20, y: 0 }); });
    expect(result.current.snapshot.active?.scene.nodes.find((node) => node.kind === "generation")).toMatchObject({ parameters: { model: "updated-account-default" } });
    unmount();
    expect(f.jobs.subscribers.size).toBe(0);
    f.controller.dispose();
  });

  it("account change invalidates the old controller, previews, callbacks, and scoped reads", async () => {
    const f = canvasControllerFixture();
    const createObjectURL = vi.fn(() => "blob:first-account");
    const revokeObjectURL = vi.fn();
    const firstOptions = { ...f.options, objectUrls: { createObjectURL, revokeObjectURL } };
    const { result, rerender } = renderHook((options: CanvasControllerOptions) => useCanvasDocuments(options), { initialProps: firstOptions });
    await waitFor(() => expect(result.current.snapshot.ready).toBe(true));
    const previous = result.current.controller!;
    let id!: string;
    await act(async () => { id = await previous.newCanvas(); });
    act(() => {
      const reference = previous.importReference(id, new File(["png"], "file.png", { type: "image/png" }), { x: 0, y: 0 });
      previous.acquirePreview(id, reference);
    });
    const nextApi = createFakeCanvasApi();
    const nextJobs = createFakeCanvasJobs();
    rerender({ ...firstOptions, ownerId: "owner-two", api: nextApi.port, jobs: nextJobs.port });
    await waitFor(() => expect(result.current.snapshot).toMatchObject({ ownerId: "owner-two", ready: true, activeCanvasId: null }));
    expect(result.current.snapshot.documents).toHaveLength(0);
    expect(f.store.port.list).toHaveBeenCalledWith("owner-two");
    expect(f.jobs.subscribers.size).toBe(0);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:first-account");
    await expect(previous.newCanvas()).rejects.toMatchObject({ code: "inactive" });
    f.controller.dispose();
  });

  it("renderer switches leave the mounted controller and owner job subscription intact", async () => {
    const f = canvasControllerFixture();
    f.api.seed(canvasUuid(20));
    const rendered = render(<Viewer options={f.options} />);
    await screen.findByText("ready");
    await waitFor(() => expect(f.jobs.subscribers.size).toBe(1));
    rendered.rerender(<Viewer options={f.options} pane="chat" />);
    expect(screen.getByText("chat pane")).toBeInTheDocument();
    expect(f.jobs.subscribers.size).toBe(1);
    rendered.rerender(<Viewer options={f.options} pane="canvas" />);
    expect(screen.getByText("0 nodes")).toBeInTheDocument();
    expect(f.api.port.create).not.toHaveBeenCalled();
    expect(f.api.port.submit).not.toHaveBeenCalled();
    rendered.unmount();
    expect(f.jobs.subscribers.size).toBe(0);
    f.controller.dispose();
  });

  it("pagehide flushes best-effort and reports saved only after transaction completion", async () => {
    const f = canvasControllerFixture();
    const { result } = renderHook(() => useCanvasDocuments(f.options));
    await waitFor(() => expect(result.current.snapshot.ready).toBe(true));
    const controller = result.current.controller!;
    let id!: string;
    await act(async () => { id = await controller.newCanvas(); });
    act(() => { controller.addPrompt(id, { x: 0, y: 0 }, "pagehide text"); });
    const gate = deferred<void>();
    const commit = vi.mocked(f.store.port.commit).getMockImplementation()!;
    vi.mocked(f.store.port.commit).mockImplementationOnce(async (...args) => { await gate.promise; return commit(...args); });
    act(() => { window.dispatchEvent(new Event("pagehide")); });
    await waitFor(() => expect(f.store.port.commit).toHaveBeenCalled());
    expect(result.current.snapshot.active?.document.localState).toBe("pending");
    await act(async () => { gate.resolve(); await controller.flushLocal(); });
    expect(result.current.snapshot.active?.document.localState).toBe("saved");
    expect(f.store.row("owner-one", id)?.envelope.scene.nodes).toHaveLength(1);
    f.controller.dispose();
  });

  it("StrictMode cleanup leaves one live subscription and no stale first-bootstrap requests", async () => {
    const f = canvasControllerFixture();
    const first = deferred<Awaited<ReturnType<typeof f.store.port.list>>>();
    vi.mocked(f.store.port.list).mockImplementationOnce(() => first.promise);
    const { result, unmount } = renderHook(() => useCanvasDocuments(f.options), { wrapper: StrictMode });
    await waitFor(() => expect(result.current.snapshot.ready).toBe(true));
    expect(f.jobs.subscribers.size).toBe(1);
    const requests = vi.mocked(f.api.port.list).mock.calls.length;
    await act(async () => { first.resolve([]); await Promise.resolve(); });
    expect(f.api.port.list).toHaveBeenCalledTimes(requests);
    unmount();
    expect(f.jobs.subscribers.size).toBe(0);
    f.controller.dispose();
  });

  it("feature-off hook never reads authenticated browser drafts or metadata", async () => {
    const f = canvasControllerFixture();
    const { result } = renderHook(() => useCanvasDocuments({ ...f.options, enabled: false }));
    await waitFor(() => expect(result.current.snapshot.ready).toBe(true));
    expect(result.current.snapshot.enabled).toBe(false);
    expect(f.store.port.list).not.toHaveBeenCalled();
    expect(f.api.port.list).not.toHaveBeenCalled();
    f.controller.dispose();
  });
});
