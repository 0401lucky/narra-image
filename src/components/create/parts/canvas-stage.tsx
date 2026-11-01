"use client";

import { Background, BackgroundVariant, ReactFlow, ReactFlowProvider, useReactFlow, type NodeTypes } from "@xyflow/react";
import { ArrowLeft, Check, Layers3, LoaderCircle, Move, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { CanvasContractError, type CanvasPositionV1 } from "@/lib/canvas/contracts";
import { cn } from "@/lib/utils";

import type { CanvasController } from "../canvas/controller";
import { canvasControllerErrorMessage, type CanvasActiveView } from "../canvas/controller-types";
import type { CanvasEditorPort, CanvasEditorTarget } from "../canvas/editor-state";
import { beginCanvasMove, finishCanvasMove, previewCanvasMove, type CanvasMoveGesture } from "../canvas/mobile-interaction";
import { canvasFlowEdges, canvasFlowNodes, canvasInsertionPosition, canvasNodeViewChanges, isCanvasPortConnection, isCanvasSaveShortcut, isCanvasTextControl, updateCanvasNodeMeasurements } from "../canvas/renderer-adapter";
import { CANVAS_ARIA_LABELS, CANVAS_CAMERA, CANVAS_CARD_SPACING } from "../canvas/renderer-constants";
import type { CanvasFlowEdge, CanvasFlowNode, CanvasNodeActions, CanvasNodeMeasurements, CanvasStageProps } from "../canvas/renderer-types";
import { useCanvasEditor } from "../hooks/use-canvas-editor";
import { useCanvasMobileViewport } from "../hooks/use-canvas-mobile-viewport";
import { CanvasDialog, type CanvasDialogIntent } from "./canvas-dialog";
import { CanvasNodeEditor } from "./canvas-node-editor";
import { CanvasNodePicker } from "./canvas-node-picker";
import { CanvasGenerationNode } from "./canvas-nodes/generation-node";
import { CanvasPromptNode } from "./canvas-nodes/prompt-node";
import { CanvasReferenceNode } from "./canvas-nodes/reference-node";
import { CanvasResultNode } from "./canvas-nodes/result-node";
import { CanvasSidebar } from "./canvas-sidebar";
import { CanvasToolbar } from "./canvas-toolbar";

import "@xyflow/react/dist/style.css";
import styles from "./canvas-stage.module.css";

export type { CanvasStageProps, CanvasImageTarget, CanvasNodeTarget } from "../canvas/renderer-types";

const NODE_TYPES = { prompt: CanvasPromptNode, reference: CanvasReferenceNode, generation: CanvasGenerationNode, result: CanvasResultNode } satisfies NodeTypes;
type Command = () => unknown;
type CanvasErrorView = { ownerId: string; canvasId: string | null; message: string };
type CanvasEditorProps = CanvasStageProps & {
  controller: CanvasController;
  editor: CanvasEditorPort;
  active: CanvasActiveView;
  layoutIdentity: string;
  report: (error: unknown, canvasId: string | null) => void;
  execute: (canvasId: string, command: Command) => boolean;
  invoke: (canvasId: string | null, command: Command) => Promise<boolean>;
  onDialog: (intent: CanvasDialogIntent) => void;
};

function CanvasEditor({ snapshot, active, controller, editor, touchPresentation = false, layoutIdentity, channels, onViewImage, onDownloadImage, onOpenProviderSettings, report, execute, invoke, onDialog }: CanvasEditorProps) {
  const canvasId = active.document.id;
  const readOnly = snapshot.readOnly;
  const editable = snapshot.enabled && snapshot.ready && !readOnly && active.document.loaded && !active.document.deleting;
  const viewportElement = useRef<HTMLDivElement>(null);
  const clickConnectionAttempted = useRef(false);
  const flow = useReactFlow<CanvasFlowNode, CanvasFlowEdge>();
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const observedSelection = useRef<string | null | undefined>(undefined);
  const gesture = useRef<CanvasMoveGesture | null>(null);
  const pointers = useRef(new Set<number>());
  const suppressClick = useRef(false);
  const [movePreview, setMovePreview] = useState<CanvasMoveGesture | null>(null);
  const [measurements, setMeasurements] = useState<CanvasNodeMeasurements>(() => new Map());
  const liveNodeIds = useMemo(() => new Set(active.scene.nodes.map((node) => node.id)), [active.scene.nodes]);
  const liveMeasurements = updateCanvasNodeMeasurements(measurements, liveNodeIds);
  if (liveMeasurements !== measurements) setMeasurements(liveMeasurements);
  const reportError = useCallback((error: unknown) => report(error, canvasId), [canvasId, report]);
  const acquirePreview = useCallback((nodeId: string) => controller.acquirePreview(canvasId, nodeId), [canvasId, controller]);
  const { applyPending, open: openEditor, close: closeEditor } = editor;
  const editorIntent = editor.state.intent?.target.canvasId === canvasId && editor.state.intent.target.ownerId === snapshot.ownerId ? editor.state.intent : null;
  const moveMode = editable && editorIntent?.mode === "move";
  const previewOnly = touchPresentation || moveMode;
  const editorNode = snapshot.ready && editorIntent?.mode === "edit" ? active.scene.nodes.find((node) => node.id === editorIntent.target.nodeId) : null;
  const targetFor = useCallback((nodeId: string): CanvasEditorTarget => ({ ownerId: snapshot.ownerId, canvasId, nodeId }), [snapshot.ownerId, canvasId]);
  const applyFields = useCallback((nodeId?: string) => {
    const result = applyPending(canvasId, nodeId);
    if (!result.ok) {
      if (result.target) execute(canvasId, () => controller.selectNode(canvasId, result.target!.nodeId));
      if (result.error) reportError(result.error);
    }
    return result.ok;
  }, [applyPending, canvasId, controller, execute, reportError]);
  const cancelMove = useCallback(() => {
    const pointerId = gesture.current?.pointerId;
    gesture.current = null;
    setMovePreview(null);
    if (pointerId !== undefined && viewportElement.current?.hasPointerCapture?.(pointerId)) viewportElement.current.releasePointerCapture(pointerId);
  }, []);
  useEffect(() => {
    // Only an unfinished preview is cancelled. Completed drops already belong to the controller.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cancelMove();
  }, [cancelMove, layoutIdentity, touchPresentation, moveMode, editorIntent?.target.nodeId, active.viewport.x, active.viewport.y, active.viewport.zoom, editable]);
  useEffect(() => {
    const element = viewportElement.current;
    const interrupt = () => { pointers.current.clear(); cancelMove(); };
    const secondPointer = (event: PointerEvent) => { if (gesture.current && gesture.current.pointerId !== event.pointerId) cancelMove(); };
    const endPointer = (event: PointerEvent) => {
      // Browse pointers are not captured and may finish outside the viewport.
      pointers.current.delete(event.pointerId);
      if (gesture.current?.pointerId === event.pointerId) cancelMove();
    };
    const hidden = () => { if (document.hidden) interrupt(); };
    window.addEventListener("blur", interrupt);
    window.addEventListener("pointerup", endPointer);
    window.addEventListener("pointercancel", endPointer);
    document.addEventListener("pointerdown", secondPointer, true);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("blur", interrupt);
      window.removeEventListener("pointerup", endPointer);
      window.removeEventListener("pointercancel", endPointer);
      document.removeEventListener("pointerdown", secondPointer, true);
      document.removeEventListener("visibilitychange", hidden);
      const pointerId = gesture.current?.pointerId;
      gesture.current = null;
      if (pointerId !== undefined && element?.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId);
    };
  }, [cancelMove]);
  const selectNode = (nodeId: string | null) => {
    if (nodeId !== active.selectedNodeId) { cancelMove(); closeEditor(); }
    execute(canvasId, () => controller.selectNode(canvasId, nodeId));
    setSelectedEdgeId(null);
  };
  useEffect(() => {
    if (observedSelection.current === active.selectedNodeId) return;
    observedSelection.current = active.selectedNodeId;
    if (!touchPresentation && editable && active.scene.nodes.some((node) => node.id === active.selectedNodeId && node.kind === "generation")) openEditor(targetFor(active.selectedNodeId!));
  }, [active.selectedNodeId, active.scene.nodes, editable, openEditor, targetFor, touchPresentation]);
  const actions = useMemo<CanvasNodeActions>(() => ({
    updatePrompt: (nodeId, text) => editable && execute(canvasId, () => controller.updatePrompt(canvasId, nodeId, text)),
    replaceReference: (nodeId, file) => { if (editable) execute(canvasId, () => controller.replaceReference(canvasId, nodeId, file)); },
    acquirePreview,
    removeNode: (nodeId) => {
      if (!editable) return;
      if (touchPresentation) onDialog({ kind: "node-delete", canvasId, nodeId, title: "此节点" });
      else execute(canvasId, () => controller.removeNode(canvasId, nodeId));
    },
    inspectNode: (nodeId) => { execute(canvasId, () => controller.selectNode(canvasId, nodeId)); openEditor(targetFor(nodeId)); },
    runNode: (nodeId) => { if (editable && applyFields(nodeId)) void invoke(canvasId, () => controller.runNode(canvasId, nodeId)); },
    retryTransport: (runId) => { if (editable) void invoke(canvasId, () => controller.retryTransport(canvasId, runId)); },
    recoverRuns: () => { void invoke(canvasId, () => controller.recoverRuns(canvasId)); },
    refreshRuntime: () => { void invoke(canvasId, () => controller.refreshRuntime(canvasId)); },
    viewImage: onViewImage,
    downloadImage: onDownloadImage,
    reportError,
  }), [acquirePreview, applyFields, canvasId, controller, editable, execute, invoke, onDialog, onDownloadImage, onViewImage, openEditor, reportError, targetFor, touchPresentation]);
  const nodes = useMemo(() => canvasFlowNodes(active, !editable, actions, liveMeasurements, { touch: previewOnly, editorNodeId: editorNode?.id,
    preview: movePreview ? { nodeId: movePreview.target.nodeId, position: movePreview.position } : null }), [active, editable, actions, liveMeasurements, previewOnly, editorNode?.id, movePreview]);
  const edges = useMemo(() => canvasFlowEdges(active.scene, !editable || previewOnly, selectedEdgeId), [active.scene, editable, previewOnly, selectedEdgeId]);
  const selectedNode = active.scene.nodes.find((node) => node.id === active.selectedNodeId);
  const locate = (nodeId: string) => { void invoke(canvasId, () => flow.fitView({ nodes: [{ id: nodeId }], padding: 0.3, minZoom: 0.6, maxZoom: 1 })); };
  const enterMove = (nodeId: string) => { cancelMove(); openEditor(targetFor(nodeId), "move"); locate(nodeId); };

  const newPosition = (kind: "prompt" | "reference" | "generation"): CanvasPositionV1 => {
    const bounds = viewportElement.current?.getBoundingClientRect();
    const start = flow.screenToFlowPosition({ x: (bounds?.left ?? 0) + 50, y: (bounds?.top ?? 0) + 55 });
    const prompt = active.scene.nodes.findLast((node) => node.kind === "prompt");
    const preferred = kind === "generation" ? { x: (prompt?.position.x ?? start.x) + CANVAS_CARD_SPACING.column, y: prompt?.position.y ?? start.y }
      : kind === "reference" && prompt ? { x: prompt.position.x, y: prompt.position.y + CANVAS_CARD_SPACING.height } : start;
    return canvasInsertionPosition(active.scene.nodes.map((node) => node.position), preferred);
  };
  const importFiles = (files: File[], position = newPosition("reference")) => {
    if (!editable) return;
    const occupied = active.scene.nodes.map((node) => node.position);
    for (const file of files) {
      const next = canvasInsertionPosition(occupied, position);
      if (!execute(canvasId, () => { const nodeId = controller.importReference(canvasId, file, next); controller.selectNode(canvasId, nodeId); })) break;
      occupied.push(next);
    }
  };
  const save = () => { if (editable && applyFields()) void invoke(canvasId, () => controller.saveCanvas(canvasId)); };
  const addPrompt = () => { if (editable) execute(canvasId, () => { const nodeId = controller.addPrompt(canvasId, newPosition("prompt")); controller.selectNode(canvasId, nodeId); }); };
  const connect = (sourceId: string, targetId: string) => editable && execute(canvasId, () => controller.connect(canvasId, sourceId, targetId));

  return (
    <div className={styles.editor} onKeyDownCapture={(event) => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (!editable && isCanvasSaveShortcut(event)) { event.preventDefault(); event.stopPropagation(); }
      else if (!editable && !isCanvasTextControl(event.target) && (["Delete", "Backspace"].includes(event.key) || (modifier && ["n", "v", "x", "z", "y"].includes(event.key.toLowerCase())))) { event.preventDefault(); event.stopPropagation(); }
    }} onKeyDown={(event) => {
      if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229 || !isCanvasSaveShortcut(event)) return;
      // Bubble after a focused inspector field has committed or rejected its draft.
      event.preventDefault(); event.stopPropagation(); save();
    }}>
      <CanvasToolbar document={active.document} readOnly={readOnly} zoom={active.viewport.zoom}
        pendingFields={editor.pendingCount(canvasId)}
        onRename={() => onDialog({ kind: "rename", canvasId, title: active.document.title })}
        onDelete={() => onDialog({ kind: "delete", canvasId, title: active.document.title })}
        onSave={save} onAddPrompt={addPrompt}
        onAddGeneration={() => { if (editable) execute(canvasId, () => { const nodeId = controller.addGeneration(canvasId, newPosition("generation")); controller.selectNode(canvasId, nodeId); }); }}
        onImport={importFiles}
        onFit={() => { void invoke(canvasId, () => flow.fitView({ padding: CANVAS_CAMERA.fitPadding, minZoom: CANVAS_CAMERA.minZoom, maxZoom: 1 })); }}
        onZoomIn={() => { void invoke(canvasId, () => flow.zoomIn()); }} onZoomOut={() => { void invoke(canvasId, () => flow.zoomOut()); }} />
      <div className={styles.selectionTools}>
        <CanvasNodePicker active={active} onSelect={selectNode} onLocate={locate} />
        {editable && selectedNode && <div className={styles.selectedActions}>
          {moveMode ? <><span role="status">移动模式 · 拖动整张卡片</span><button type="button" className={styles.smallButton} aria-label="完成移动" onClick={() => { cancelMove(); closeEditor(); }}><Check aria-hidden className="size-4" />完成移动</button></>
            : <><button type="button" className={styles.smallButton} aria-label="编辑所选节点" onClick={() => openEditor(targetFor(selectedNode.id))}><Pencil aria-hidden className="size-4" />编辑</button>
              <button type="button" className={styles.smallButton} aria-label="移动所选节点" onClick={() => enterMove(selectedNode.id)}><Move aria-hidden className="size-4" />移动</button>
              {touchPresentation && <button type="button" className={styles.iconButton} aria-label="移除所选节点" onClick={() => actions.removeNode(selectedNode.id)}><Trash2 aria-hidden className="size-4" /></button>}</>}
        </div>}
        {!editable && snapshot.ready && selectedNode && <button type="button" className={styles.smallButton} onClick={() => openEditor(targetFor(selectedNode.id))}>查看所选节点</button>}
      </div>
      <div className={styles.workspace}>
        <div ref={viewportElement} className={styles.viewport} data-testid="canvas-viewport"
          data-interaction-mode={moveMode ? "move" : "browse"}
          onPointerDownCapture={(event) => {
            pointers.current.add(event.pointerId);
            if (pointers.current.size > 1) { suppressClick.current = true; cancelMove(); return; }
            const nodeId = event.target instanceof Element ? event.target.closest(".react-flow__node")?.getAttribute("data-id") : null;
            if (!moveMode || !editable || nodeId !== editorIntent?.target.nodeId || (event.target instanceof Element && event.target.closest("button, input, textarea, select, a"))) return;
            const node = active.scene.nodes.find((item) => item.id === nodeId);
            if (!node) return;
            const next = beginCanvasMove(targetFor(node.id), event.pointerId, { x: event.clientX, y: event.clientY }, node.position, active.viewport);
            if (!next) return;
            gesture.current = next; setMovePreview(next);
            viewportElement.current?.setPointerCapture?.(event.pointerId);
            event.preventDefault(); event.stopPropagation();
          }}
          onPointerMoveCapture={(event) => {
            if (!gesture.current || event.pointerId !== gesture.current.pointerId) return;
            const next = previewCanvasMove(gesture.current, event.pointerId, { x: event.clientX, y: event.clientY });
            if (!next) { cancelMove(); return; }
            gesture.current = next; setMovePreview(next); suppressClick.current = true;
            event.preventDefault(); event.stopPropagation();
          }}
          onPointerUpCapture={(event) => {
            const preview = gesture.current;
            if (preview?.pointerId === event.pointerId) {
              const view = controller.getSnapshot();
              const intent = editor.getSnapshot().intent;
              const node = view.active?.scene.nodes.find((item) => item.id === preview.target.nodeId);
              const position = view.ownerId === preview.target.ownerId && view.enabled && view.ready && !view.readOnly && !view.active?.document.deleting
                && view.active?.document.id === preview.target.canvasId && node && intent?.mode === "move"
                ? finishCanvasMove(preview, { target: intent.target, position: node.position, viewport: view.active.viewport, pointerId: event.pointerId, pointerCount: pointers.current.size }) : null;
              cancelMove(); suppressClick.current = true;
              if (position) execute(canvasId, () => controller.moveNode(canvasId, preview.target.nodeId, position));
              event.preventDefault(); event.stopPropagation();
            }
            pointers.current.delete(event.pointerId);
          }}
          onPointerCancelCapture={(event) => { pointers.current.delete(event.pointerId); suppressClick.current = true; cancelMove(); }}
          onLostPointerCapture={(event) => { if (gesture.current?.pointerId === event.pointerId) cancelMove(); }}
          onMouseDownCapture={(event) => { if (gesture.current) event.stopPropagation(); }}
          onTouchStartCapture={(event) => { if (event.touches.length > 1) { cancelMove(); } else if (gesture.current) event.stopPropagation(); }}
          onClickCapture={(event) => { if (suppressClick.current) { suppressClick.current = false; event.preventDefault(); event.stopPropagation(); } }}
          onKeyDownCapture={(event) => {
            if (!editable || event.nativeEvent.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey
              || !["Delete", "Backspace"].includes(event.key) || isCanvasTextControl(event.target)
              || (event.target instanceof Element && event.target.closest(".nokey, button, a"))) return;
            event.preventDefault(); event.stopPropagation();
            // React Flow's default Delete listener is document-global. Only a
            // focused viewport may request removal through the controller adapter.
            if (touchPresentation && active.selectedNodeId) actions.removeNode(active.selectedNodeId);
            else void invoke(canvasId, () => flow.deleteElements({ nodes: nodes.filter((node) => node.selected), edges: edges.filter((edge) => edge.selected) }));
          }}
          onDragOver={(event) => { if (Array.from(event.dataTransfer.types).includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = editable ? "copy" : "none"; } }}
          onDrop={(event) => {
            const files = Array.from(event.dataTransfer.files);
            if (!files.length && isCanvasTextControl(event.target)) return;
            event.preventDefault(); event.stopPropagation();
            if (editable && files.length) importFiles(files, flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
          }}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files);
            if (files.length || !editable) { event.preventDefault(); event.stopPropagation(); }
            if (editable && files.length) importFiles(files);
          }}>
          <ReactFlow<CanvasFlowNode, CanvasFlowEdge> className={styles.flow} aria-label="节点画布" nodes={nodes} edges={edges} nodeTypes={NODE_TYPES}
            viewport={active.viewport} onViewportChange={(viewport) => { execute(canvasId, () => controller.setViewport(canvasId, viewport)); }}
            onNodesChange={(changes) => {
              // Controlled Flow nodes must retain measured dimensions across
              // snapshots. This cache belongs only to the mounted canvas renderer.
              setMeasurements((current) => updateCanvasNodeMeasurements(current, liveNodeIds, changes));
              for (const change of canvasNodeViewChanges(changes, active.selectedNodeId, !editable || previewOnly)) {
                if (change.kind === "select") selectNode(change.nodeId);
                else if (change.kind === "move") execute(canvasId, () => controller.moveNode(canvasId, change.nodeId, change.position));
                else execute(canvasId, () => controller.removeNode(canvasId, change.nodeId));
              }
            }}
            onEdgesChange={(changes) => {
              if (!editable) return;
              for (const change of changes) {
                if (change.type === "select") setSelectedEdgeId((current) => change.selected ? change.id : current === change.id ? null : current);
                else if (change.type === "remove" && active.scene.edges.some((edge) => edge.id === change.id && edge.kind !== "output-provenance")) execute(canvasId, () => controller.disconnect(canvasId, change.id));
              }
            }}
            onNodeClick={(_, node) => selectNode(node.id)}
            onPaneClick={() => selectNode(null)}
            onConnect={(connection) => {
              clickConnectionAttempted.current = true;
              if (!editable) return;
              if (!isCanvasPortConnection(active.scene, connection)) { reportError(new CanvasContractError("CANVAS_INVALID_CONNECTION")); return; }
              connect(connection.source, connection.target);
            }}
            isValidConnection={(connection) => editable && isCanvasPortConnection(active.scene, { source: connection.source, target: connection.target, sourceHandle: connection.sourceHandle ?? null, targetHandle: connection.targetHandle ?? null })}
            onConnectEnd={(_, state) => { if (editable && !state.isValid && state.toNode) reportError(new CanvasContractError("CANVAS_INVALID_CONNECTION")); }}
            onClickConnectStart={() => { clickConnectionAttempted.current = false; }}
            onClickConnectEnd={(event) => {
              if (editable && !clickConnectionAttempted.current && event.target instanceof Element && event.target.closest(".react-flow__handle")) reportError(new CanvasContractError("CANVAS_INVALID_CONNECTION"));
            }}
            nodesDraggable={editable && !previewOnly} nodesConnectable={editable && !previewOnly} nodesFocusable elementsSelectable edgesFocusable={editable && !previewOnly} edgesReconnectable={false}
            deleteKeyCode={null} selectionKeyCode={null} multiSelectionKeyCode={null}
            connectOnClick={editable && !previewOnly} panOnDrag zoomOnPinch zoomOnScroll preventScrolling selectNodesOnDrag={!previewOnly}
            minZoom={CANVAS_CAMERA.minZoom} maxZoom={CANVAS_CAMERA.maxZoom} nodeDragThreshold={3}
            autoPanOnNodeDrag={editable && !previewOnly} autoPanOnConnect={editable && !previewOnly}
            ariaLabelConfig={readOnly || previewOnly ? { ...CANVAS_ARIA_LABELS, "node.a11yDescription.default": CANVAS_ARIA_LABELS["node.a11yDescription.keyboardDisabled"] } : CANVAS_ARIA_LABELS}>
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="rgba(113, 82, 58, 0.22)" />
          </ReactFlow>
          {active.scene.nodes.length === 0 && <div className={styles.emptyCanvas}>
            <div className={styles.emptyCanvasIcon}><Layers3 aria-hidden className="size-8" /></div>
            <p className={styles.emptyEyebrow}>一张空白，独立的灵感空间</p>
            <h3>把想法连成画面</h3>
            <p>{readOnly ? "此画布还没有节点。当前可浏览已有画布，暂时无法编辑。" : "添加提示词和生成节点，将它们连接后手动运行。参考图可选，画布不会导入其他对话或历史作品。"}</p>
            {!readOnly && <button type="button" className={styles.saveButton} onClick={addPrompt} disabled={!editable}><Plus aria-hidden className="size-4" />添加第一个提示词</button>}
          </div>}
          <div className={styles.viewportHint}>{moveMode ? "拖动所选整张卡片 · 双指或中断会取消未完成移动" : touchPresentation || readOnly ? "单指平移 · 双指缩放 · 选择节点后编辑或移动" : "拖动空白处平移 · 滚轮缩放 · 拖动卡片顶栏移动"}</div>
          {active.hydrating && <p className={styles.hydrating} role="status"><LoaderCircle aria-hidden className="size-3 animate-spin" />正在读取图片与任务</p>}
        </div>
        {editorNode && editorIntent && <CanvasNodeEditor key={editorNode.id} active={active} node={editorNode} readOnly={!editable} channels={channels} editor={editor} target={editorIntent.target} actions={actions}
          onClose={closeEditor} onMove={() => enterMove(editorNode.id)} onLocate={() => locate(editorNode.id)}
          onParameters={(patch) => editable && execute(canvasId, () => controller.updateParameters(canvasId, editorNode.id, patch))}
          onConnect={(sourceId) => connect(sourceId, editorNode.id)}
          onReplace={(edgeId, sourceId) => editable && execute(canvasId, () => controller.replaceConnection(canvasId, edgeId, sourceId))}
          onDisconnect={(edgeId) => { if (editable) execute(canvasId, () => controller.disconnect(canvasId, edgeId)); }}
          onReorder={(sourceIds) => { if (editable) execute(canvasId, () => controller.reorderInputs(canvasId, editorNode.id, sourceIds)); }}
          onOpenProviderSettings={() => { if (editable) onOpenProviderSettings({ canvasId, nodeId: editorNode.id }); }} />}
      </div>
    </div>
  );
}

function CanvasStageContent(props: CanvasStageProps & { editor: CanvasEditorPort }) {
  const { snapshot, controller, onReturnToChat } = props;
  const stageElement = useRef<HTMLElement>(null);
  const visible = useCanvasMobileViewport(stageElement);
  const [failure, setFailure] = useState<CanvasErrorView | null>(null);
  const [dialog, setDialog] = useState<CanvasDialogIntent | null>(null);
  const lifetime = useRef({ live: false });
  useEffect(() => { const scope = lifetime.current; scope.live = true; return () => { scope.live = false; }; }, []);
  const report = useCallback((error: unknown, canvasId: string | null) => {
    if (lifetime.current.live) setFailure({ ownerId: snapshot.ownerId, canvasId, message: canvasControllerErrorMessage(error) });
  }, [snapshot.ownerId]);
  const execute = useCallback((canvasId: string, command: Command): boolean => {
    try { command(); return true; } catch (error) { report(error, canvasId); return false; }
  }, [report]);
  const invoke = useCallback(async (canvasId: string | null, command: Command): Promise<boolean> => {
    if (lifetime.current.live) setFailure((current) => current?.ownerId === snapshot.ownerId && current.canvasId === canvasId ? null : current);
    try { await command(); return true; } catch (error) { report(error, canvasId); return false; }
  }, [report, snapshot.ownerId]);
  const active = snapshot.active;
  const activeError = failure?.ownerId === snapshot.ownerId && (failure.canvasId === null || failure.canvasId === snapshot.activeCanvasId) ? failure.message : null;
  const errors = [...new Set([snapshot.error, active?.document.error, activeError].filter((message): message is string => Boolean(message)))];
  const warnings = [...new Set([snapshot.warning, active?.document.warning].filter((message): message is string => Boolean(message)))];

  if (!snapshot.enabled) return <section className={styles.unavailable}><Layers3 aria-hidden className="size-8" /><h2>画布暂未开放</h2><button type="button" className={styles.smallButton} onClick={onReturnToChat}><ArrowLeft aria-hidden className="size-4" />返回对话</button></section>;

  return (
    <section ref={stageElement} aria-label="画布工作区" className={cn(styles.stage, props.touchPresentation && styles.touchStage, snapshot.readOnly && styles.readOnlyStage)} style={visible.style}
      data-short-viewport={visible.bounds ? visible.bounds.height < 360 : undefined}>
      <CanvasSidebar snapshot={snapshot}
        onNew={() => {
          if (!controller || snapshot.readOnly) return;
          const previousId = controller.getSnapshot().activeCanvasId;
          const creation = controller.newCanvas();
          // New publishes its local UUID before awaiting the account shell ACK.
          const createdId = controller.getSnapshot().activeCanvasId;
          void invoke(createdId !== previousId ? createdId : null, () => creation);
        }}
        onSelect={(canvasId) => { if (controller) void invoke(canvasId, () => controller.selectCanvas(canvasId)); }}
        onLoadMore={() => { if (controller) void invoke(null, () => controller.loadMore()); }} />
      <div className={styles.main}>
        {(errors.length > 0 || warnings.length > 0) && <div className={styles.alerts}>
          {errors.map((message) => <Alert key={message} onDismiss={message === activeError ? () => setFailure(null) : undefined}>{message}</Alert>)}
          {warnings.map((message) => <Alert key={message} variant="warning">{message}</Alert>)}
        </div>}
        {active && controller ? <>
          {!snapshot.readOnly && (active.document.cloudState === "conflict" || active.document.localState === "conflict") && <div className={styles.recoveryBar}><span>本地草稿已保留，不会自动覆盖账户版本。</span><button type="button" className={styles.smallButton} onClick={() => setDialog({ kind: "reload", canvasId: active.document.id, title: active.document.title })}>重新载入账户快照</button></div>}
          {!snapshot.readOnly && active.document.shell !== "registered" && <div className={styles.recoveryBar}><span>此画布的账户登记尚未确认，草稿仍保留在此浏览器。</span><button type="button" className={styles.smallButton} onClick={() => { void invoke(active.document.id, () => controller.registerCanvas(active.document.id)); }}>重试登记</button></div>}
          <ReactFlowProvider key={`${snapshot.ownerId}:${active.document.id}`}><CanvasEditor {...props} controller={controller} active={active} layoutIdentity={JSON.stringify(visible.bounds)} report={report} execute={execute} invoke={invoke} onDialog={setDialog} /></ReactFlowProvider>
        </> : <div className={styles.unavailable}>
          {!snapshot.ready || snapshot.loading ? <><LoaderCircle aria-hidden className="size-8 animate-spin" /><p role="status">正在读取画布…</p></> : <>
            <Layers3 aria-hidden className="size-8" /><h2>{snapshot.activeCanvasId ? "画布暂时无法读取" : "选择一张画布开始"}</h2>
            <p>{snapshot.readOnly ? "当前仅可浏览已有画布，暂时无法添加和生成。" : "每张画布拥有独立的节点与草稿，不会加入其他对话内容。"}</p>
            {snapshot.activeCanvasId && controller && <button type="button" className={styles.smallButton} onClick={() => { const canvasId = snapshot.activeCanvasId; if (canvasId) void invoke(canvasId, () => controller.selectCanvas(canvasId)); }}><RefreshCw aria-hidden className="size-4" />重试读取</button>}
            <button type="button" className={styles.smallButton} onClick={onReturnToChat}><ArrowLeft aria-hidden className="size-4" />返回对话</button>
          </>}
        </div>}
      </div>
      {dialog && controller && !snapshot.readOnly && <CanvasDialog key={`${dialog.kind}:${dialog.canvasId}:${dialog.kind === "node-delete" ? dialog.nodeId : ""}`} intent={dialog}
        error={failure?.canvasId === dialog.canvasId ? failure.message : null}
        onClose={() => setDialog((current) => current === dialog ? null : current)}
        onConfirm={(title) => invoke(dialog.canvasId, () => {
          if (dialog.kind === "rename") return controller.renameCanvas(dialog.canvasId, title);
          if (dialog.kind === "delete") return controller.deleteCanvas(dialog.canvasId, true);
          if (dialog.kind === "node-delete") { controller.removeNode(dialog.canvasId, dialog.nodeId); props.editor.discard(dialog.canvasId, dialog.nodeId); return; }
          return controller.reloadAccountCanvas(dialog.canvasId, true).then(() => props.editor.discard(dialog.canvasId));
        })} />}
    </section>
  );
}

function StandaloneCanvasStage(props: CanvasStageProps) {
  const editor = useCanvasEditor(props.snapshot, props.controller);
  return <CanvasStageContent {...props} editor={editor} />;
}

export function CanvasStage(props: CanvasStageProps) {
  // Studio supplies the long-lived port; standalone fixtures own one per stage.
  return props.editor ? <CanvasStageContent key={props.snapshot.ownerId} {...props} editor={props.editor} /> : <StandaloneCanvasStage key={props.snapshot.ownerId} {...props} />;
}
