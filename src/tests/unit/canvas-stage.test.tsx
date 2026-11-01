import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CanvasStage } from "@/components/create/parts/canvas-stage";
import type { CanvasController, CanvasControllerOptions } from "@/components/create/canvas/controller";
import { CanvasTransportError } from "@/components/create/canvas/client-api";
import { CanvasDraftStoreError } from "@/components/create/canvas/draft-types";
import { CANVAS_LIMITS, CanvasContractError, canvasJsonByteLength } from "@/lib/canvas/contracts";

import { canvasControllerFixture, completedJob, deferred, canvasUuid, metadata } from "./helpers/canvas-controller-fixtures";
import { CanvasStageHarness, canvasStageCallbacks, canvasStageChannels, installCanvasDom } from "./helpers/canvas-renderer-fixtures";

const controllers: CanvasController[] = [];
let createObjectURL: ReturnType<typeof vi.fn<(blob: Blob) => string>>;
let revokeObjectURL: ReturnType<typeof vi.fn<(url: string) => void>>;
let restoreGeometry: ReturnType<typeof installCanvasDom>;
function fixture(options: Partial<CanvasControllerOptions> = {}) {
  const f = canvasControllerFixture({ objectUrls: { createObjectURL, revokeObjectURL }, ...options });
  controllers.push(f.controller);
  return f;
}
function file(name = "original.png") { return new File(["png"], name, { type: "image/png", lastModified: 1 }); }
function nodeElement(id: string) { return document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)!; }
async function settle() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 35)); }); }

beforeEach(() => {
  restoreGeometry = installCanvasDom();
  let preview = 0;
  createObjectURL = vi.fn(() => `blob:canvas-test-${++preview}`);
  revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  for (const controller of controllers.splice(0)) controller.dispose();
  restoreGeometry();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("real controlled canvas stage", () => {
  it("starts without creating/importing anything; only New creates an empty independent canvas", async () => {
    const f = fixture();
    await f.controller.start();
    render(<CanvasStageHarness controller={f.controller} />);
    expect(screen.getByText("选择一张画布开始")).toBeInTheDocument();
    expect(f.api.port.create).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "新建空白画布" }));
    await screen.findByText("把想法连成画面");
    expect(f.controller.getSnapshot().active?.scene).toMatchObject({ nodes: [], edges: [], runBindings: [] });
    await userEvent.click(screen.getByRole("button", { name: "添加第一个提示词" }));
    await screen.findByRole("textbox", { name: "节点提示词" });
    const first = f.controller.getSnapshot().activeCanvasId!;
    fireEvent.change(screen.getByRole("textbox", { name: "节点提示词" }), { target: { value: "仅属于第一张画布" } });
    await userEvent.click(screen.getByRole("button", { name: "新建空白画布" }));
    await waitFor(() => expect(f.controller.getSnapshot().activeCanvasId).not.toBe(first));
    expect(screen.queryByRole("textbox", { name: "节点提示词" })).not.toBeInTheDocument();
    expect(f.controller.getSnapshot().active?.scene.nodes).toHaveLength(0);
    await act(() => f.controller.selectCanvas(first));
    expect(await screen.findByRole("textbox", { name: "节点提示词" })).toHaveValue("仅属于第一张画布");
    expect(f.api.port.submit).not.toHaveBeenCalled();
    expect(screen.queryByText(/复制画布|最近图片|导入对话/)).not.toBeInTheDocument();
  });

  it("keeps prompt composition, text selection, Enter/Delete and wheel local instead of running or moving nodes", async () => {
    const f = fixture();
    const graph = await f.newGraph();
    render(<CanvasStageHarness controller={f.controller} />);
    const textarea = await screen.findByRole("textbox", { name: "节点提示词" });
    await settle();
    const position = f.controller.getSnapshot().active!.scene.nodes[0].position;
    const camera = f.controller.getSnapshot().active!.viewport;
    act(() => textarea.focus());
    fireEvent.compositionStart(textarea);
    fireEvent.change(textarea, { target: { value: "中文输入中的画面" } });
    fireEvent.keyDown(textarea, { key: "Enter", isComposing: true, keyCode: 229 });
    fireEvent.compositionEnd(textarea);
    fireEvent.keyDown(textarea, { key: "Enter" });
    fireEvent.keyDown(textarea, { key: "Delete" });
    fireEvent.keyDown(textarea, { key: "ArrowRight" });
    fireEvent.wheel(textarea, { deltaY: 150 });
    await settle();
    expect(textarea).toHaveFocus();
    expect(textarea).toHaveClass("nodrag", "nopan", "nowheel");
    expect(f.controller.getSnapshot().active!.scene.nodes.find((node) => node.id === graph.promptId)).toMatchObject({ text: "中文输入中的画面", position });
    expect(f.controller.getSnapshot().active!.viewport).toEqual(camera);
    expect(f.api.port.submit).not.toHaveBeenCalled();
  });

  it.each([true, false])("does not restore stale text into the native textarea during input (composition=%s)", async (composing) => {
    const f = fixture();
    const { canvasId, promptId } = await f.newGraph();
    f.controller.updatePrompt(canvasId, promptId, "");
    render(<CanvasStageHarness controller={f.controller} />);
    const textarea = await screen.findByRole("textbox", { name: "节点提示词" }) as HTMLTextAreaElement;
    await settle();
    act(() => textarea.focus());
    const valueSetter = vi.spyOn(textarea, "value", "set");
    if (composing) fireEvent.compositionStart(textarea);
    const text = "中文创作测试";
    // Testing Library writes through the native prototype setter, as the browser
    // does. Any instance-setter call here is React restoring a controlled value.
    act(() => {
      for (const value of ["中文", text]) fireEvent.input(textarea, { target: { value }, data: value, inputType: composing ? "insertCompositionText" : "insertText", isComposing: composing });
    });
    await settle();
    expect(valueSetter.mock.calls.map(([value]) => value)).toEqual([]);
    expect(textarea).toHaveValue(text);
    expect(textarea).toHaveFocus();
    expect(f.controller.getSnapshot().active!.scene.nodes.find((node) => node.id === promptId)).toMatchObject({ text });
    await act(() => f.controller.flushLocal(canvasId));
    expect(f.store.row("owner-one", canvasId)!.envelope.scene.nodes.find((node) => node.id === promptId)).toMatchObject({ text });
    if (composing) fireEvent.compositionEnd(textarea, { data: text });
    expect(f.api.port.submit).not.toHaveBeenCalled();
  });

  it("adopts later controller text without replaying the prompt's earlier synchronous local draft", async () => {
    const f = fixture();
    const { canvasId, promptId } = await f.newGraph();
    const view = render(<CanvasStageHarness controller={f.controller} />);
    const textarea = await screen.findByRole("textbox", { name: "节点提示词" });
    await settle();
    act(() => textarea.focus());
    fireEvent.input(textarea, { target: { value: "本地同步输入" }, inputType: "insertText" });
    await settle();
    await act(async () => { f.controller.updatePrompt(canvasId, promptId, "frozen prompt"); });
    expect(textarea).toHaveValue("frozen prompt");
    expect(textarea).toHaveFocus();
    fireEvent.input(textarea, { target: { value: "新的本地输入" }, inputType: "insertText" });
    await settle();
    act(() => {
      f.controller.setReadOnly(true);
      expect(() => f.controller.updatePrompt(canvasId, promptId, "不允许的只读编辑")).toThrow(/当前画布仅支持查看/);
    });
    expect(screen.queryByRole("textbox", { name: "节点提示词" })).not.toBeInTheDocument();
    expect(screen.getByText("新的本地输入")).toBeInTheDocument();
    await act(async () => { f.controller.setReadOnly(false); f.controller.updatePrompt(canvasId, promptId, "控制器恢复的文本"); });
    expect(screen.getByRole("textbox", { name: "节点提示词" })).toHaveValue("控制器恢复的文本");
    view.unmount();
    render(<CanvasStageHarness controller={f.controller} />);
    expect(await screen.findByRole("textbox", { name: "节点提示词" })).toHaveValue("控制器恢复的文本");
    expect(f.api.port.submit).not.toHaveBeenCalled();
  });

  it("does not display rejected prompt text as the scene captured by Save", async () => {
    const f = fixture();
    const { canvasId, promptId } = await f.newGraph();
    const text = "\u753b".repeat(8000);
    for (let index = 0; index < CANVAS_LIMITS.sceneNodes - 2; index += 1) {
      const scene = f.controller.getSnapshot().active!.scene;
      const node = { id: canvasUuid(800 + index), kind: "prompt" as const, position: { x: 0, y: (index + 1) * 360 }, text };
      if (canvasJsonByteLength({ ...scene, nodes: [...scene.nodes, node] }) > CANVAS_LIMITS.sceneBytes) break;
      f.controller.addPrompt(canvasId, node.position, text);
    }
    const before = f.controller.getSnapshot().active!.scene;
    const prompt = before.nodes.find((node) => node.id === promptId);
    expect(prompt?.kind).toBe("prompt");
    expect(canvasJsonByteLength({ ...before, nodes: before.nodes.map((node) => node.id === promptId ? { ...node, text } : node) })).toBeGreaterThan(CANVAS_LIMITS.sceneBytes);
    render(<CanvasStageHarness controller={f.controller} />);
    await settle();
    const textarea = within(nodeElement(promptId)).getByRole("textbox", { name: "节点提示词" });
    fireEvent.input(textarea, { target: { value: text }, inputType: "insertFromPaste" });
    await settle();
    expect(f.controller.getSnapshot().active!.scene).toEqual(before);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(textarea).toHaveValue(prompt?.kind === "prompt" ? prompt.text : "");
    await act(() => f.controller.saveCanvas(canvasId));
    expect(f.api.port.save).toHaveBeenCalledWith(canvasId, expect.objectContaining({ scene: before }), expect.any(AbortSignal));
    expect(f.api.port.submit).not.toHaveBeenCalled();
  });

  it("scopes Delete to the focused canvas rather than toolbar, navigation or sibling viewer controls", async () => {
    const f = fixture();
    const { canvasId, promptId, nodeId } = await f.newGraph();
    f.controller.selectNode(canvasId, promptId);
    render(<><CanvasStageHarness controller={f.controller} /><button type="button">工作台图片查看操作</button></>);
    await settle();
    const before = f.controller.getSnapshot().active!.scene;
    for (const target of [screen.getByRole("button", { name: "重命名画布" }), screen.getByRole("button", { name: "新建空白画布" }), screen.getByRole("button", { name: "工作台图片查看操作" })]) {
      act(() => target.focus());
      fireEvent.keyDown(target, { key: "Delete", code: "Delete" });
      fireEvent.keyUp(target, { key: "Delete", code: "Delete" });
      await settle();
      expect(f.controller.getSnapshot().active!.scene).toEqual(before);
    }
    const node = nodeElement(promptId);
    act(() => node.focus());
    fireEvent.keyDown(node, { key: "Delete", code: "Delete" });
    fireEvent.keyUp(node, { key: "Delete", code: "Delete" });
    await waitFor(() => expect(f.controller.getSnapshot().active!.scene.nodes.map((item) => item.id)).toEqual([nodeId]));
    expect(f.controller.getSnapshot().active!.scene.edges).toHaveLength(0);
    expect(f.api.port.submit).not.toHaveBeenCalled();
  });

  it("keeps node action-button keyboard input from moving or deleting the selected card", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    f.controller.selectNode(canvasId, nodeId);
    render(<CanvasStageHarness controller={f.controller} />);
    await settle();
    const before = f.controller.getSnapshot().active!.scene;
    const settings = screen.getByRole("button", { name: "设置生成节点参数" });
    act(() => settings.focus());
    for (const key of ["ArrowRight", "Delete", "Backspace"]) {
      fireEvent.keyDown(settings, { key, code: key });
      fireEvent.keyUp(settings, { key, code: key });
    }
    await settle();
    expect(f.controller.getSnapshot().active!.scene).toEqual(before);
    expect(settings).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("complementary", { name: "节点编辑面板" })).toBeInTheDocument();
    expect(f.api.port.submit).not.toHaveBeenCalled();
  });

  it("keeps keyboard selection and deletion of input edges without removing their endpoint cards", async () => {
    const f = fixture();
    await f.newGraph();
    render(<CanvasStageHarness controller={f.controller} />);
    await settle();
    const edge = screen.getByRole("group", { name: "提示词输入" });
    fireEvent.keyDown(edge, { key: "Enter", code: "Enter" });
    fireEvent.keyUp(edge, { key: "Enter", code: "Enter" });
    expect(edge).toHaveClass("selected");
    fireEvent.keyDown(edge, { key: "Backspace", code: "Backspace" });
    fireEvent.keyUp(edge, { key: "Backspace", code: "Backspace" });
    await waitFor(() => expect(f.controller.getSnapshot().active!.scene.edges).toHaveLength(0));
    expect(f.controller.getSnapshot().active!.scene.nodes).toHaveLength(2);
    expect(f.api.port.submit).not.toHaveBeenCalled();
  });

  it("keeps a late New-shell failure on its captured canvas and clears the message after explicit registration retry", async () => {
    const f = fixture();
    const first = await f.newGraph();
    const delayed = deferred<never>();
    vi.mocked(f.api.port.create).mockImplementationOnce(() => delayed.promise);
    render(<CanvasStageHarness controller={f.controller} />);
    await userEvent.click(screen.getByRole("button", { name: "新建空白画布" }));
    const createdId = f.controller.getSnapshot().activeCanvasId!;
    expect(createdId).not.toBe(first.canvasId);
    await act(() => f.controller.selectCanvas(first.canvasId));
    await act(async () => { delayed.reject(new CanvasTransportError()); });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "节点提示词" })).toHaveValue("frozen prompt");
    await act(() => f.controller.selectCanvas(createdId));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "重试登记" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(f.controller.getSnapshot().active!.document).toMatchObject({ id: createdId, shell: "registered", cloudState: "local" });
    expect(f.controller.getSnapshot().active!.scene.nodes).toHaveLength(0);
    expect(f.api.port.submit).not.toHaveBeenCalled();
  });

  it("ignores React Flow measurements and round-trips negative camera coordinates without dirtying on mount", async () => {
    const f = fixture();
    const { canvasId } = await f.newGraph();
    f.controller.setViewport(canvasId, { x: -130, y: -85, zoom: 0.25 });
    const before = f.controller.getSnapshot().active!;
    render(<CanvasStageHarness controller={f.controller} />);
    await settle();
    expect(f.controller.getSnapshot().active!.document.editRevision).toBe(before.document.editRevision);
    expect(document.querySelector(".react-flow__viewport")).toHaveStyle({ transform: "translate(-130px,-85px) scale(0.25)" });
    await userEvent.click(screen.getByRole("button", { name: "放大画布" }));
    await waitFor(() => expect(f.controller.getSnapshot().active!.viewport.zoom).toBeGreaterThan(0.25));
    expect(f.controller.getSnapshot().active!.scene.viewport).toEqual(f.controller.getSnapshot().active!.viewport);
    await userEvent.click(screen.getByRole("button", { name: "适应全部节点" }));
    await settle();
    expect(f.controller.getSnapshot().active!.scene.nodes).toEqual(before.scene.nodes);
    expect(f.api.port.submit).not.toHaveBeenCalled();
  });

  it("keeps measured cards visible across metadata, Save and run refreshes without another resize delivery", async () => {
    const f = fixture();
    const { canvasId, promptId, nodeId } = await f.newGraph();
    const referenceId = f.controller.importReference(canvasId, file(), { x: -300, y: 400 });
    render(<CanvasStageHarness controller={f.controller} />);
    await settle();
    const originals = [promptId, nodeId, referenceId].map(nodeElement);
    for (const node of originals) expect(node).toHaveStyle({ visibility: "visible" });
    const before = f.controller.getSnapshot().active!;
    // A controller refresh is not a physical resize. Do not let the fake
    // observer immediately repair dimensions that the adapter accidentally lost.
    restoreGeometry.pauseResizeDelivery();
    await act(() => f.controller.renameCanvas(canvasId, "只改变账户名称"));
    for (const node of originals) expect(node).toHaveStyle({ visibility: "visible" });
    expect(f.controller.getSnapshot().active!.document.editRevision).toBe(before.document.editRevision);
    await act(() => f.controller.saveCanvas(canvasId));
    for (const node of originals) expect(node).toHaveStyle({ visibility: "visible" });
    await act(() => f.controller.runNode(canvasId, nodeId));
    const binding = f.controller.getSnapshot().active!.scene.runBindings[0];
    await act(async () => { f.jobs.push({ ownerId: "owner-one", canvasId, nodeId, runId: binding.runId }, completedJob(binding.jobId)); });
    for (const node of originals) expect(node).toHaveStyle({ visibility: "visible" });
    act(() => restoreGeometry.deliverResizes());
    await settle();
    for (const node of document.querySelectorAll(".react-flow__node")) expect(node).toHaveStyle({ visibility: "visible" });
    await act(() => f.controller.flushLocal(canvasId));
    for (const scene of [f.controller.getSnapshot().active!.scene, f.store.row("owner-one", canvasId)!.envelope.scene, f.api.documents.get(canvasId)!.scene!]) {
      for (const node of scene.nodes) {
        expect(node).not.toHaveProperty("measured");
        expect(node).not.toHaveProperty("width");
        expect(node).not.toHaveProperty("height");
      }
    }
    act(() => f.controller.setReadOnly(true));
    for (const node of originals) expect(node).toHaveStyle({ visibility: "visible" });
    expect(screen.getByRole("button", { name: "查看参考原图" })).toBeEnabled();
  });

  it("imports and replaces originals locally, releases card preview leases on unmount, and retains originals", async () => {
    const f = fixture();
    const { canvasId } = await f.newGraph();
    const view = render(<CanvasStageHarness controller={f.controller} />);
    fireEvent.change(screen.getByLabelText("导入画布参考图文件"), { target: { files: [file()] } });
    const image = await screen.findByAltText("画布参考图");
    expect(image).toHaveAttribute("src", "blob:canvas-test-1");
    const reference = f.controller.getSnapshot().active!.scene.nodes.find((node) => node.kind === "reference")!;
    expect(reference).toMatchObject({ source: { kind: "local" } });
    expect(f.api.port.upload).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "节点提示词" }), { target: { value: "更新提示词不更换参考图预览" } });
    await settle();
    expect(screen.getByAltText("画布参考图")).toBe(image);
    expect(image).toHaveAttribute("src", "blob:canvas-test-1");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("替换参考原图文件"), { target: { files: [file("replacement.png")] } });
    await waitFor(() => expect(screen.getByAltText("画布参考图")).toHaveAttribute("src", "blob:canvas-test-2"));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:canvas-test-1");
    await act(() => f.controller.flushLocal(canvasId));
    const originals = f.store.row("owner-one", canvasId)!.blobs;
    view.unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:canvas-test-2");
    expect(f.store.row("owner-one", canvasId)!.blobs).toHaveLength(originals.length);
    render(<CanvasStageHarness controller={f.controller} />);
    expect(await screen.findByAltText("画布参考图")).toHaveAttribute("src", "blob:canvas-test-3");
    expect(f.api.port.upload).not.toHaveBeenCalled();
    expect(f.api.port.submit).not.toHaveBeenCalled();
  });

  it("allows keyboard-accessible direct input connection and visible ordinal reordering without generation", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    const first = f.controller.importReference(canvasId, file("first.png"), { x: 200, y: 10 });
    const second = f.controller.importReference(canvasId, file("second.png"), { x: -900, y: -500 });
    f.controller.connect(canvasId, first, nodeId);
    f.controller.connect(canvasId, second, nodeId);
    f.controller.selectNode(canvasId, nodeId);
    render(<CanvasStageHarness controller={f.controller} />);
    const inputs = screen.getByRole("list", { name: "有序参考图输入" });
    expect(within(inputs).getAllByRole("listitem")[0]).toHaveTextContent(first.slice(-6));
    expect(within(inputs).getAllByRole("listitem")[1]).toHaveTextContent(second.slice(-6));
    await userEvent.click(screen.getByRole("button", { name: "上移参考图 2" }));
    expect(within(inputs).getAllByRole("listitem")[0]).toHaveTextContent(second.slice(-6));
    await userEvent.click(screen.getByRole("button", { name: "断开参考图 1" }));
    expect(f.controller.getSnapshot().active!.scene.edges.filter((edge) => edge.kind === "image-input")).toMatchObject([{ source: first, ordinal: 1 }]);
    fireEvent.change(screen.getByLabelText("选择参考图或结果"), { target: { value: second } });
    await userEvent.click(screen.getByRole("button", { name: "连接选择参考图或结果" }));
    expect(f.controller.getSnapshot().active!.scene.edges.filter((edge) => edge.kind === "image-input")).toMatchObject([{ source: first, ordinal: 1 }, { source: second, ordinal: 2 }]);
    expect(within(screen.getByRole("complementary", { name: "节点编辑面板" })).getByText(/固定 1 张输出/)).toBeInTheDocument();
    expect(screen.queryByLabelText("节点生成张数")).not.toBeInTheDocument();
    expect(f.api.port.submit).not.toHaveBeenCalled();
  });

  it("shows the shared actionable duplicate/invalid-input error and keeps the prior graph", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    const original = f.controller.importReference(canvasId, file(), { x: 0, y: 250 });
    const duplicate = f.controller.reuseReference(canvasId, original, { x: 100, y: 250 });
    f.controller.connect(canvasId, original, nodeId);
    f.controller.selectNode(canvasId, nodeId);
    render(<CanvasStageHarness controller={f.controller} />);
    fireEvent.change(screen.getByLabelText("选择参考图或结果"), { target: { value: duplicate } });
    await userEvent.click(screen.getByRole("button", { name: "连接选择参考图或结果" }));
    expect(screen.getByRole("alert")).toHaveTextContent(new CanvasContractError("CANVAS_DUPLICATE_INPUT").message);
    expect(f.controller.getSnapshot().active!.scene.edges.filter((edge) => edge.kind === "image-input")).toHaveLength(1);
    expect(f.api.port.submit).not.toHaveBeenCalled();
  });

  it("reports an invalid clicked port pair while real React Flow accepts a later correctly typed pair", async () => {
    const f = fixture();
    const { canvasId } = await f.newGraph();
    f.controller.disconnect(canvasId, f.controller.getSnapshot().active!.scene.edges[0].id);
    render(<CanvasStageHarness controller={f.controller} />);
    await settle();
    fireEvent.click(screen.getByLabelText("提示词输出"));
    fireEvent.click(screen.getByLabelText("生成节点参考图输入"));
    expect(screen.getByRole("alert")).toHaveTextContent(new CanvasContractError("CANVAS_INVALID_CONNECTION").message);
    expect(f.controller.getSnapshot().active!.scene.edges).toHaveLength(0);
    fireEvent.click(screen.getByLabelText("提示词输出"));
    fireEvent.click(screen.getByLabelText("生成节点提示词输入"));
    await settle();
    expect(f.controller.getSnapshot().active!.scene.edges).toMatchObject([{ kind: "prompt-input" }]);
    expect(f.api.port.submit).not.toHaveBeenCalled();
  });

  it("removes a node without a bubbled stale selection, extra run or surviving incident input", async () => {
    const f = fixture();
    const { promptId, nodeId } = await f.newGraph();
    render(<CanvasStageHarness controller={f.controller} />);
    await userEvent.click(await screen.findByRole("button", { name: "删除提示词节点" }));
    await settle();
    expect(f.controller.getSnapshot().active!.scene.nodes.map((node) => node.id)).toEqual([nodeId]);
    expect(f.controller.getSnapshot().active!.scene.edges).toHaveLength(0);
    expect(nodeElement(promptId)).toBeNull();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(f.api.port.submit).not.toHaveBeenCalled();
  });

  it("submits only explicit Run, freezes ordered inputs and appends immutable results across reruns", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    f.controller.updateParameters(canvasId, nodeId, { count: 2 });
    const callbacks = canvasStageCallbacks();
    render(<CanvasStageHarness controller={f.controller} {...callbacks} />);
    await userEvent.click(await screen.findByRole("button", { name: "运行此节点" }));
    await waitFor(() => expect(f.api.port.submit).toHaveBeenCalledTimes(1));
    const binding = f.controller.getSnapshot().active!.scene.runBindings[0];
    await act(async () => { f.jobs.push({ ownerId: "owner-one", canvasId, nodeId, runId: binding.runId }, completedJob(binding.jobId, 2)); });
    const results = await screen.findAllByAltText("画布生成结果");
    expect(results).toHaveLength(2);
    const originalResult = f.controller.getSnapshot().active!.scene.nodes.find((node) => node.kind === "result")!;
    expect(originalResult.kind).toBe("result");
    await userEvent.click(within(nodeElement(originalResult.id)).getByRole("button", { name: "查看生成原图" }));
    expect(callbacks.onViewImage).toHaveBeenCalledWith(expect.objectContaining({ canvasId, nodeId: originalResult.id, kind: "result", jobId: binding.jobId }));
    await act(async () => { f.controller.connect(canvasId, originalResult.id, nodeId); });
    expect(f.api.port.submit).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "运行此节点" }));
    await waitFor(() => expect(f.api.port.submit).toHaveBeenCalledTimes(2));
    const projection = vi.mocked(f.api.port.submit).mock.calls[1][0];
    expect(projection.runId).not.toBe(binding.runId);
    expect(projection.references).toMatchObject([{ sourceNodeId: originalResult.id, ordinal: 1, kind: "result", jobId: binding.jobId }]);
    expect(f.controller.getSnapshot().active!.scene.nodes.find((node) => node.id === originalResult.id)).toEqual(originalResult);
    expect(screen.getAllByAltText("画布生成结果")).toHaveLength(2);
  });

  it("renders uncertain acceptance with explicit same-run retry, never submitting on remount", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    vi.mocked(f.api.port.submit).mockRejectedValueOnce(new CanvasTransportError());
    const view = render(<CanvasStageHarness controller={f.controller} />);
    await userEvent.click(await screen.findByRole("button", { name: "运行此节点" }));
    await screen.findByRole("button", { name: "重试原请求" });
    const first = vi.mocked(f.api.port.submit).mock.calls[0][0];
    expect(screen.getByRole("button", { name: "运行此节点" })).toBeDisabled();
    view.unmount();
    render(<CanvasStageHarness controller={f.controller} />);
    await settle();
    expect(f.api.port.submit).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "重试原请求" }));
    await waitFor(() => expect(f.api.port.submit).toHaveBeenCalledTimes(2));
    expect(vi.mocked(f.api.port.submit).mock.calls[1][0]).toEqual(first);
    expect(first).toMatchObject({ canvasId, nodeId });
  });

  it("keeps node parameters/catalogs independent, opens explicitly targeted credentials, and does not run on field blur", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    f.controller.selectNode(canvasId, nodeId);
    const callbacks = canvasStageCallbacks();
    render(<CanvasStageHarness controller={f.controller} {...callbacks} />);
    fireEvent.change(screen.getByLabelText("节点平台渠道"), { target: { value: "another-channel" } });
    expect(screen.getByLabelText("节点模型")).toHaveValue("another-default");
    await userEvent.click(screen.getByRole("button", { name: "自填 API" }));
    const model = screen.getByLabelText("节点第三方模型");
    fireEvent.change(model, { target: { value: "" } });
    fireEvent.blur(model);
    expect(screen.getByText("参数未应用，请检查输入")).toBeInTheDocument();
    fireEvent.change(model, { target: { value: "我的模型" } });
    fireEvent.compositionStart(model);
    fireEvent.keyDown(model, { key: "Enter", isComposing: true });
    expect(f.controller.getSnapshot().active!.scene.nodes.find((node) => node.id === nodeId)).toMatchObject({ parameters: { model: "another-default" } });
    fireEvent.compositionEnd(model); fireEvent.blur(model);
    expect(screen.getByLabelText("节点第三方模型")).toHaveValue("我的模型");
    await act(async () => { f.controller.updateParameters(canvasId, nodeId, { model: "provider-discovered-model" }); });
    expect(screen.getByLabelText("节点第三方模型")).toHaveValue("provider-discovered-model");
    const currentModel = screen.getByLabelText("节点第三方模型");
    act(() => currentModel.focus());
    fireEvent.change(currentModel, { target: { value: "still-typing" } });
    await act(async () => { f.controller.updateParameters(canvasId, nodeId, { model: "late-provider-result" }); });
    expect(currentModel).toHaveValue("still-typing");
    expect(currentModel).toHaveFocus();
    fireEvent.blur(currentModel);
    expect(f.controller.getSnapshot().active!.scene.nodes.find((node) => node.id === nodeId)).toMatchObject({ parameters: { model: "still-typing" } });
    await userEvent.click(screen.getByRole("button", { name: "配置此节点的 API 凭据" }));
    expect(callbacks.onOpenProviderSettings).toHaveBeenCalledWith({ canvasId, nodeId });
    expect(screen.queryByLabelText(/API Key/)).not.toBeInTheDocument();
    expect(f.api.port.submit).not.toHaveBeenCalled();
  });

  it("commits the focused inspector draft before keyboard Save and blocks an invalid draft without losing focus", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    f.controller.selectNode(canvasId, nodeId);
    render(<CanvasStageHarness controller={f.controller} />);
    await userEvent.click(screen.getByRole("button", { name: "自填 API" }));
    const model = screen.getByLabelText("节点第三方模型");
    act(() => model.focus());
    fireEvent.change(model, { target: { value: "保存前正在编辑的模型" } });
    fireEvent.keyDown(model, { key: "s", code: "KeyS", ctrlKey: true });
    await waitFor(() => expect(f.api.documents.get(canvasId)?.scene?.nodes.find((node) => node.id === nodeId)).toMatchObject({ parameters: { model: "保存前正在编辑的模型" } }));
    expect(model).toHaveFocus();
    fireEvent.change(model, { target: { value: "" } });
    fireEvent.keyDown(model, { key: "s", code: "KeyS", metaKey: true });
    await settle();
    expect(model).toHaveAttribute("aria-invalid", "true");
    expect(model).toHaveFocus();
    expect(f.api.port.save).toHaveBeenCalledTimes(1);
    expect(f.api.port.submit).not.toHaveBeenCalled();
  });

  it("shows a captured Save honestly while newer edits and another selected canvas stay independent", async () => {
    const f = fixture();
    const first = await f.newGraph();
    const second = await f.controller.newCanvas("第二张画布");
    await f.controller.selectCanvas(first.canvasId);
    const delayed = deferred<void>();
    const save = vi.mocked(f.api.port.save).getMockImplementation()!;
    vi.mocked(f.api.port.save).mockImplementationOnce(async (...args) => { await delayed.promise; return save(...args); });
    render(<CanvasStageHarness controller={f.controller} />);
    await userEvent.click(screen.getByRole("button", { name: "保存到账户" }));
    await waitFor(() => expect(f.api.port.save).toHaveBeenCalledTimes(1));
    expect(screen.getAllByText("正在保存账户快照").length).toBeGreaterThan(0);
    expect(screen.queryByText("账户快照已保存")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "节点提示词" }), { target: { value: "保存途中更新的内容" } });
    await userEvent.click(screen.getByRole("button", { name: /第二张画布/ }));
    expect(f.controller.getSnapshot().activeCanvasId).toBe(second);
    await act(async () => { delayed.resolve(); });
    await act(() => f.controller.selectCanvas(first.canvasId));
    expect(await screen.findByRole("textbox", { name: "节点提示词" })).toHaveValue("保存途中更新的内容");
    expect(screen.getAllByText("有未同步修改").length).toBeGreaterThan(0);
    expect(f.api.documents.get(first.canvasId)?.scene?.nodes.find((node) => node.id === first.promptId)).toMatchObject({ text: "frozen prompt" });
    expect(f.api.documents.get(second)?.scene).toBeNull();
  });

  it("requires explicit deletion confirmation and keeps metadata rename from marking edits saved", async () => {
    const f = fixture();
    const { canvasId } = await f.newGraph();
    render(<CanvasStageHarness controller={f.controller} />);
    await userEvent.click(screen.getByRole("button", { name: "重命名画布" }));
    fireEvent.change(screen.getByLabelText("画布名称"), { target: { value: "改名但未保存" } });
    await userEvent.click(screen.getByRole("button", { name: "确认重命名" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "改名但未保存" })).toBeInTheDocument();
    expect(screen.getAllByText("尚未保存到账户").length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: "删除画布" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("不会因此取消或退款");
    expect(f.api.port.delete).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(f.controller.getSnapshot().active!.scene.nodes).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "删除画布" }));
    await userEvent.click(screen.getByRole("button", { name: "确认删除画布" }));
    await waitFor(() => expect(f.api.deleted.has(canvasId)).toBe(true));
    expect(f.api.port.submit).not.toHaveBeenCalled();
  });

  it("preserves failed/conflicting drafts and exposes only a warned account reload", async () => {
    const f = fixture();
    const { canvasId, promptId } = await f.newGraph();
    await f.controller.saveCanvas(canvasId);
    f.controller.updatePrompt(canvasId, promptId, "保留本地修改");
    vi.mocked(f.api.port.save).mockRejectedValueOnce(new CanvasContractError("CANVAS_REVISION_CONFLICT"));
    render(<CanvasStageHarness controller={f.controller} />);
    await userEvent.click(screen.getByRole("button", { name: "保存到账户" }));
    const reload = await screen.findByRole("button", { name: "重新载入账户快照" });
    expect(screen.getByRole("textbox", { name: "节点提示词" })).toHaveValue("保留本地修改");
    await userEvent.click(reload);
    expect(screen.getByRole("dialog")).toHaveTextContent("放弃当前本地场景");
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(f.controller.getSnapshot().active!.scene.nodes[0]).toMatchObject({ text: "保留本地修改" });
    await userEvent.click(screen.getByRole("button", { name: "重新载入账户快照" }));
    await userEvent.click(screen.getByRole("button", { name: "放弃本地并载入" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "节点提示词" })).toHaveValue("frozen prompt"));
    expect(f.api.port.submit).not.toHaveBeenCalled();
  });

  it("reports local durability failure while keeping memory edits and manual account Save available", async () => {
    const f = fixture();
    const { canvasId } = await f.newGraph();
    f.store.setFailure(new CanvasDraftStoreError("quota"));
    await f.controller.flushLocal(canvasId);
    render(<CanvasStageHarness controller={f.controller} />);
    expect(screen.getByText("本地保存失败")).toBeInTheDocument();
    expect(await screen.findByRole("textbox", { name: "节点提示词" })).toHaveValue("frozen prompt");
    expect(screen.getByRole("button", { name: "保存到账户" })).toBeEnabled();
    expect(screen.queryByText("本地已保存")).not.toBeInTheDocument();
  });

  it("offers missing-original replacement without discarding graph or claiming a ready input", async () => {
    const f = fixture();
    const id = canvasUuid(300);
    const refId = canvasUuid(301);
    f.api.documents.set(id, { canvas: metadata(id, { hasSavedSnapshot: true, lastSavedAt: "2026-10-29T00:00:00.000Z" }), scene: { schemaVersion: 1, nodes: [{ id: refId, kind: "reference", position: { x: -100, y: 50 }, source: { kind: "imported", assetId: "expired-original" } }], edges: [], runBindings: [], viewport: { x: 0, y: 0, zoom: 1 } } });
    await f.controller.start();
    render(<CanvasStageHarness controller={f.controller} />);
    expect(await screen.findByText("原图不可用，请重新选择文件")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新上传" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("替换参考原图文件"), { target: { files: [file()] } });
    expect(await screen.findByAltText("画布参考图")).toHaveAttribute("src", "blob:canvas-test-1");
    expect(f.controller.getSnapshot().active!.scene.nodes[0]).toMatchObject({ id: refId, position: { x: -100, y: 50 }, source: { kind: "local" } });
  });

  it("offers read-only result recovery through the existing runtime resolver without changing the saved scene", async () => {
    const f = fixture({ readOnly: true });
    const canvasId = canvasUuid(400);
    const job = completedJob("saved-result-job");
    const image = job.images[0];
    const resultId = `result:${image.id}`;
    f.api.documents.set(canvasId, {
      canvas: metadata(canvasId, { hasSavedSnapshot: true, lastSavedAt: "2026-10-29T00:00:00.000Z" }),
      scene: { schemaVersion: 1, nodes: [{ id: resultId, kind: "result", position: { x: -100, y: -50 }, imageId: image.id, jobId: job.id }], edges: [], runBindings: [], viewport: { x: -50, y: 20, zoom: 0.25 } },
    });
    await f.controller.start();
    render(<CanvasStageHarness controller={f.controller} />);
    await settle();
    const before = f.controller.getSnapshot().active!;
    expect(screen.getByText("结果图片暂不可用")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "下载" })).not.toBeInTheDocument();
    const resolve = vi.mocked(f.api.port.resolve).getMockImplementation()!;
    vi.mocked(f.api.port.resolve).mockImplementation(async (...args) => {
      const response = await resolve(...args);
      response.images[image.id] = { ...image, jobId: job.id };
      return response;
    });
    await userEvent.click(screen.getByRole("button", { name: "重新读取结果图片" }));
    expect(await screen.findByAltText("画布生成结果")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下载" })).toBeEnabled();
    expect(f.controller.getSnapshot().active!.scene).toEqual(before.scene);
    expect(f.controller.getSnapshot().active!.document.editRevision).toBe(before.document.editRevision);
    expect(f.api.port.submit).not.toHaveBeenCalled();
    expect(f.api.port.save).not.toHaveBeenCalled();
    expect(f.api.port.delete).not.toHaveBeenCalled();
  });

  it("retains genuine read-only guards on the same mounted stage while selection, camera, image actions and navigation remain", async () => {
    const f = fixture();
    const { canvasId, promptId, nodeId } = await f.newGraph();
    const refId = f.controller.importReference(canvasId, file(), { x: 0, y: 260 });
    await f.controller.runNode(canvasId, nodeId);
    const binding = f.controller.getSnapshot().active!.scene.runBindings[0];
    f.jobs.push({ ownerId: "owner-one", canvasId, nodeId, runId: binding.runId }, completedJob(binding.jobId));
    f.controller.selectNode(canvasId, nodeId);
    const other = await f.controller.newCanvas("手机查看的另一张画布");
    await f.controller.selectCanvas(canvasId);
    const callbacks = canvasStageCallbacks();
    render(<CanvasStageHarness controller={f.controller} {...callbacks} />);
    await settle();
    await act(async () => { f.controller.setReadOnly(true); });
    const before = f.controller.getSnapshot().active!;
    for (const name of ["新建空白画布", "重命名画布", "删除画布", "保存到账户", "运行此节点", "参考图", "生成节点", "重试原请求", "替换原图"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "节点提示词" })).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "节点编辑面板" })).not.toBeInTheDocument();
    expect(document.querySelectorAll('input[type="file"]')).toHaveLength(0);
    for (const element of document.querySelectorAll(".react-flow__node")) expect(element).not.toHaveClass("draggable");
    for (const element of document.querySelectorAll(".react-flow__handle")) {
      expect(element).not.toHaveClass("connectable");
      expect(element).not.toHaveClass("connectablestart");
      expect(element).not.toHaveClass("connectableend");
    }
    const node = nodeElement(promptId);
    fireEvent.click(node);
    expect(f.controller.getSnapshot().active!.selectedNodeId).toBe(promptId);
    fireEvent.keyDown(node, { key: "ArrowRight" });
    fireEvent.keyDown(node, { key: "Delete" });
    fireEvent.keyDown(node, { key: "s", ctrlKey: true });
    fireEvent.keyDown(node, { key: "n", ctrlKey: true });
    fireEvent.drop(screen.getByTestId("canvas-viewport"), { dataTransfer: { files: [file()], types: ["Files"] } });
    fireEvent.paste(screen.getByTestId("canvas-viewport"), { clipboardData: { files: [file()] } });
    await userEvent.click(screen.getByRole("button", { name: "放大画布" }));
    await waitFor(() => expect(f.controller.getSnapshot().active!.viewport.zoom).toBeGreaterThan(before.viewport.zoom));
    expect(f.controller.getSnapshot().active!.scene).toEqual(before.scene);
    expect(f.controller.getSnapshot().active!.document.editRevision).toBe(before.document.editRevision);
    await userEvent.click(within(nodeElement(refId)).getByRole("button", { name: "查看参考原图" }));
    expect(callbacks.onViewImage).toHaveBeenCalledWith(expect.objectContaining({ canvasId, nodeId: refId, kind: "reference" }));
    await userEvent.click(within(nodeElement(refId)).getByRole("button", { name: "下载参考原图" }));
    expect(callbacks.onDownloadImage).toHaveBeenCalledWith(expect.objectContaining({ canvasId, nodeId: refId }));
    fireEvent.change(screen.getByLabelText("选择画布"), { target: { value: other } });
    await waitFor(() => expect(f.controller.getSnapshot().activeCanvasId).toBe(other));
    expect(f.api.port.submit).toHaveBeenCalledTimes(1);
    expect(f.api.port.save).not.toHaveBeenCalled();
    expect(f.api.port.delete).not.toHaveBeenCalled();
  });

  it("renders readiness/disabled errors without constructing jobs or falling back to unrelated content", async () => {
    const f = fixture({ enabled: false });
    await f.controller.start();
    const callbacks = canvasStageCallbacks();
    render(<CanvasStage {...callbacks} snapshot={f.controller.getSnapshot()} controller={f.controller} channels={canvasStageChannels} />);
    expect(screen.getByText("画布暂未开放")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "返回对话" }));
    expect(callbacks.onReturnToChat).toHaveBeenCalledOnce();
    expect(f.api.port.create).not.toHaveBeenCalled();
    expect(f.api.port.submit).not.toHaveBeenCalled();
  });
});
