import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CanvasController } from "@/components/create/canvas/controller";
import { useCanvasComposerPlacement } from "@/components/create/hooks/use-canvas-composer-placement";
import { CanvasImageToolbar } from "@/components/create/parts/canvas-image-toolbar";

import { canvasControllerFixture, completedJob } from "./helpers/canvas-controller-fixtures";
import { CanvasStageHarness, canvasNodeActions, canvasStageCallbacks, installCanvasDom } from "./helpers/canvas-renderer-fixtures";

const controllers: CanvasController[] = [];
let restore: ReturnType<typeof installCanvasDom>;
function fixture() {
  const f = canvasControllerFixture({ objectUrls: { createObjectURL: vi.fn(() => "blob:image-first-original"), revokeObjectURL: vi.fn() } });
  controllers.push(f.controller); return f;
}
function image(name = "original.png") { return new File(["image"], name, { type: "image/png" }); }
function nodeElement(id: string) { return document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)!; }
async function settle() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)); }); }

beforeEach(() => {
  restore = installCanvasDom();
  class TestPointerEvent extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    constructor(type: string, input: PointerEventInit = {}) { super(type, input); this.pointerId = input.pointerId ?? 1; this.pointerType = input.pointerType ?? "mouse"; }
  }
  vi.stubGlobal("PointerEvent", TestPointerEvent);
});
afterEach(() => { cleanup(); controllers.splice(0).forEach((controller) => controller.dispose()); restore(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("image-first creation loop on the real canvas", () => {
  it("follows a newly mounted Flow node after the initial missing-node fallback without a fake resize", async () => {
    const viewport = document.createElement("div");
    document.body.append(viewport);
    const ref = { current: viewport };
    const mounted = renderHook(() => useCanvasComposerPlacement(ref, "late-node", false, "stable-layout", "stable-camera"));
    await waitFor(() => expect(mounted.result.current?.left).toBe(604));
    const node = document.createElement("div");
    node.className = "react-flow__node";
    node.dataset.id = "late-node";
    await act(async () => { viewport.append(node); await Promise.resolve(); });
    await waitFor(() => expect(mounted.result.current?.left).toBe(300));
    mounted.unmount();
    viewport.remove();
  });

  it("keeps the image toolbar attached when its selected Flow card mounts late or disappears", async () => {
    const f = fixture();
    const { canvasId } = await f.newGraph();
    const reference = f.controller.importReference(canvasId, image(), { x: 400, y: 250 });
    const active = f.controller.getSnapshot().active!;
    const node = active.scene.nodes.find((item) => item.id === reference);
    if (node?.kind !== "reference") throw new Error("Expected the imported reference node");
    const viewport = document.createElement("div");
    document.body.append(viewport);
    const mounted = render(<CanvasImageToolbar active={active} node={node} viewport={{ current: viewport }} actions={canvasNodeActions()} readOnly={false} onCreate={vi.fn()} />);
    try {
      const toolbar = screen.getByRole("group", { name: "所选图片操作" });
      toolbar.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 310, bottom: 54, width: 310, height: 54, toJSON: () => ({}) });
      act(() => restore.deliverResizes());
      await waitFor(() => expect(toolbar).toHaveStyle({ left: "8px", top: "8px" }));
      const card = document.createElement("div");
      card.className = "react-flow__node";
      card.dataset.id = reference;
      card.getBoundingClientRect = () => ({ x: 400, y: 250, left: 400, top: 250, right: 688, bottom: 530, width: 288, height: 280, toJSON: () => ({}) });
      await act(async () => { viewport.append(card); await Promise.resolve(); });
      await waitFor(() => expect(toolbar).toHaveStyle({ left: "400px", top: "188px" }));
      await act(async () => { card.remove(); await Promise.resolve(); });
      await waitFor(() => expect(toolbar).toHaveStyle({ left: "8px", top: "8px" }));
    } finally {
      mounted.unmount();
      viewport.remove();
    }
  });

  it("keeps low-image controls above the measured camera/dock and follows their resize without scene edits", async () => {
    const f = fixture();
    const { canvasId } = await f.newGraph();
    const reference = f.controller.importReference(canvasId, image(), { x: 400, y: 560 });
    const active = f.controller.getSnapshot().active!;
    const node = active.scene.nodes.find((item) => item.id === reference);
    if (node?.kind !== "reference") throw new Error("Expected the imported reference node");
    const before = structuredClone(active.scene);
    const workspace = document.createElement("div"), viewport = document.createElement("div"), dock = document.createElement("nav"), camera = document.createElement("div"), card = document.createElement("div");
    const rect = (left: number, top: number, width: number, height: number): DOMRect => ({ x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON: () => ({}) });
    dock.dataset.canvasDock = ""; camera.dataset.canvasCamera = "";
    dock.getBoundingClientRect = () => rect(350, 544, 500, 56);
    let cameraTop = 470, toolbarHeight = 56;
    camera.getBoundingClientRect = () => rect(8, cameraTop, 200, 600 - cameraTop);
    card.className = "react-flow__node"; card.dataset.id = reference;
    card.getBoundingClientRect = () => rect(400, 560, 288, 280);
    viewport.append(card); workspace.append(viewport, dock, camera); document.body.append(workspace);
    const mounted = render(<CanvasImageToolbar active={active} node={node} viewport={{ current: viewport }} actions={canvasNodeActions()} readOnly={false} onCreate={vi.fn()} />);
    try {
      const toolbar = screen.getByRole("group", { name: "所选图片操作" });
      toolbar.getBoundingClientRect = () => rect(400, Number.parseFloat(toolbar.style.top) || 0, 310, toolbarHeight);
      act(() => restore.deliverResizes());
      await waitFor(() => expect(Number.parseFloat(toolbar.style.top) + toolbarHeight).toBeLessThanOrEqual(cameraTop - 8));
      cameraTop = 410;
      act(() => restore.deliverResizes());
      await waitFor(() => expect(Number.parseFloat(toolbar.style.top) + toolbarHeight).toBeLessThanOrEqual(cameraTop - 8));
      toolbarHeight = 88;
      act(() => restore.deliverResizes());
      await waitFor(() => expect(Number.parseFloat(toolbar.style.top) + toolbarHeight).toBeLessThanOrEqual(cameraTop - 8));
      expect(f.controller.getSnapshot().active!.scene).toEqual(before);
      expect(f.api.port.submit).not.toHaveBeenCalled();
    } finally { mounted.unmount(); workspace.remove(); }
  });

  it("anchors primary creation and captured imports to the visible canvas rather than an offscreen legacy prompt", async () => {
    const f = fixture();
    await f.controller.start();
    const canvasId = await f.controller.newCanvas();
    const promptId = f.controller.addPrompt(canvasId, { x: 90000, y: 80000 }, "offscreen legacy prompt");
    f.controller.setViewport(canvasId, { x: -100, y: -50, zoom: 0.5 });
    render(<CanvasStageHarness controller={f.controller} />);
    await settle();
    await userEvent.click(screen.getByRole("button", { name: "新建图片" }));
    const created = f.controller.getSnapshot().active!.scene.nodes.find((node) => node.kind === "generation")!;
    expect(created.position).toEqual({ x: 300, y: 210 });
    expect(f.controller.getSnapshot().active!.scene.nodes.find((node) => node.id === promptId)).toMatchObject({ position: { x: 90000, y: 80000 } });
    await userEvent.click(screen.getByRole("button", { name: "关闭节点设置" }));
    await userEvent.click(screen.getByRole("button", { name: "导入参考图" }));
    act(() => f.controller.setViewport(canvasId, { x: -4000, y: -3000, zoom: 1 }));
    fireEvent.change(screen.getByLabelText("导入画布参考图文件"), { target: { files: [image()] } });
    const reference = f.controller.getSnapshot().active!.scene.nodes.find((node) => node.kind === "reference")!;
    // The occupied creation card shifts the import down, but camera movement while
    // the chooser is open cannot reinterpret its captured world-space column.
    expect(reference.position).toEqual({ x: 300, y: 570 });
    expect(f.api.port.submit).not.toHaveBeenCalled();
    expect(f.api.port.upload).not.toHaveBeenCalled();
  });

  it("creates a connected draft directly and runs only after the explicit composer action", async () => {
    const f = fixture();
    await f.controller.start();
    const canvasId = await f.controller.newCanvas();
    render(<CanvasStageHarness controller={f.controller} />);
    expect(f.controller.getSnapshot().active!.scene.nodes).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "创作第一张图片" }));
    const composer = await screen.findByRole("complementary", { name: "节点编辑面板" });
    const textarea = within(composer).getByRole("textbox", { name: "创作提示词" });
    const created = f.controller.getSnapshot().active!.selectedNodeId!;
    const scene = f.controller.getSnapshot().active!.scene;
    expect(scene.nodes.map((node) => node.kind)).toEqual(["prompt", "generation"]);
    expect(scene.edges[0]).toMatchObject({ kind: "prompt-input", target: created });
    fireEvent.input(textarea, { target: { value: "温暖的山谷与傍晚的光" }, inputType: "insertText" });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(f.api.port.submit).not.toHaveBeenCalled();
    await userEvent.click(within(composer).getByRole("button", { name: "运行此节点" }));
    await waitFor(() => expect(f.api.port.submit).toHaveBeenCalledTimes(1));
    expect(vi.mocked(f.api.port.submit).mock.calls[0][0]).toMatchObject({ canvasId, nodeId: created, prompt: { text: "温暖的山谷与傍晚的光" } });
  });

  it("keeps creation and a captured batch visible in a dense legacy graph without changing old nodes or camera", async () => {
    const f = fixture();
    await f.controller.start();
    const canvasId = await f.controller.newCanvas();
    const references = Array.from({ length: 8 }, (_, index) => f.controller.importReference(canvasId, image(), { x: (index % 4) * 380, y: Math.floor(index / 4) * 360 }));
    for (let index = 0; index < 8; index += 1) {
      const promptId = f.controller.addPrompt(canvasId, index === 7 ? { x: 50000, y: 20000 } : { x: (index % 4) * 380, y: 900 + Math.floor(index / 4) * 360 }, `Legacy ${index}`);
      const generatorId = f.controller.addGeneration(canvasId, { x: (index % 4) * 380, y: 1800 + Math.floor(index / 4) * 360 });
      f.controller.connect(canvasId, promptId, generatorId);
      for (let ordinal = 1; ordinal <= 3; ordinal += 1) f.controller.connectImage(canvasId, references[(index + ordinal) % references.length], generatorId);
    }
    const camera = { x: -206, y: -63, zoom: 1.18 };
    f.controller.setViewport(canvasId, camera);
    const before = f.controller.getSnapshot().active!.scene;
    const oldIds = new Set(before.nodes.map((node) => node.id));
    expect(before.nodes).toHaveLength(24);
    expect(before.edges).toHaveLength(32);
    render(<CanvasStageHarness controller={f.controller} />);
    await settle();
    await userEvent.click(screen.getByRole("button", { name: "新建图片" }));
    const after = f.controller.getSnapshot().active!.scene;
    const generation = after.nodes.find((node) => node.kind === "generation" && !oldIds.has(node.id))!;
    const expectVisible = (position: { x: number; y: number }) => {
      expect(position.x * camera.zoom + camera.x).toBeGreaterThanOrEqual(15);
      expect(position.y * camera.zoom + camera.y).toBeGreaterThanOrEqual(15);
      expect((position.x + 320) * camera.zoom + camera.x).toBeLessThanOrEqual(985);
      expect((position.y + 360) * camera.zoom + camera.y).toBeLessThanOrEqual(585);
    };
    expectVisible(generation.position);
    expect(after.nodes.filter((node) => oldIds.has(node.id))).toEqual(before.nodes);
    expect(after.edges.slice(0, before.edges.length)).toEqual(before.edges);
    expect(after.viewport).toEqual(camera);
    await userEvent.click(screen.getByRole("button", { name: "关闭节点设置" }));
    await userEvent.click(screen.getByRole("button", { name: "导入参考图" }));
    act(() => f.controller.setViewport(canvasId, { x: -10000, y: -8000, zoom: 0.5 }));
    fireEvent.change(screen.getByLabelText("导入画布参考图文件"), { target: { files: [image("first.png"), image("second.png")] } });
    const imported = f.controller.getSnapshot().active!.scene;
    const added = imported.nodes.filter((node) => node.kind === "reference" && !oldIds.has(node.id));
    expect(added).toHaveLength(2);
    added.forEach((node) => expectVisible(node.position));
    expect(imported.nodes.filter((node) => oldIds.has(node.id))).toEqual(before.nodes);
    expect(f.api.port.submit).not.toHaveBeenCalled();
    expect(f.api.port.upload).not.toHaveBeenCalled();
    expect(f.api.port.save).not.toHaveBeenCalled();
  });

  it("repairs missing prompt input without replacing its focused textarea or restoring stale native text", async () => {
    const f = fixture();
    await f.controller.start();
    const canvasId = await f.controller.newCanvas();
    const nodeId = f.controller.addGeneration(canvasId, { x: 0, y: 0 });
    f.controller.selectNode(canvasId, nodeId);
    render(<CanvasStageHarness controller={f.controller} />);
    const textarea = await screen.findByRole("textbox", { name: "创作提示词" }) as HTMLTextAreaElement;
    act(() => textarea.focus());
    const setter = vi.spyOn(textarea, "value", "set");
    fireEvent.compositionStart(textarea);
    act(() => {
      for (const text of ["中", "中文", "中文构图"]) fireEvent.input(textarea, { target: { value: text }, inputType: "insertCompositionText", isComposing: true });
    });
    await settle();
    expect(screen.getByRole("textbox", { name: "创作提示词" })).toBe(textarea);
    expect(setter.mock.calls).toEqual([]);
    expect(textarea).toHaveValue("中文构图");
    expect(textarea).toHaveFocus();
    expect(f.controller.getSnapshot().active!.scene.nodes.filter((node) => node.kind === "prompt")).toHaveLength(1);
    expect(f.controller.getSnapshot().active!.scene.nodes.find((node) => node.kind === "prompt")).toMatchObject({ text: "中文构图" });
    fireEvent.compositionEnd(textarea);
    expect(f.api.port.submit).not.toHaveBeenCalled();
  });

  it("labels shared prompt edits and leaves all old node positions and source edges intact", async () => {
    const f = fixture();
    const { canvasId, promptId, nodeId } = await f.newGraph();
    const second = f.controller.addGeneration(canvasId, { x: 800, y: 0 });
    f.controller.connect(canvasId, promptId, second);
    f.controller.selectNode(canvasId, nodeId);
    const before = f.controller.getSnapshot().active!.scene;
    render(<CanvasStageHarness controller={f.controller} />);
    expect(await screen.findByText(/共享提示词 · 2 个生成节点使用此来源/)).toBeInTheDocument();
    fireEvent.input(screen.getByRole("textbox", { name: "创作提示词" }), { target: { value: "共同的新画面" } });
    const after = f.controller.getSnapshot().active!.scene;
    expect(after.edges).toEqual(before.edges);
    expect(after.nodes.map((node) => [node.id, node.position])).toEqual(before.nodes.map((node) => [node.id, node.position]));
    expect(after.nodes.find((node) => node.id === promptId)).toMatchObject({ text: "共同的新画面" });
  });

  it("rejects input captured before an external prompt-source replacement instead of overwriting the new source", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    const other = f.controller.addPrompt(canvasId, { x: 0, y: 800 }, "new external source");
    f.controller.selectNode(canvasId, nodeId);
    render(<CanvasStageHarness controller={f.controller} />);
    const textarea = await screen.findByRole("textbox", { name: "创作提示词" });
    act(() => textarea.focus());
    fireEvent.compositionStart(textarea);
    fireEvent.input(textarea, { target: { value: "原来源正在输入" }, inputType: "insertCompositionText", isComposing: true });
    const edge = f.controller.getSnapshot().active!.scene.edges.find((item) => item.kind === "prompt-input" && item.target === nodeId)!;
    act(() => f.controller.replaceConnection(canvasId, edge.id, other));
    const before = f.controller.getSnapshot().active!.scene;
    fireEvent.input(textarea, { target: { value: "迟到的原来源输入" }, inputType: "insertCompositionText", isComposing: true });
    expect(f.controller.getSnapshot().active!.scene).toEqual(before);
    expect(f.controller.getSnapshot().active!.scene.nodes.find((node) => node.id === other)).toMatchObject({ text: "new external source" });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.compositionEnd(textarea);
    fireEvent.blur(textarea);
    fireEvent.focus(textarea);
    fireEvent.input(textarea, { target: { value: "intentional new-source edit" }, inputType: "insertText" });
    expect(f.controller.getSnapshot().active!.scene.nodes.find((node) => node.id === other)).toMatchObject({ text: "intentional new-source edit" });
  });

  it("selects images instead of previewing and prepares a continuation without rerunning the source", async () => {
    const f = fixture();
    const callbacks = canvasStageCallbacks();
    const { canvasId, nodeId } = await f.newGraph();
    await f.controller.runNode(canvasId, nodeId);
    const binding = f.controller.getSnapshot().active!.scene.runBindings[0];
    f.jobs.push({ ownerId: "owner-one", canvasId, nodeId, runId: binding.runId }, completedJob(binding.jobId));
    const source = f.controller.getSnapshot().active!.scene.nodes.find((node) => node.kind === "result")!;
    render(<CanvasStageHarness {...callbacks} controller={f.controller} />);
    await settle();
    fireEvent.click(within(nodeElement(source.id)).getByAltText("画布生成结果"));
    expect(f.controller.getSnapshot().active!.selectedNodeId).toBe(source.id);
    expect(callbacks.onViewImage).not.toHaveBeenCalled();
    const toolbar = await screen.findByRole("group", { name: "所选图片操作" });
    await userEvent.click(within(toolbar).getByRole("button", { name: "查看所选原图" }));
    expect(callbacks.onViewImage).toHaveBeenCalledTimes(1);
    await userEvent.click(within(toolbar).getByRole("button", { name: "继续创作" }));
    expect(await screen.findByRole("textbox", { name: "创作提示词" })).toBeInTheDocument();
    const target = f.controller.getSnapshot().active!.selectedNodeId;
    expect(target).not.toBe(nodeId);
    expect(f.controller.getSnapshot().active!.scene.edges.find((edge) => edge.kind === "image-input" && edge.target === target)).toMatchObject({ source: source.id, ordinal: 1 });
    expect(f.controller.getSnapshot().active!.scene.nodes.find((node) => node.id === source.id)).toEqual(source);
    expect(f.api.port.submit).toHaveBeenCalledTimes(1);
  });

  it("previews a whole-image drag locally and commits only the final pointerup coordinate", async () => {
    const f = fixture();
    const { canvasId } = await f.newGraph();
    const reference = f.controller.importReference(canvasId, image(), { x: 0, y: 400 });
    f.controller.selectNode(canvasId, null);
    const move = vi.spyOn(f.controller, "moveNode");
    render(<CanvasStageHarness controller={f.controller} />);
    await settle();
    const surface = within(nodeElement(reference)).getByAltText("画布参考图");
    fireEvent.pointerDown(surface, { pointerId: 1, clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 160, clientY: 140 });
    expect(move).not.toHaveBeenCalled();
    expect(f.controller.getSnapshot().active!.scene.nodes.find((node) => node.id === reference)).toMatchObject({ position: { x: 0, y: 400 } });
    fireEvent.pointerUp(surface, { pointerId: 1, clientX: 200, clientY: 180 });
    expect(move).toHaveBeenCalledTimes(1);
    expect(f.controller.getSnapshot().active!.scene.nodes.find((node) => node.id === reference)).toMatchObject({ position: { x: 100, y: 480 } });
    expect(f.api.port.submit).not.toHaveBeenCalled();
  });

  it.each(["tap", "cancel", "outside", "second-pointer", "camera", "readOnly"])("does not commit a %s gesture and recovers for later interaction", async (kind) => {
    const f = fixture();
    const { canvasId } = await f.newGraph();
    const reference = f.controller.importReference(canvasId, image(), { x: 0, y: 400 });
    f.controller.selectNode(canvasId, null);
    const move = vi.spyOn(f.controller, "moveNode");
    render(<CanvasStageHarness controller={f.controller} />);
    await settle();
    const surface = within(nodeElement(reference)).getByAltText("画布参考图");
    fireEvent.pointerDown(surface, { pointerId: 1, clientX: 100, clientY: 100, button: 0 });
    if (kind !== "tap") fireEvent.pointerMove(surface, { pointerId: 1, clientX: 160, clientY: 140 });
    if (kind === "cancel") fireEvent.pointerCancel(surface, { pointerId: 1 });
    if (kind === "second-pointer") fireEvent.pointerDown(screen.getByTestId("canvas-viewport"), { pointerId: 2, clientX: 200, clientY: 200, pointerType: "touch" });
    if (kind === "camera") act(() => f.controller.setViewport(canvasId, { x: 20, y: 0, zoom: 1 }));
    if (kind === "readOnly") act(() => f.controller.setReadOnly(true));
    fireEvent.pointerUp(surface, { pointerId: 1, clientX: kind === "outside" ? 1100 : kind === "tap" ? 101 : 200, clientY: kind === "tap" ? 101 : 180 });
    expect(move).not.toHaveBeenCalled();
    if (kind === "second-pointer") fireEvent.pointerUp(window, { pointerId: 2 });
    if (kind === "readOnly") act(() => f.controller.setReadOnly(false));
    await settle();
    fireEvent.pointerDown(surface, { pointerId: 3, clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(surface, { pointerId: 3, clientX: 140, clientY: 140 });
    fireEvent.pointerUp(surface, { pointerId: 3, clientX: 160, clientY: 160 });
    expect(move).toHaveBeenCalledTimes(1);
  });

  it("imports a captured batch into the composer and never falls back after chooser cancellation", async () => {
    const f = fixture();
    await f.controller.start();
    await f.controller.newCanvas();
    render(<CanvasStageHarness controller={f.controller} />);
    await userEvent.click(screen.getByRole("button", { name: "新建图片" }));
    const panel = await screen.findByRole("complementary", { name: "节点编辑面板" });
    const target = f.controller.getSnapshot().active!.selectedNodeId!;
    const input = within(panel).getByLabelText("导入生成节点参考图文件");
    const before = f.controller.getSnapshot().active!.scene;
    fireEvent.change(input, { target: { files: [image()] } });
    expect(f.controller.getSnapshot().active!.scene).toEqual(before);
    await userEvent.click(within(panel).getByRole("button", { name: "导入并连接" }));
    fireEvent(input, new Event("cancel", { bubbles: true }));
    fireEvent.change(input, { target: { files: [image()] } });
    expect(f.controller.getSnapshot().active!.scene).toEqual(before);
    await userEvent.click(within(panel).getByRole("button", { name: "导入并连接" }));
    fireEvent.change(input, { target: { files: [image("one.png"), image("two.png")] } });
    expect(f.controller.getSnapshot().active!.scene.edges.filter((edge) => edge.kind === "image-input" && edge.target === target)).toHaveLength(2);
    expect(within(panel).getByRole("list", { name: "参考图缩略图与顺序" }).children).toHaveLength(2);
    expect(f.api.port.submit).not.toHaveBeenCalled();
    expect(f.api.port.upload).not.toHaveBeenCalled();
  });

  it("uses thumbnail selection/order/replacement controls and preserves the accepted inputs on a canonical duplicate", async () => {
    const f = fixture();
    const { canvasId } = await f.newGraph();
    const first = f.controller.importReference(canvasId, image("first.png"), { x: 0, y: 400 });
    const second = f.controller.importReference(canvasId, image("second.png"), { x: 0, y: 800 });
    const duplicate = f.controller.reuseReference(canvasId, first, { x: 0, y: 1200 });
    const created = f.controller.createQuickGeneration(canvasId, { position: { x: 800, y: 0 }, sourceNodeIds: [first] });
    render(<CanvasStageHarness controller={f.controller} />);
    const panel = await screen.findByRole("complementary", { name: "节点编辑面板" });
    await userEvent.click(within(panel).getByRole("button", { name: "从画布选择" }));
    await userEvent.click(within(panel).getByRole("button", { name: `选择参考 ${second.slice(-6)} · 本地原图可用` }));
    await userEvent.click(within(panel).getByRole("button", { name: "上移缩略参考图 2" }));
    const inputs = () => f.controller.getSnapshot().active!.scene.edges.filter((edge) => edge.kind === "image-input" && edge.target === created.generationNodeId).sort((a, b) => (a.kind === "image-input" ? a.ordinal : 0) - (b.kind === "image-input" ? b.ordinal : 0));
    expect(inputs().map((edge) => edge.source)).toEqual([second, first]);
    const before = f.controller.getSnapshot().active!.scene;
    await userEvent.click(within(panel).getByRole("button", { name: "替换缩略参考图 1" }));
    await userEvent.click(within(panel).getByRole("button", { name: `选择参考 ${duplicate.slice(-6)} · 本地原图可用` }));
    expect(f.controller.getSnapshot().active!.scene).toEqual(before);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole("button", { name: "取消选择" }));
    await userEvent.click(within(panel).getByRole("button", { name: "移除缩略参考图 1" }));
    expect(inputs()).toHaveLength(1);
    expect(inputs()[0]).toMatchObject({ source: first, ordinal: 1 });
    expect(f.api.port.submit).not.toHaveBeenCalled();
    expect(f.api.port.upload).not.toHaveBeenCalled();
  });
});
