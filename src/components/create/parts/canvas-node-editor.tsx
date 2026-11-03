"use client";

import { Focus, Move, Trash2, X } from "lucide-react";
import type { CSSProperties } from "react";

import type { CanvasLocalNodeV1 } from "@/lib/canvas/contracts";
import { cn } from "@/lib/utils";

import { CANVAS_INPUT_CLASS, CANVAS_NODE_LABELS } from "../canvas/renderer-constants";
import { CanvasNodeInspector, type CanvasNodeInspectorProps } from "./canvas-node-inspector";
import { CanvasGenerationComposer } from "./canvas-generation-composer";
import type { CanvasController } from "../canvas/controller";
import { CanvasPromptField } from "./canvas-prompt-field";
import { CanvasGenerationActions, CanvasGenerationContent } from "./canvas-nodes/generation-node";
import { CanvasReferenceContent } from "./canvas-nodes/reference-node";
import { CanvasResultContent } from "./canvas-nodes/result-node";
import styles from "./canvas-stage.module.css";

type CanvasNodeEditorProps = Omit<CanvasNodeInspectorProps, "node"> & {
  node: CanvasLocalNodeV1;
  readOnly?: boolean;
  onClose: () => void;
  onMove: () => void;
  onLocate: () => void;
  controller?: CanvasController;
  placement?: CSSProperties;
  onCaptureImport?: () => (files: File[]) => void;
  onReplaceSource?: (edgeId: string, source: string, expectedSource: string) => boolean;
};

export function CanvasNodeEditor({ node, readOnly = false, onClose, onMove, onLocate, controller, placement, onCaptureImport, onReplaceSource, ...props }: CanvasNodeEditorProps) {
  const { active, target, actions, editor } = props;
  const data = { canvasId: target.canvasId, readOnly, actions };
  const generation = node.kind === "generation" ? { ...data, node,
    referenceCount: active.scene.edges.filter((edge) => edge.target === node.id && edge.kind === "image-input").length,
    hasPrompt: active.scene.edges.some((edge) => edge.target === node.id && edge.kind === "prompt-input"),
    run: active.runs.filter((run) => run.nodeId === node.id).at(-1) ?? null,
  } : null;
  const pending = Object.keys(editor.readDraft(target)?.fields ?? {}).length;

  return <aside style={placement} className={cn(styles.nodeEditor, CANVAS_INPUT_CLASS)} aria-label={readOnly ? "节点查看面板" : "节点编辑面板"} onWheel={(event) => event.stopPropagation()}
    onPointerDown={(event) => event.stopPropagation()} onTouchStart={(event) => event.stopPropagation()}>
    <header className={styles.inspectorHeading}>
      <h3>{CANVAS_NODE_LABELS[node.kind]}节点 · {node.id.slice(-6)}</h3>
      <button type="button" className={styles.iconButton} aria-label={node.kind === "generation" ? "关闭节点设置" : "关闭节点编辑"} onClick={onClose}><X aria-hidden className="size-4" /></button>
    </header>
    <div className={styles.inspectorScroll}>
      <div className={styles.editorNavigation}>
        <button type="button" className={styles.smallButton} onClick={onLocate}><Focus aria-hidden className="size-4" />定位节点</button>
        {!readOnly && <button type="button" className={styles.smallButton} onClick={onMove}><Move aria-hidden className="size-4" />移动节点</button>}
        {!readOnly && <button type="button" className={styles.smallButton} aria-label="移除此节点" onClick={() => actions.removeNode(node.id)}><Trash2 aria-hidden className="size-4" />移除</button>}
      </div>
      {node.kind === "prompt" && <section className={styles.inspectorSection}><h4>描述你的画面</h4>{readOnly ? <p className={styles.promptText}>{node.text || "尚未填写提示词"}</p> : <><CanvasPromptField value={node.text} onChange={(text) => actions.updatePrompt(node.id, text)} /><p className={styles.helpText}>文字即时存入本地草稿。Enter 换行，不会运行节点。</p></>}</section>}
      {node.kind === "reference" && <CanvasReferenceContent data={{ ...data, node, reference: active.references[node.id] ?? null }} />}
      {node.kind === "result" && <CanvasResultContent data={{ ...data, node, image: active.images[node.imageId] ?? null }} />}
      {generation && node.kind === "generation" && <>
        {controller && onCaptureImport && onReplaceSource && <CanvasGenerationComposer {...props} controller={controller} node={node} readOnly={readOnly} onCaptureImport={onCaptureImport} onReplaceSource={onReplaceSource} />}
        <CanvasGenerationContent data={generation} hideActions />{!readOnly && <CanvasNodeInspector {...props} contextual={Boolean(controller)} node={node} />}
      </>}
      {pending > 0 && <p className={styles.pendingFields} role="status">{pending} 项参数尚未应用；关闭面板会保留输入，但刷新页面会丢失这些未应用参数。</p>}
    </div>
    <footer className={styles.editorFooter}>
      {generation && !readOnly ? <CanvasGenerationActions data={generation} hideSettings /> : <button type="button" className={styles.smallButton} onClick={onClose}>关闭编辑面板</button>}
      {!readOnly && pending > 0 && <button type="button" className={styles.smallButton} onClick={() => { editor.applyPending(target.canvasId, target.nodeId); }}>应用待定参数</button>}
    </footer>
  </aside>;
}
