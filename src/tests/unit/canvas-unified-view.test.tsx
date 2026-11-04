import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CanvasController } from "@/components/create/canvas/controller";

import { canvasControllerFixture } from "./helpers/canvas-controller-fixtures";
import { CanvasStageHarness, installCanvasDom } from "./helpers/canvas-renderer-fixtures";

const controllers: CanvasController[] = [];
let restore: ReturnType<typeof installCanvasDom>;
function fixture() { const f = canvasControllerFixture(); controllers.push(f.controller); return f; }
function card(id: string) { return document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`); }
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

describe("unified creation view and working dock", () => {
  it("creates one visible card and one prompt editor, with compact settings and only explicit generation", async () => {
    const f = fixture();
    await f.controller.start(); await f.controller.newCanvas();
    render(<CanvasStageHarness controller={f.controller} />);
    await userEvent.click(screen.getByRole("button", { name: "新建图片" }));
    const field = await screen.findByRole("textbox", { name: "创作提示词" });
    expect(document.querySelectorAll(".react-flow__node")).toHaveLength(1);
    expect(document.querySelectorAll('[data-node-kind="prompt"]')).toHaveLength(0);
    expect(screen.queryByRole("textbox", { name: "节点提示词" })).not.toBeInTheDocument();
    const editor = screen.getByRole("complementary", { name: "节点编辑面板" });
    expect(within(editor).getByLabelText("节点模型")).toBeVisible();
    expect(within(editor).getByLabelText("节点输出尺寸")).toBeVisible();
    expect(within(editor).getByLabelText("节点平台渠道")).not.toBeVisible();
    expect(screen.queryByText("提示词已连接")).not.toBeInTheDocument();
    fireEvent.input(field, { target: { value: "a delicate botanical drawing" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(f.api.port.submit).not.toHaveBeenCalled();
    await userEvent.click(within(editor).getByRole("button", { name: "运行此节点" }));
    await waitFor(() => expect(f.api.port.submit).toHaveBeenCalledTimes(1));
  });

  it("switches old private/shared/standalone graphs losslessly and preserves the active textarea", async () => {
    const f = fixture();
    const { canvasId, nodeId, promptId } = await f.newGraph();
    const other = f.controller.addGeneration(canvasId, { x: 800, y: -600 });
    const note = f.controller.addPrompt(canvasId, { x: -1200, y: 900 }, "standalone note");
    f.controller.connect(canvasId, promptId, other); f.controller.selectNode(canvasId, nodeId);
    const before = f.controller.getSnapshot().active!.scene;
    render(<CanvasStageHarness controller={f.controller} />);
    const field = await screen.findByRole("textbox", { name: "创作提示词" });
    expect(card(promptId)).toBeNull(); expect(card(note)).toBeNull();
    expect(screen.getByText(/共享提示词 · 2 个生成节点/)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "高级图谱" }));
    await waitFor(() => expect(card(promptId)).not.toBeNull());
    expect(card(note)).not.toBeNull();
    expect(screen.getByRole("textbox", { name: "创作提示词" })).toBe(field);
    await userEvent.click(screen.getByRole("button", { name: "高级图谱" }));
    expect(card(promptId)).toBeNull(); expect(card(note)).toBeNull();
    expect(f.controller.getSnapshot().active!.scene).toEqual(before);
    fireEvent.change(screen.getByRole("combobox", { name: "选择画布节点" }), { target: { value: note } });
    await waitFor(() => expect(card(note)).not.toBeNull());
    expect(screen.getByRole("button", { name: "高级图谱" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "编辑所选节点" }));
    expect(within(screen.getByRole("complementary", { name: "节点编辑面板" })).getByRole("textbox", { name: "节点提示词" })).toHaveValue("standalone note");
    await userEvent.click(screen.getByRole("button", { name: "高级图谱" }));
    expect(f.controller.getSnapshot().active!.selectedNodeId).toBeNull();
    expect(screen.queryByRole("complementary", { name: "节点编辑面板" })).not.toBeInTheDocument();
    expect(f.controller.getSnapshot().active!.scene).toEqual(before);
    expect(f.api.port.submit).not.toHaveBeenCalled();
  });

  it("reopens the same selected creation after closing, using either click or a below-threshold pointer release", async () => {
    const f = fixture(); const { canvasId, nodeId } = await f.newGraph();
    f.controller.selectNode(canvasId, nodeId);
    render(<CanvasStageHarness controller={f.controller} />);
    await screen.findByRole("textbox", { name: "创作提示词" });
    await userEvent.click(screen.getByRole("button", { name: "关闭节点设置" }));
    expect(f.controller.getSnapshot().active!.selectedNodeId).toBe(nodeId);
    fireEvent.click(card(nodeId)!);
    expect(await screen.findByRole("textbox", { name: "创作提示词" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "关闭节点设置" }));
    fireEvent.pointerDown(card(nodeId)!, { pointerId: 10, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(card(nodeId)!, { pointerId: 10, clientX: 101, clientY: 101 });
    expect(await screen.findByRole("textbox", { name: "创作提示词" })).toBeInTheDocument();
    expect(f.api.port.submit).not.toHaveBeenCalled();
    expect(f.api.port.save).not.toHaveBeenCalled();
  });

  it("maps private prompts back to a creation and removes only that generator, never its source/results", async () => {
    const f = fixture(); const { canvasId, nodeId, promptId } = await f.newGraph();
    render(<CanvasStageHarness controller={f.controller} />);
    fireEvent.change(screen.getByRole("combobox", { name: "选择画布节点" }), { target: { value: promptId } });
    await userEvent.click(screen.getByRole("button", { name: "高级图谱" }));
    expect(f.controller.getSnapshot().active!.selectedNodeId).toBe(nodeId);
    await userEvent.click(screen.getByRole("button", { name: "移除所选节点" }));
    expect(f.controller.getSnapshot().active!.scene.nodes.map((node) => node.id)).toEqual([promptId]);
    await userEvent.click(screen.getByRole("button", { name: "查看已有提示词" }));
    await waitFor(() => expect(card(promptId)).not.toBeNull());
    expect(f.controller.getSnapshot().active!.document.id).toBe(canvasId);
    expect(f.api.port.submit).not.toHaveBeenCalled();
  });

  it("cancels uncommitted card movement on tool switch and hand mode cannot write a node position", async () => {
    const f = fixture(); const { canvasId, nodeId } = await f.newGraph();
    f.controller.selectNode(canvasId, null);
    const move = vi.spyOn(f.controller, "moveNode");
    render(<CanvasStageHarness controller={f.controller} />); await settle();
    const surface = card(nodeId)!;
    fireEvent.pointerDown(surface, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 160, clientY: 130 });
    await userEvent.click(screen.getByRole("button", { name: "平移工具" }));
    fireEvent.pointerUp(surface, { pointerId: 1, clientX: 200, clientY: 150 });
    expect(move).not.toHaveBeenCalled();
    fireEvent.pointerDown(surface, { pointerId: 2, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(surface, { pointerId: 2, clientX: 170, clientY: 160 });
    fireEvent.pointerUp(surface, { pointerId: 2, clientX: 170, clientY: 160 });
    expect(move).not.toHaveBeenCalled();
    expect(surface).not.toHaveClass("selectable");
    await userEvent.click(screen.getByRole("button", { name: "选择工具" }));
    fireEvent.pointerDown(surface, { pointerId: 3, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(surface, { pointerId: 3, clientX: 140, clientY: 140 });
    fireEvent.pointerUp(surface, { pointerId: 3, clientX: 160, clientY: 160 });
    expect(move).toHaveBeenCalledTimes(1);
  });

  it("opens a restored prompt selection in graph view without changing its camera or saved scene", async () => {
    const f = fixture(); const { canvasId, promptId } = await f.newGraph();
    f.controller.selectNode(canvasId, promptId);
    const before = f.controller.getSnapshot().active!;
    render(<CanvasStageHarness controller={f.controller} />);
    await waitFor(() => expect(card(promptId)).not.toBeNull());
    expect(screen.getByRole("button", { name: "高级图谱" })).toHaveAttribute("aria-pressed", "true");
    expect(f.controller.getSnapshot().active!.scene).toEqual(before.scene);
    expect(f.controller.getSnapshot().active!.viewport).toEqual(before.viewport);
    expect(f.api.port.submit).not.toHaveBeenCalled();
  });

  it("retains real readOnly guards with camera/view tools but no import controls or generation", async () => {
    const f = fixture(); await f.newGraph();
    render(<CanvasStageHarness controller={f.controller} />);
    act(() => f.controller.setReadOnly(true));
    expect(screen.queryByRole("button", { name: "新建图片" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "导入参考图" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("导入画布参考图文件")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "高级图谱" }));
    expect(screen.getByRole("button", { name: "高级图谱" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "放大画布" })).toBeEnabled();
    expect(f.api.port.submit).not.toHaveBeenCalled();
  });
});
