"use client";

import { Check, Focus, Hand, ImagePlus, MousePointer2, Move, Network, Pencil, SlidersHorizontal, Sparkles, Trash2, Type, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { CANVAS_IMPORT_IMAGE_TYPES } from "@/lib/canvas/contracts";
import { cn } from "@/lib/utils";

import type { CanvasActiveView } from "../canvas/controller-types";
import type { CanvasTool, CanvasViewMode } from "../canvas/renderer-types";
import { CanvasNodePicker } from "./canvas-node-picker";
import styles from "./canvas-stage.module.css";

type CanvasDockProps = {
  active: CanvasActiveView;
  editable: boolean;
  touch: boolean;
  tool: CanvasTool;
  view: CanvasViewMode;
  moving: boolean;
  onTool: (tool: CanvasTool) => void;
  onView: (view: CanvasViewMode) => void;
  onCreate: () => void;
  onAddPrompt: () => void;
  onAddGeneration: () => void;
  onCaptureImport: () => (files: File[]) => void;
  onSelect: (nodeId: string) => void;
  onLocate: (nodeId: string) => void;
  onEdit: () => void;
  onMove: () => void;
  onRemove: () => void;
  onFinishMove: () => void;
  onFit: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
};

// Dock grouping and floating tool affordances adapted from basketikun/infinite-canvas (MIT).
// See THIRD_PARTY_NOTICES.md; execution, input capture and permissions remain Narra-owned.
export function CanvasDock({ active, editable, touch, tool, view, moving, onTool, onView, onCreate, onAddPrompt, onAddGeneration, onCaptureImport, onSelect, onLocate, onEdit, onMove, onRemove, onFinishMove, onFit, onZoomIn, onZoomOut }: CanvasDockProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const chooser = useRef<((files: File[]) => void) | null>(null);
  useEffect(() => {
    const input = fileInput.current;
    const cancel = () => { chooser.current = null; };
    input?.addEventListener("cancel", cancel);
    return () => { input?.removeEventListener("cancel", cancel); cancel(); };
  }, [active.document.id, editable]);

  return <>
    <div className={styles.canvasLookup} aria-label="画布节点列表"><CanvasNodePicker active={active} onSelect={onSelect} onLocate={onLocate} /></div>
    <div className={styles.cameraDock} role="group" aria-label="画布视图控制" data-canvas-camera>
      <DockButton label="缩小画布" onClick={onZoomOut}><ZoomOut aria-hidden className="size-4" /></DockButton>
      <span className={styles.zoomLabel}>{Math.round(active.viewport.zoom * 100)}%</span>
      <DockButton label="放大画布" onClick={onZoomIn}><ZoomIn aria-hidden className="size-4" /></DockButton>
      <DockButton label="适应全部节点" onClick={onFit}><Focus aria-hidden className="size-4" /></DockButton>
    </div>
    <nav className={styles.dockPosition} aria-label="画布创作工具" data-canvas-dock onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
      <div className={styles.dock}>
        {!touch && <>
          <DockButton label="选择工具" pressed={tool === "select"} onClick={() => onTool("select")}><MousePointer2 aria-hidden className="size-4" /></DockButton>
          <DockButton label="平移工具" pressed={tool === "pan"} onClick={() => onTool("pan")}><Hand aria-hidden className="size-4" /></DockButton>
          <span className={styles.dockDivider} />
        </>}
        {editable && <>
          <DockButton label="新建图片" primary onClick={onCreate}><Sparkles aria-hidden className="size-4" /><span className={styles.dockText}>新建图片</span></DockButton>
          <DockButton label="导入参考图" onClick={() => { chooser.current = onCaptureImport(); fileInput.current?.click(); }}><ImagePlus aria-hidden className="size-4" /></DockButton>
          <span className={styles.dockDivider} />
        </>}
        <DockButton label="高级图谱" pressed={view === "graph"} onClick={() => onView(view === "graph" ? "creation" : "graph")}><Network aria-hidden className="size-4" /></DockButton>
        {editable && view === "graph" && <>
          <DockButton label="提示词" onClick={onAddPrompt}><Type aria-hidden className="size-4" /></DockButton>
          <DockButton label="生成节点" onClick={onAddGeneration}><SlidersHorizontal aria-hidden className="size-4" /></DockButton>
        </>}
        {active.selectedNodeId && <>
          <span className={styles.dockDivider} />
          {moving ? <DockButton label="完成移动" primary onClick={onFinishMove}><Check aria-hidden className="size-4" /><span className={styles.dockText}>完成移动</span></DockButton> : <>
            <DockButton label={editable ? "编辑所选节点" : "查看所选节点"} onClick={onEdit}><Pencil aria-hidden className="size-4" /></DockButton>
            {editable && <DockButton label="移动所选节点" onClick={onMove}><Move aria-hidden className="size-4" /></DockButton>}
          </>}
          {editable && <DockButton label="移除所选节点" onClick={onRemove}><Trash2 aria-hidden className="size-4" /></DockButton>}
        </>}
      </div>
      {editable && <input ref={fileInput} type="file" multiple accept={CANVAS_IMPORT_IMAGE_TYPES.join(",")} className="hidden" aria-label="导入画布参考图文件" onChange={(event) => {
        const files = Array.from(event.currentTarget.files ?? []), captured = chooser.current;
        event.currentTarget.value = ""; chooser.current = null;
        if (files.length) captured?.(files);
      }} />}
    </nav>
  </>;
}

type DockButtonProps = { label: string; pressed?: boolean; primary?: boolean; onClick: () => void; children: ReactNode };
function DockButton({ label, pressed, primary, onClick, children }: DockButtonProps) {
  return <button type="button" aria-label={label} aria-pressed={pressed} title={label} className={cn(styles.dockButton, primary && styles.dockPrimary)} onClick={onClick}>{children}</button>;
}
