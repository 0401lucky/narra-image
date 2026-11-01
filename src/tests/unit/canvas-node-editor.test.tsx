import { act, cleanup, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import path from "node:path";
import { useMemo, useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CanvasController } from "@/components/create/canvas/controller";
import { useCanvasEditor } from "@/components/create/hooks/use-canvas-editor";
import { CanvasStage } from "@/components/create/parts/canvas-stage";
import { CanvasDialog } from "@/components/create/parts/canvas-dialog";
import { CanvasPromptField } from "@/components/create/parts/canvas-prompt-field";
import { CanvasRuntimeDialog } from "@/components/create/parts/canvas-runtime-dialog";
import styles from "@/components/create/parts/canvas-stage.module.css";

import { canvasControllerFixture, completedJob, deferred } from "./helpers/canvas-controller-fixtures";
import { canvasStageCallbacks, canvasStageChannels, installCanvasDom } from "./helpers/canvas-renderer-fixtures";

const controllers: CanvasController[] = [];
let restore: ReturnType<typeof installCanvasDom>;
function fixture() {
  const f = canvasControllerFixture({ objectUrls: { createObjectURL: vi.fn(() => "blob:phone-original"), revokeObjectURL: vi.fn() } });
  controllers.push(f.controller); return f;
}
function original(name = "original.png") { return new File(["png"], name, { type: "image/png" }); }
function nodeElement(id: string) { return document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)!; }
function panel() { return screen.getByRole("complementary", { name: "节点编辑面板" }); }
async function settle() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)); }); }
async function edit(nodeId: string) {
  fireEvent.change(screen.getByRole("combobox", { name: "选择画布节点" }), { target: { value: nodeId } });
  fireEvent.click(screen.getByRole("button", { name: "编辑所选节点" }));
  await screen.findByRole("complementary", { name: "节点编辑面板" });
}

function PersistentEditor({ controller, visible = true, touch = true }: { controller: CanvasController; visible?: boolean; touch?: boolean }) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const editor = useCanvasEditor(snapshot, controller);
  const callbacks = useMemo(() => canvasStageCallbacks(), []);
  return visible ? <CanvasStage {...callbacks} snapshot={snapshot} controller={controller} editor={editor} channels={canvasStageChannels} touchPresentation={touch} /> : <p>另一个模式</p>;
}

beforeEach(() => {
  restore = installCanvasDom();
  class TestPointerEvent extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    constructor(type: string, input: PointerEventInit = {}) { super(type, input); this.pointerId = input.pointerId ?? 1; this.pointerType = input.pointerType ?? "touch"; }
  }
  vi.stubGlobal("PointerEvent", TestPointerEvent);
});
afterEach(() => { cleanup(); controllers.splice(0).forEach((controller) => controller.dispose()); restore(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("actual phone node editor and controller", () => {
  it.each([false, true])("allows uncancelled editor touch defaults with scoped pinch permission (readOnly=%s)", async (readOnly) => {
    const f = fixture();
    const { promptId } = await f.newGraph();
    if (readOnly) f.controller.setReadOnly(true);
    render(<PersistentEditor controller={f.controller} />);
    if (readOnly) {
      fireEvent.change(screen.getByLabelText("选择画布节点"), { target: { value: promptId } });
      fireEvent.click(screen.getByRole("button", { name: "查看所选节点" }));
    } else await edit(promptId);
    const editor = screen.getByRole("complementary", { name: readOnly ? "节点查看面板" : "节点编辑面板" });
    const scroller = editor.querySelector<HTMLElement>(`.${styles.inspectorScroll}`)!;
    const prompt = readOnly ? within(editor).getByText("frozen prompt") : within(editor).getByRole("textbox", { name: "节点提示词" });
    const viewport = screen.getByTestId("canvas-viewport");
    expect(scroller).toBeInTheDocument();
    expect(viewport.contains(editor)).toBe(false);
    expect(editor.parentElement).toBe(viewport.parentElement);
    await settle();
    const before = f.controller.getSnapshot().active!;
    for (const target of [editor, scroller, prompt]) {
      const touches = [
        { identifier: 1, target, clientX: 100, clientY: 100 },
        { identifier: 2, target, clientX: 160, clientY: 160 },
      ];
      const start = createEvent.touchStart(target, { bubbles: true, cancelable: true, touches });
      const move = createEvent.touchMove(target, { bubbles: true, cancelable: true, touches });
      const end = createEvent.touchEnd(target, { bubbles: true, cancelable: true, touches: [] });
      for (const event of [start, move, end]) {
        fireEvent(target, event);
        expect(event.defaultPrevented).toBe(false);
      }
      const pointer = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1, pointerType: "touch" });
      fireEvent(target, pointer);
      expect(pointer.defaultPrevented).toBe(false);
      fireEvent.pointerUp(target, { pointerId: 1, pointerType: "touch" });
    }
    await settle();
    expect(f.controller.getSnapshot().active!.viewport).toEqual(before.viewport);
    expect(f.controller.getSnapshot().active!.scene).toEqual(before.scene);
    expect(f.api.port.submit).not.toHaveBeenCalled();
    expect(f.api.port.save).not.toHaveBeenCalled();

    // jsdom cannot arbitrate native pinch; inspect authored CSS separately from event defaults.
    const css = readFileSync(path.join(process.cwd(), "src/components/create/parts/canvas-stage.module.css"), "utf8");
    const touchRules = [...css.matchAll(/([^{}]+)\{[^{}]*?touch-action:\s*([^;]+);[^{}]*\}/g)];
    const touchAction = (selector: string) => touchRules.filter(([, selectors]) => selectors.split(",").some((value) => value.trim() === selector)).at(-1)?.[2].trim();
    for (const selector of [".nodeEditor", ".nodeEditor .inspectorScroll", ".nodeEditor .promptInput", ".nodeEditor .promptText"]) {
      expect(touchAction(selector), selector).toBe("pan-y pinch-zoom");
    }
    expect(touchAction(".viewport")).toBe("none");
    expect(touchAction(".previewText")).toBe("none");
    expect(touchAction(".promptInput")).toBe("pan-y");
    expect(touchAction(".promptText")).toBe("pan-y");
  });

  it("selects without opening an editor, then uses one unscaled prompt writer with synchronous composition and local scrolling", async () => {
    const f = fixture();
    const { canvasId, promptId } = await f.newGraph();
    render(<PersistentEditor controller={f.controller} />);
    await settle();
    fireEvent.click(nodeElement(promptId));
    expect(screen.queryByRole("complementary", { name: "节点编辑面板" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "节点提示词" })).not.toBeInTheDocument();
    await edit(promptId);
    const field = screen.getByRole("textbox", { name: "节点提示词" }) as HTMLTextAreaElement;
    const camera = f.controller.getSnapshot().active!.viewport;
    act(() => field.focus());
    fireEvent.compositionStart(field);
    const setter = vi.spyOn(field, "value", "set");
    act(() => {
      fireEvent.input(field, { target: { value: "中文" }, inputType: "insertCompositionText", isComposing: true });
      fireEvent.input(field, { target: { value: "中文候选词" }, inputType: "insertCompositionText", isComposing: true });
    });
    fireEvent.keyDown(field, { key: "Enter", keyCode: 229, isComposing: true });
    fireEvent.keyDown(field, { key: "s", ctrlKey: true, keyCode: 229, isComposing: true });
    fireEvent.wheel(field, { deltaY: 100 });
    fireEvent.wheel(panel(), { deltaY: 100 });
    await settle();
    expect(setter.mock.calls).toEqual([]);
    expect(field).toHaveValue("中文候选词");
    expect(field).toHaveFocus();
    field.setSelectionRange(1, 3);
    expect([field.selectionStart, field.selectionEnd]).toEqual([1, 3]);
    expect(f.controller.getSnapshot().active!.scene.nodes.find((node) => node.id === promptId)).toMatchObject({ text: "中文候选词" });
    expect(f.controller.getSnapshot().active!.viewport).toEqual(camera);
    fireEvent.compositionEnd(field, { data: "中文候选词" });
    await act(() => f.controller.flushLocal(canvasId));
    expect(f.store.row("owner-one", canvasId)!.envelope.scene.nodes[0]).toMatchObject({ text: "中文候选词" });
    expect(f.api.port.submit).not.toHaveBeenCalled();
    expect(f.api.port.save).not.toHaveBeenCalled();
  });

  it("keeps the same focused field DOM/caret through touch, desktop and short viewport presentation updates", async () => {
    const f = fixture();
    const { promptId } = await f.newGraph();
    const view = render(<PersistentEditor controller={f.controller} />);
    await edit(promptId);
    const field = screen.getByRole("textbox", { name: "节点提示词" }) as HTMLTextAreaElement;
    act(() => field.focus());
    fireEvent.input(field, { target: { value: "旋转之前的输入" } });
    field.setSelectionRange(2, 5);
    fireEvent.compositionStart(field);
    view.rerender(<PersistentEditor controller={f.controller} touch={false} />);
    act(() => { fireEvent(window, new Event("resize")); fireEvent(window, new Event("orientationchange")); });
    view.rerender(<PersistentEditor controller={f.controller} touch />);
    await settle();
    expect(screen.getByRole("textbox", { name: "节点提示词" })).toBe(field);
    expect(field).toHaveFocus();
    expect([field.selectionStart, field.selectionEnd]).toEqual([2, 5]);
    expect(f.controller.getSnapshot().readOnly).toBe(false);
    expect(f.api.port.submit).not.toHaveBeenCalled();
    expect(f.api.port.save).not.toHaveBeenCalled();
  });

  it("preserves unfinished size/seed across panel, node, canvas and mode changes; account Save and Run focus the invalid target", async () => {
    const f = fixture();
    const { canvasId, nodeId, promptId } = await f.newGraph();
    const view = render(<PersistentEditor controller={f.controller} />);
    await edit(nodeId);
    fireEvent.change(screen.getByLabelText("节点输出尺寸"), { target: { value: "custom" } });
    const size = screen.getByRole("textbox", { name: "节点自定义尺寸" });
    act(() => size.focus());
    fireEvent.input(size, { target: { value: "1536x" } });
    fireEvent.input(screen.getByLabelText("节点随机种子（可选）"), { target: { value: "-" } });
    await userEvent.click(screen.getByRole("button", { name: "关闭节点设置" }));
    await edit(promptId);
    view.rerender(<PersistentEditor controller={f.controller} visible={false} />);
    view.rerender(<PersistentEditor controller={f.controller} visible />);
    let other = "";
    await act(async () => { other = await f.controller.newCanvas("other"); });
    fireEvent.click(screen.getByRole("button", { name: "保存到账户" }));
    await waitFor(() => expect(f.api.port.save).toHaveBeenCalledTimes(1));
    expect(f.api.documents.get(other)?.scene?.nodes).toEqual([]);
    await act(() => f.controller.selectCanvas(canvasId));
    fireEvent.click(screen.getByRole("button", { name: "保存到账户" }));
    const restored = await screen.findByLabelText("节点自定义尺寸");
    expect(restored).toHaveValue("1536x");
    expect(restored).toHaveAttribute("aria-invalid", "true");
    expect(restored).toHaveFocus();
    expect(screen.getByLabelText("节点随机种子（可选）")).toHaveValue("-");
    expect(f.api.port.save).toHaveBeenCalledTimes(1);
    fireEvent.click(within(panel()).getByRole("button", { name: "运行此节点" }));
    expect(f.api.port.submit).not.toHaveBeenCalled();
    fireEvent.input(restored, { target: { value: "1536x1024" } });
    fireEvent.input(screen.getByLabelText("节点随机种子（可选）"), { target: { value: "24" } });
    fireEvent.click(screen.getByRole("button", { name: "保存到账户" }));
    await waitFor(() => expect(f.api.port.save).toHaveBeenCalledTimes(2));
    expect(f.api.documents.get(canvasId)?.scene?.nodes.find((node) => node.id === nodeId)).toMatchObject({ parameters: { size: "1536x1024", seed: 24 } });
    expect(f.api.port.submit).not.toHaveBeenCalled();
  });

  it("retains newer pending input while an earlier captured Save is in flight", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    render(<PersistentEditor controller={f.controller} />);
    await edit(nodeId);
    const saved = deferred<void>();
    const realSave = vi.mocked(f.api.port.save).getMockImplementation()!;
    vi.mocked(f.api.port.save).mockImplementation(async (...args) => { await saved.promise; return realSave(...args); });
    fireEvent.input(screen.getByLabelText("节点随机种子（可选）"), { target: { value: "11" } });
    fireEvent.click(screen.getByRole("button", { name: "保存到账户" }));
    await waitFor(() => expect(f.api.port.save).toHaveBeenCalledTimes(1));
    fireEvent.input(screen.getByLabelText("节点随机种子（可选）"), { target: { value: "-" } });
    await act(async () => saved.resolve());
    expect(f.api.documents.get(canvasId)?.scene?.nodes.find((node) => node.id === nodeId)).toMatchObject({ parameters: { seed: 11 } });
    expect(screen.getByLabelText("节点随机种子（可选）")).toHaveValue("-");
    expect(screen.getByText(/项参数待应用，未包含在账户快照/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存到账户" }));
    expect(f.api.port.save).toHaveBeenCalledTimes(1);
  });

  it("blocks Run and Save for an empty custom-size choice rather than silently capturing auto", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    const view = render(<PersistentEditor controller={f.controller} />);
    await edit(nodeId);
    fireEvent.change(screen.getByLabelText("节点输出尺寸"), { target: { value: "custom" } });
    expect(screen.getByLabelText("节点自定义尺寸")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "运行此节点" }));
    fireEvent.click(screen.getByRole("button", { name: "保存到账户" }));
    expect(screen.getByLabelText("节点自定义尺寸")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("节点自定义尺寸")).toHaveFocus();
    expect(f.api.port.submit).not.toHaveBeenCalled();
    expect(f.api.port.save).not.toHaveBeenCalled();
    view.rerender(<PersistentEditor controller={f.controller} visible={false} />);
    view.rerender(<PersistentEditor controller={f.controller} />);
    expect(await screen.findByLabelText("节点自定义尺寸")).toHaveValue("");
    expect(screen.getByLabelText("节点输出尺寸")).toHaveValue("custom");
    fireEvent.change(screen.getByLabelText("节点输出尺寸"), { target: { value: "auto" } });
    fireEvent.click(screen.getByRole("button", { name: "保存到账户" }));
    await waitFor(() => expect(f.api.port.save).toHaveBeenCalledTimes(1));
    expect(f.api.documents.get(canvasId)?.scene?.nodes.find((node) => node.id === nodeId)).toMatchObject({ parameters: { size: "auto" } });
  });

  it.each(["auto", "参考图"])("shows the canonical size instead of an unmarked blank after explicitly applying %s", async (raw) => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    render(<PersistentEditor controller={f.controller} />);
    await edit(nodeId);
    fireEvent.change(screen.getByLabelText("节点输出尺寸"), { target: { value: "custom" } });
    const size = screen.getByLabelText("节点自定义尺寸");
    fireEvent.input(size, { target: { value: raw } });
    fireEvent.blur(size);
    expect(size).toHaveValue("auto");
    expect(f.api.port.submit).not.toHaveBeenCalled();
    expect(f.api.port.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "保存到账户" }));
    await waitFor(() => expect(f.api.port.save).toHaveBeenCalledOnce());
    expect(f.api.documents.get(canvasId)?.scene?.nodes.find((node) => node.id === nodeId)).toMatchObject({ parameters: { size: "auto" } });
  });

  it("defers external parameter text while a focused native composition is active and receives it after composition ends", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    render(<PersistentEditor controller={f.controller} />);
    await edit(nodeId);
    fireEvent.click(screen.getByRole("button", { name: "自填 API" }));
    const field = screen.getByLabelText("节点第三方模型") as HTMLInputElement;
    act(() => field.focus());
    field.setSelectionRange(2, 5);
    const originalValue = field.value;
    fireEvent.compositionStart(field);
    const setter = vi.spyOn(field, "value", "set");
    act(() => f.controller.updateParameters(canvasId, nodeId, { model: "external-model" }));
    expect(setter.mock.calls).toEqual([]);
    expect(field).toHaveValue(originalValue);
    expect([field.selectionStart, field.selectionEnd]).toEqual([2, 5]);
    fireEvent.compositionEnd(field);
    expect(field).toHaveValue("external-model");
    expect(field).toHaveFocus();
    expect(f.api.port.submit).not.toHaveBeenCalled();
    expect(f.api.port.save).not.toHaveBeenCalled();
  });

  it("keeps native parameter composition synchronous and does not turn its Enter key into Save or Run", async () => {
    const f = fixture();
    const { nodeId } = await f.newGraph();
    render(<PersistentEditor controller={f.controller} />);
    await edit(nodeId);
    const field = screen.getByLabelText("节点负向提示词") as HTMLTextAreaElement;
    act(() => field.focus());
    fireEvent.compositionStart(field);
    const setter = vi.spyOn(field, "value", "set");
    act(() => {
      fireEvent.input(field, { target: { value: "模糊" }, inputType: "insertCompositionText", isComposing: true });
      fireEvent.input(field, { target: { value: "模糊与噪声" }, inputType: "insertCompositionText", isComposing: true });
    });
    fireEvent.keyDown(field, { key: "Enter", isComposing: true, keyCode: 229 });
    fireEvent.keyDown(field, { key: "s", ctrlKey: true, isComposing: true, keyCode: 229 });
    expect(setter.mock.calls).toEqual([]);
    expect(field).toHaveValue("模糊与噪声");
    expect(field).toHaveFocus();
    expect(f.api.port.submit).not.toHaveBeenCalled();
    expect(f.api.port.save).not.toHaveBeenCalled();
    fireEvent.compositionEnd(field);
    fireEvent.blur(field);
    expect(f.controller.getSnapshot().active!.scene.nodes.find((node) => node.id === nodeId)).toMatchObject({ parameters: { negativePrompt: "模糊与噪声" } });
  });

  it("uses an offscreen current-scene source, preserves failed replacement, and freezes explicit order without any automatic request", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    const first = f.controller.importReference(canvasId, original("one.png"), { x: -5000, y: 4000 });
    const second = f.controller.importReference(canvasId, original("two.png"), { x: -5000, y: 5000 });
    const duplicate = f.controller.reuseReference(canvasId, second, { x: -5000, y: 6000 });
    const firstEdge = f.controller.connect(canvasId, first, nodeId);
    f.controller.connect(canvasId, second, nodeId);
    render(<PersistentEditor controller={f.controller} />);
    await edit(nodeId);
    const before = f.controller.getSnapshot().active!.scene;
    fireEvent.change(screen.getByLabelText("替换参考图 1 来源"), { target: { value: duplicate } });
    expect(await screen.findByAltText("所选输入预览")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认替换参考图 1 来源" }));
    expect(f.controller.getSnapshot().active!.scene).toEqual(before);
    expect(f.controller.getSnapshot().active!.scene.edges.find((edge) => edge.id === firstEdge)).toMatchObject({ source: first, ordinal: 1 });
    fireEvent.click(screen.getByRole("button", { name: "上移参考图 2" }));
    expect(f.api.port.submit).not.toHaveBeenCalled();
    expect(f.api.port.upload).not.toHaveBeenCalled();
    const submit = screen.getByRole("button", { name: "运行此节点" });
    fireEvent.click(submit); fireEvent.click(submit);
    await waitFor(() => expect(f.api.port.submit).toHaveBeenCalledTimes(1));
    await settle();
    expect(vi.mocked(f.api.port.submit).mock.calls[0][0].references.map((input) => input.sourceNodeId)).toEqual([second, first]);
    const binding = f.controller.getSnapshot().active!.scene.runBindings[0];
    act(() => f.jobs.push({ ownerId: "owner-one", canvasId, nodeId, runId: binding.runId }, completedJob(binding.jobId)));
    await settle();
    expect(f.controller.getSnapshot().active!.scene.nodes.filter((node) => node.kind === "result")).toHaveLength(1);
    expect(f.controller.getSnapshot().active!.selectedNodeId).toBe(nodeId);
  });

  it("uses only a renderer preview during Move and commits once on a valid captured drop", async () => {
    const f = fixture();
    const { canvasId, promptId } = await f.newGraph();
    render(<PersistentEditor controller={f.controller} />);
    await settle();
    fireEvent.change(screen.getByLabelText("选择画布节点"), { target: { value: promptId } });
    fireEvent.click(screen.getByRole("button", { name: "移动所选节点" }));
    await settle();
    const node = nodeElement(promptId);
    const viewport = screen.getByTestId("canvas-viewport");
    const before = f.controller.getSnapshot().active!;
    const move = vi.spyOn(f.controller, "moveNode");
    fireEvent.pointerDown(node, { pointerId: 10, clientX: 100, clientY: 100, bubbles: true });
    fireEvent.pointerMove(viewport, { pointerId: 10, clientX: 140, clientY: 160, bubbles: true });
    await settle();
    expect(f.controller.getSnapshot().active!.scene).toEqual(before.scene);
    expect(move).not.toHaveBeenCalled();
    expect(node).not.toHaveStyle({ visibility: "hidden" });
    fireEvent.pointerUp(viewport, { pointerId: 10, clientX: 140, clientY: 160, bubbles: true });
    expect(move).toHaveBeenCalledTimes(1);
    expect(move).toHaveBeenCalledWith(canvasId, promptId, { x: before.scene.nodes[0].position.x + 40 / before.viewport.zoom, y: before.scene.nodes[0].position.y + 60 / before.viewport.zoom });
    fireEvent.click(screen.getByRole("button", { name: "完成移动" }));
    expect(f.api.port.submit).not.toHaveBeenCalled();
    expect(f.api.port.save).not.toHaveBeenCalled();
  });

  it.each(["pointerup", "pointercancel"])("allows a new Move after a browse pointer ends outside the viewport with %s", async (end) => {
    const f = fixture();
    const { canvasId, promptId } = await f.newGraph();
    render(<PersistentEditor controller={f.controller} />);
    await settle();
    const viewport = screen.getByTestId("canvas-viewport");
    fireEvent.pointerDown(viewport, { pointerId: 40, pointerType: "mouse", clientX: 10, clientY: 10 });
    fireEvent(document.body, new PointerEvent(end, { pointerId: 40, pointerType: "mouse", bubbles: true }));
    fireEvent.change(screen.getByLabelText("选择画布节点"), { target: { value: promptId } });
    fireEvent.click(screen.getByRole("button", { name: "移动所选节点" }));
    await settle();
    const before = f.controller.getSnapshot().active!;
    const move = vi.spyOn(f.controller, "moveNode");
    fireEvent.pointerDown(nodeElement(promptId), { pointerId: 41, pointerType: "mouse", clientX: 100, clientY: 100 });
    fireEvent.pointerMove(viewport, { pointerId: 41, pointerType: "mouse", clientX: 160, clientY: 180 });
    expect(move).not.toHaveBeenCalled();
    fireEvent.pointerUp(viewport, { pointerId: 41, pointerType: "mouse", clientX: 160, clientY: 180 });
    expect(move).toHaveBeenCalledExactlyOnceWith(canvasId, promptId, {
      x: before.scene.nodes[0].position.x + 60 / before.viewport.zoom,
      y: before.scene.nodes[0].position.y + 80 / before.viewport.zoom,
    });
    expect(f.api.port.submit).not.toHaveBeenCalled();
    expect(f.api.port.save).not.toHaveBeenCalled();
  });

  it.each(["pointercancel", "second-finger", "outside-finger", "layout", "removed-node", "mode"])("discards an interrupted Move on %s without accepting geometry", async (interruption) => {
    const f = fixture();
    const { canvasId, promptId } = await f.newGraph();
    const view = render(<PersistentEditor controller={f.controller} />);
    await settle();
    fireEvent.change(screen.getByLabelText("选择画布节点"), { target: { value: promptId } });
    fireEvent.click(screen.getByRole("button", { name: "移动所选节点" }));
    await settle();
    const viewport = screen.getByTestId("canvas-viewport");
    const move = vi.spyOn(f.controller, "moveNode");
    fireEvent.pointerDown(nodeElement(promptId), { pointerId: 20, clientX: 100, clientY: 100, bubbles: true });
    fireEvent.pointerMove(viewport, { pointerId: 20, clientX: 180, clientY: 160, bubbles: true });
    if (interruption === "pointercancel") fireEvent.pointerCancel(viewport, { pointerId: 20 });
    if (interruption === "second-finger") fireEvent.pointerDown(viewport, { pointerId: 21, clientX: 200, clientY: 100, bubbles: true });
    if (interruption === "outside-finger") fireEvent.pointerDown(screen.getByRole("button", { name: "保存到账户" }), { pointerId: 21, clientX: 200, clientY: 100, bubbles: true });
    if (interruption === "layout") view.rerender(<PersistentEditor controller={f.controller} touch={false} />);
    if (interruption === "removed-node") act(() => f.controller.removeNode(canvasId, promptId));
    if (interruption === "mode") view.rerender(<PersistentEditor controller={f.controller} visible={false} />);
    await settle();
    fireEvent.pointerUp(viewport, { pointerId: 20, clientX: 180, clientY: 160, bubbles: true });
    expect(move).not.toHaveBeenCalled();
    expect(f.api.port.submit).not.toHaveBeenCalled();
    expect(f.api.port.save).not.toHaveBeenCalled();
  });

  it("captures node removal confirmation rather than removing a newly selected node", async () => {
    const f = fixture();
    const { canvasId, promptId, nodeId } = await f.newGraph();
    render(<PersistentEditor controller={f.controller} />);
    await edit(promptId);
    fireEvent.click(within(panel()).getByRole("button", { name: "移除此节点" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("不会因此取消或退款");
    act(() => f.controller.selectNode(canvasId, nodeId));
    fireEvent.click(screen.getByRole("button", { name: "确认移除节点" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(f.controller.getSnapshot().active!.scene.nodes.map((node) => node.id)).toEqual([nodeId]);
    expect(f.api.port.submit).not.toHaveBeenCalled();
    expect(f.api.port.delete).not.toHaveBeenCalled();
  });

  it("treats file chooser cancel as a no-op and captures replacement at the original node", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    const refId = f.controller.importReference(canvasId, original(), { x: 0, y: 400 });
    render(<PersistentEditor controller={f.controller} />);
    await edit(refId);
    const oldSource = f.controller.getSnapshot().active!.scene.nodes.find((node) => node.id === refId);
    fireEvent.click(screen.getByRole("button", { name: "替换原图" }));
    const input = screen.getByLabelText("替换参考原图文件");
    fireEvent(input, new Event("cancel"));
    expect(f.controller.getSnapshot().active!.scene.nodes.find((node) => node.id === refId)).toEqual(oldSource);
    fireEvent.click(screen.getByRole("button", { name: "替换原图" }));
    act(() => f.controller.selectNode(canvasId, nodeId));
    fireEvent.change(input, { target: { files: [original("replacement.png")] } });
    expect(f.controller.getSnapshot().active!.scene.nodes.find((node) => node.id === refId)).not.toEqual(oldSource);
    expect(f.controller.getSnapshot().active!.scene.nodes.find((node) => node.id === nodeId)?.kind).toBe("generation");
    expect(f.api.port.upload).not.toHaveBeenCalled();
    expect(f.api.port.submit).not.toHaveBeenCalled();
  });

  it("retains unscaled image viewing under genuine read-only capability without exposing mutations", async () => {
    const f = fixture();
    const { canvasId } = await f.newGraph();
    const refId = f.controller.importReference(canvasId, original(), { x: 0, y: 400 });
    f.controller.setReadOnly(true);
    render(<PersistentEditor controller={f.controller} />);
    fireEvent.change(screen.getByLabelText("选择画布节点"), { target: { value: refId } });
    fireEvent.click(screen.getByRole("button", { name: "查看所选节点" }));
    const viewer = await screen.findByRole("complementary", { name: "节点查看面板" });
    expect(within(viewer).getByRole("button", { name: "查看参考原图" })).toBeEnabled();
    expect(within(viewer).getByRole("button", { name: "下载参考原图" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "替换原图" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "移动节点" })).not.toBeInTheDocument();
    expect(f.api.port.submit).not.toHaveBeenCalled();
    expect(f.api.port.save).not.toHaveBeenCalled();
  });
});

describe("captured modal keyboard safety", () => {
  it("offers a full-height saved-provider label target while keeping selection separate from runtime confirmation", async () => {
    const props = {
      dialog: { id: 1, target: { canvasId: "canvas-one", nodeId: "node-one" }, runId: null, reason: "settings" as const,
        model: "model-one", provider: { useSaved: true, baseUrl: "https://saved.invalid/v1", apiKey: "", label: "Saved" },
        savedProviderAvailable: true, siteKey: null, verified: false, busy: false, error: null },
      widgetRef: { current: null }, changeProvider: vi.fn(), verify: vi.fn(), confirm: vi.fn(), cancel: vi.fn(),
    };
    const view = render(<CanvasRuntimeDialog {...props} />);
    const checkbox = screen.getByRole("checkbox", { name: "使用账户已保存的渠道" });
    expect(checkbox.closest("label")).toHaveClass("min-h-11");
    await userEvent.click(screen.getByText("使用账户已保存的渠道"));
    expect(props.changeProvider).toHaveBeenCalledExactlyOnceWith(1, { ...props.dialog.provider, useSaved: false });
    expect(props.confirm).not.toHaveBeenCalled();
    view.rerender(<CanvasRuntimeDialog {...props} dialog={{ ...props.dialog, busy: true }} />);
    expect(checkbox).toBeDisabled();
    await userEvent.click(screen.getByText("使用账户已保存的渠道"));
    expect(props.changeProvider).toHaveBeenCalledTimes(1);
    expect(props.confirm).not.toHaveBeenCalled();
  });

  it("does not submit or dismiss for composition/implicit form Enter, but permits explicit button keyboard activation", async () => {
    const confirm = vi.fn(async () => true);
    const close = vi.fn();
    render(<CanvasDialog intent={{ kind: "rename", canvasId: "canvas-one", title: "Name" }} error={null} onClose={close} onConfirm={confirm} />);
    const input = screen.getByLabelText("画布名称");
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229, isComposing: true });
    fireEvent.submit(input.closest("form")!);
    fireEvent.keyDown(input, { key: "Escape", keyCode: 229, isComposing: true });
    expect(confirm).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    fireEvent.submit(input.closest("form")!);
    expect(confirm).not.toHaveBeenCalled();
    act(() => screen.getByRole("button", { name: "确认重命名" }).focus());
    await userEvent.keyboard("{Enter}");
    expect(confirm).toHaveBeenCalledOnce();
  });
});

describe("shared native prompt acknowledgement", () => {
  it("does not replace a newer focused draft when Flow forwards an earlier accepted value, but accepts deliberate external changes", () => {
    const accept = vi.fn(() => true);
    const view = render(<CanvasPromptField value="" onChange={accept} />);
    const input = screen.getByRole("textbox", { name: "节点提示词" }) as HTMLTextAreaElement;
    act(() => input.focus());
    const setter = vi.spyOn(input, "value", "set");
    fireEvent.input(input, { target: { value: "first" } });
    fireEvent.input(input, { target: { value: "second" } });
    view.rerender(<CanvasPromptField value="first" onChange={accept} />);
    expect(input).toHaveValue("second");
    view.rerender(<CanvasPromptField value="second" onChange={accept} />);
    expect(setter.mock.calls).toEqual([]);
    view.rerender(<CanvasPromptField value="deliberate external text" onChange={accept} />);
    expect(input).toHaveValue("deliberate external text");
  });
});
