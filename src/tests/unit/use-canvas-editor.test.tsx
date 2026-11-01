import { act, cleanup, renderHook } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { CanvasController } from "@/components/create/canvas/controller";
import { CANVAS_PARAMETER_LABELS, type CanvasEditorTarget } from "@/components/create/canvas/editor-state";
import { useCanvasEditor } from "@/components/create/hooks/use-canvas-editor";

import { canvasControllerFixture } from "./helpers/canvas-controller-fixtures";

const controllers: CanvasController[] = [];
function fixture() { const f = canvasControllerFixture(); controllers.push(f.controller); return f; }
function useEditor(controller: CanvasController) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  return useCanvasEditor(snapshot, controller);
}
afterEach(() => { cleanup(); controllers.splice(0).forEach((controller) => controller.dispose()); });

describe("mounted nonsecret canvas field registry", () => {
  it("keeps raw node/custom-size fields on close, Move, other-canvas selection and return without persisting them", async () => {
    const f = fixture();
    const first = await f.newGraph();
    const target: CanvasEditorTarget = { ownerId: "owner-one", canvasId: first.canvasId, nodeId: first.nodeId };
    const { result } = renderHook(() => useEditor(f.controller));
    act(() => {
      result.current.open(target);
      result.current.setCustomSize(target, true);
      result.current.setField(target, "size", "1536x", "auto");
      result.current.setField(target, "seed", "-", "");
      result.current.close();
      result.current.open(target, "move");
      result.current.close();
    });
    await act(() => f.controller.newCanvas("other canvas"));
    expect(result.current.readDraft(target)?.fields.seed?.text).toBe("-");
    await act(() => f.controller.selectCanvas(first.canvasId));
    expect(result.current.readDraft(target)).toMatchObject({ customSize: true, fields: { size: { text: "1536x" }, seed: { text: "-" } } });
    await act(() => f.controller.flushLocal(first.canvasId));
    const persisted = JSON.stringify(f.store.row("owner-one", first.canvasId)?.envelope);
    expect(persisted).not.toContain("1536x");
    expect(persisted).not.toContain("customSize");
    expect(f.api.port.save).not.toHaveBeenCalled();
    expect(f.api.port.submit).not.toHaveBeenCalled();
    expect(Object.keys(CANVAS_PARAMETER_LABELS)).toEqual(["model", "size", "outputCompression", "negativePrompt", "seed"]);
  });

  it("validates every node before applying any pending canvas fields, then normalizes using the existing schema", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    const otherNode = f.controller.addGeneration(canvasId, { x: 400, y: 0 });
    const target = { ownerId: "owner-one", canvasId, nodeId };
    const other = { ...target, nodeId: otherNode };
    const { result } = renderHook(() => useEditor(f.controller));
    act(() => {
      result.current.setField(target, "size", "1536x1024", "auto");
      result.current.setField(other, "seed", "1e", "");
    });
    const before = f.controller.getSnapshot().active!.scene;
    act(() => expect(result.current.applyPending(canvasId)).toMatchObject({ ok: false, target: other, field: "seed" }));
    expect(f.controller.getSnapshot().active!.scene).toEqual(before);
    expect(result.current.state.intent).toEqual({ mode: "edit", target: other });
    expect(result.current.readDraft(other)?.fields.seed?.invalid).toBe(true);
    act(() => {
      result.current.setField(other, "seed", "12", "");
      expect(result.current.applyPending(canvasId)).toEqual({ ok: true });
    });
    expect(result.current.pendingCount(canvasId)).toBe(0);
    expect(f.controller.getSnapshot().active!.scene.nodes.find((node) => node.id === nodeId)).toMatchObject({ parameters: { size: "1536x1024" } });
    expect(f.controller.getSnapshot().active!.scene.nodes.find((node) => node.id === otherNode)).toMatchObject({ parameters: { seed: 12 } });
    expect(f.api.port.save).not.toHaveBeenCalled();
    expect(f.api.port.submit).not.toHaveBeenCalled();
  });

  it("prunes only the deleted node, and changes the registry owner rather than lending another account a draft", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    const otherNode = f.controller.addGeneration(canvasId, { x: 400, y: 0 });
    const target = { ownerId: "owner-one", canvasId, nodeId };
    const other = { ...target, nodeId: otherNode };
    const { result, rerender } = renderHook(({ controller }) => useEditor(controller), { initialProps: { controller: f.controller } });
    act(() => { result.current.setField(target, "seed", "-", ""); result.current.setField(other, "model", "unfinished model", "old"); });
    act(() => f.controller.removeNode(canvasId, nodeId));
    expect(result.current.readDraft(target)).toBeUndefined();
    expect(result.current.readDraft(other)?.fields.model?.text).toBe("unfinished model");
    const second = canvasControllerFixture({ ownerId: "owner-two" }); controllers.push(second.controller);
    await second.controller.start();
    rerender({ controller: second.controller });
    expect(result.current.state.drafts.size).toBe(0);
    expect(result.current.readDraft(other)).toBeUndefined();
  });

  it("rejects raw edits while the actual controller is read-only, not because of a layout classification", async () => {
    const f = fixture();
    const { canvasId, nodeId } = await f.newGraph();
    const target = { ownerId: "owner-one", canvasId, nodeId };
    const { result } = renderHook(() => useEditor(f.controller));
    act(() => f.controller.setReadOnly(true));
    act(() => { result.current.open(target, "move"); result.current.setField(target, "seed", "-", ""); });
    expect(result.current.state.intent).toBeNull();
    expect(result.current.state.drafts.size).toBe(0);
    act(() => f.controller.setReadOnly(false));
    act(() => result.current.setField(target, "seed", "-", ""));
    expect(result.current.readDraft(target)?.fields.seed?.text).toBe("-");
  });
});
