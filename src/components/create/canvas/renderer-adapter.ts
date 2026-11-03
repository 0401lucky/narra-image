import type { Connection, NodeChange } from "@xyflow/react";

import type { CanvasLocalNodeV1, CanvasLocalSceneV1, CanvasPositionV1 } from "@/lib/canvas/contracts";

import type { CanvasActiveView } from "./controller-types";
import { CANVAS_DRAG_HANDLE, CANVAS_NODE_LABELS, CANVAS_PORTS } from "./renderer-constants";
import type { CanvasFlowEdge, CanvasFlowNode, CanvasNodeActions, CanvasNodeMeasurements } from "./renderer-types";

export { canvasInsertionPosition } from "./commands";

export type CanvasNodePresentation = { touch: boolean; capturedDrag?: boolean; editorNodeId?: string; preview?: { nodeId: string; position: CanvasPositionV1 } | null };

export function canvasFlowNodes(active: CanvasActiveView, readOnly: boolean, actions: CanvasNodeActions, measurements?: CanvasNodeMeasurements, presentation?: CanvasNodePresentation): CanvasFlowNode[] {
  const canvasId = active.document.id;
  return active.scene.nodes.map((node): CanvasFlowNode => {
    const measured = measurements?.get(node.id);
    const base = {
      id: node.id,
      position: { ...(presentation?.preview?.nodeId === node.id ? presentation.preview.position : node.position) },
      ...(measured ? { measured: { ...measured } } : {}),
      selected: node.id === active.selectedNodeId,
      draggable: !readOnly && !presentation?.touch && !presentation?.capturedDrag,
      connectable: !readOnly && !presentation?.touch,
      deletable: !readOnly,
      selectable: true,
      focusable: true,
      dragHandle: `.${CANVAS_DRAG_HANDLE}`,
      ariaLabel: `${CANVAS_NODE_LABELS[node.kind]}节点`,
    };
    const data = { canvasId, readOnly, actions, previewOnly: presentation?.touch ?? false, editorOpen: presentation?.editorNodeId === node.id };
    switch (node.kind) {
      case "prompt": return { ...base, type: "prompt", data: { ...data, node } };
      case "reference": return { ...base, type: "reference", data: { ...data, node, reference: active.references[node.id] ?? null } };
      case "generation": return { ...base, type: "generation", data: { ...data, node,
        referenceCount: active.scene.edges.filter((edge) => edge.kind === "image-input" && edge.target === node.id).length,
        hasPrompt: active.scene.edges.some((edge) => edge.kind === "prompt-input" && edge.target === node.id),
        run: active.runs.filter((run) => run.nodeId === node.id).at(-1) ?? null,
      } };
      case "result": return { ...base, type: "result", data: { ...data, node, image: active.images[node.imageId] ?? null } };
    }
  });
}

export function canvasNodeLabel(node: CanvasLocalNodeV1): string {
  switch (node.kind) {
    case "prompt": return node.text.trim() ? `提示词 · ${node.text.slice(0, 24)}` : "未填写的提示词";
    case "reference": return `参考图 · ${node.id.slice(-6)}`;
    case "result": return `结果图 · ${node.imageId.slice(-6)}`;
    case "generation": return `生成 · ${node.parameters.model}`;
  }
}

export function canvasSourceStatus(active: CanvasActiveView, node: CanvasLocalNodeV1): string {
  if (node.kind === "reference") {
    const reference = active.references[node.id];
    return reference?.state === "ready" ? "原图已就绪" : reference?.state === "local" ? "本地原图可用" : reference?.state === "uploading" ? "上传中" : "原图不可用";
  }
  if (node.kind === "result") { const image = active.images[node.imageId]; return image?.id === node.imageId && image.jobId === node.jobId && image.url ? "结果已就绪" : "结果不可用"; }
  if (node.kind === "prompt") return node.text.trim().length >= 2 ? "已填写" : "待填写提示词";
  return "生成节点";
}

export function updateCanvasNodeMeasurements(current: CanvasNodeMeasurements, liveNodeIds: ReadonlySet<string>, changes: readonly NodeChange<CanvasFlowNode>[] = []): CanvasNodeMeasurements {
  const next = new Map([...current].filter(([id]) => liveNodeIds.has(id)));
  let changed = next.size !== current.size;
  for (const change of changes) {
    if (change.type === "remove") { changed = next.delete(change.id) || changed; continue; }
    if (change.type !== "dimensions" || !liveNodeIds.has(change.id) || !change.dimensions) continue;
    const { width, height } = change.dimensions;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) continue;
    const previous = next.get(change.id);
    if (previous?.width === width && previous.height === height) continue;
    next.set(change.id, { width, height });
    changed = true;
  }
  return changed ? next : current;
}

export function canvasFlowEdges(scene: CanvasLocalSceneV1, readOnly: boolean, selectedEdgeId: string | null, selectedNodeId?: string | null): CanvasFlowEdge[] {
  return scene.edges.map((edge) => {
    const input = edge.kind !== "output-provenance";
    const handles = edge.kind === "prompt-input"
      ? { sourceHandle: CANVAS_PORTS.promptOutput, targetHandle: CANVAS_PORTS.promptInput }
      : edge.kind === "image-input"
        ? { sourceHandle: CANVAS_PORTS.imageOutput, targetHandle: CANVAS_PORTS.imageInput }
        : { sourceHandle: CANVAS_PORTS.provenanceOutput, targetHandle: CANVAS_PORTS.provenanceInput };
    return { id: edge.id, source: edge.source, target: edge.target, ...handles,
      type: "smoothstep", data: { edge }, selected: edge.id === selectedEdgeId,
      deletable: !readOnly && input, selectable: !readOnly && input, focusable: !readOnly && input, reconnectable: false,
      className: `canvas-edge-${edge.kind}`,
      style: { opacity: edge.id === selectedEdgeId || edge.source === selectedNodeId || edge.target === selectedNodeId ? 1 : 0.28 },
      label: edge.kind === "image-input" ? `参考 ${edge.ordinal}` : edge.kind === "prompt-input" ? "提示词" : "生成结果",
      ariaLabel: edge.kind === "image-input" ? `参考图输入 ${edge.ordinal}` : edge.kind === "prompt-input" ? "提示词输入" : "生成结果来源",
    };
  });
}

// Ports are a renderer concern. Duplicates, ownership, readiness, ordering and
// capacity remain exclusively in the shared graph/controller commands.
export function isCanvasPortConnection(scene: CanvasLocalSceneV1, connection: Connection): boolean {
  const source = scene.nodes.find((node) => node.id === connection.source);
  const target = scene.nodes.find((node) => node.id === connection.target);
  if (!source || target?.kind !== "generation" || source.id === target.id) return false;
  if (source.kind === "prompt") return connection.sourceHandle === CANVAS_PORTS.promptOutput && connection.targetHandle === CANVAS_PORTS.promptInput;
  return (source.kind === "reference" || source.kind === "result")
    && connection.sourceHandle === CANVAS_PORTS.imageOutput && connection.targetHandle === CANVAS_PORTS.imageInput;
}

export type CanvasNodeViewChange =
  | { kind: "select"; nodeId: string | null }
  | { kind: "move"; nodeId: string; position: { x: number; y: number } }
  | { kind: "remove"; nodeId: string };

export function canvasNodeViewChanges(changes: NodeChange<CanvasFlowNode>[], selectedNodeId: string | null, readOnly: boolean): CanvasNodeViewChange[] {
  const commands: CanvasNodeViewChange[] = [];
  const selection = changes.findLast((change) => change.type === "select" && change.selected);
  if (selection?.type === "select") commands.push({ kind: "select", nodeId: selection.id });
  else if (changes.some((change) => change.type === "select" && !change.selected && change.id === selectedNodeId)) commands.push({ kind: "select", nodeId: null });
  if (readOnly) return commands;
  for (const change of changes) {
    if (change.type === "position" && change.position) commands.push({ kind: "move", nodeId: change.id, position: { ...change.position } });
    else if (change.type === "remove") commands.push({ kind: "remove", nodeId: change.id });
  }
  return commands;
}

export function isCanvasTextControl(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("input, textarea, select, [contenteditable=true]"));
}

export function isCanvasSaveShortcut(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey">): boolean {
  return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s";
}
