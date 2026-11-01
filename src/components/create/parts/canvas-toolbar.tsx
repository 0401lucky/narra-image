"use client";

import { Check, CloudUpload, Focus, ImagePlus, LoaderCircle, Pencil, Plus, Save, Sparkles, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef } from "react";

import { CANVAS_IMPORT_IMAGE_TYPES } from "@/lib/canvas/contracts";
import { cn } from "@/lib/utils";

import type { CanvasDocumentView } from "../canvas/controller-types";
import { CANVAS_CLOUD_LABELS, CANVAS_LOCAL_LABELS } from "../canvas/renderer-constants";
import styles from "./canvas-stage.module.css";

type CanvasToolbarProps = {
  document: CanvasDocumentView;
  readOnly: boolean;
  pendingFields?: number;
  zoom: number;
  onRename: () => void;
  onDelete: () => void;
  onSave: () => void;
  onAddPrompt: () => void;
  onAddGeneration: () => void;
  onImport: (files: File[]) => void;
  onFit: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
};

export function CanvasToolbar({ document, readOnly, pendingFields = 0, zoom, onRename, onDelete, onSave, onAddPrompt, onAddGeneration, onImport, onFit, onZoomIn, onZoomOut }: CanvasToolbarProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const chooser = useRef<((files: File[]) => void) | null>(null);
  useEffect(() => {
    const element = fileInput.current;
    const cancel = () => { chooser.current = null; };
    element?.addEventListener("cancel", cancel);
    return () => { element?.removeEventListener("cancel", cancel); cancel(); };
  }, [document.id, readOnly]);
  const saving = document.cloudState === "saving";
  return (
    <header className={styles.toolbar} aria-label="画布工具栏">
      <div className={styles.titleRow}>
        <div className="min-w-0 flex-1">
          <h2 className={styles.canvasTitle}>{document.title}</h2>
          <div className={styles.saveStates} role="status" aria-live="polite">
            <span className={cn(["failed", "conflict"].includes(document.localState) && styles.problemText)}>{CANVAS_LOCAL_LABELS[document.localState]}</span>
            <span aria-hidden> / </span>
            <span className={cn(styles.cloudState, ["failed", "conflict"].includes(document.cloudState) && styles.problemText)}>
              {saving ? <LoaderCircle aria-hidden className="size-3 animate-spin" /> : document.cloudState === "saved" ? <Check aria-hidden className="size-3" /> : <CloudUpload aria-hidden className="size-3" />}
              {pendingFields && !saving ? `${pendingFields} 项参数待应用，未包含在账户快照` : CANVAS_CLOUD_LABELS[document.cloudState]}
            </span>
          </div>
        </div>
        {!readOnly && <div className={styles.metadataActions}>
          <button type="button" className={styles.iconButton} aria-label="重命名画布" onClick={onRename} disabled={document.deleting}><Pencil aria-hidden className="size-4" /></button>
          <button type="button" className={styles.iconButton} aria-label="删除画布" onClick={onDelete} disabled={document.deleting}><Trash2 aria-hidden className="size-4" /></button>
          <button type="button" className={styles.saveButton} onClick={onSave} disabled={saving || document.deleting}>
            {saving ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Save aria-hidden className="size-4" />}<span>{saving ? "保存中" : "保存到账户"}</span>
          </button>
        </div>}
      </div>
      <div className={styles.toolsRow}>
        {readOnly ? <p className={styles.readOnlyNotice}>只读画布 · 可选择、平移与缩放</p> : <div className={styles.creationTools}>
          <button type="button" className={styles.toolButton} onClick={onAddPrompt} disabled={document.deleting}><Plus aria-hidden className="size-4" />提示词</button>
          <button type="button" className={styles.toolButton} onClick={() => { chooser.current = onImport; fileInput.current?.click(); }} disabled={document.deleting}><ImagePlus aria-hidden className="size-4" />参考图</button>
          <button type="button" className={styles.toolButton} onClick={onAddGeneration} disabled={document.deleting}><Sparkles aria-hidden className="size-4" />生成节点</button>
          <input ref={fileInput} type="file" multiple accept={CANVAS_IMPORT_IMAGE_TYPES.join(",")} className="hidden" aria-label="导入画布参考图文件" onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = "";
            const importFiles = chooser.current ?? onImport;
            chooser.current = null;
            if (files.length) importFiles(files);
          }} />
        </div>}
        <div className={styles.cameraTools} role="group" aria-label="画布视图控制">
          <button type="button" className={styles.iconButton} aria-label="缩小画布" onClick={onZoomOut}><ZoomOut aria-hidden className="size-4" /></button>
          <span className={styles.zoomLabel}>{Math.round(zoom * 100)}%</span>
          <button type="button" className={styles.iconButton} aria-label="放大画布" onClick={onZoomIn}><ZoomIn aria-hidden className="size-4" /></button>
          <button type="button" className={styles.iconButton} aria-label="适应全部节点" onClick={onFit}><Focus aria-hidden className="size-4" /></button>
        </div>
      </div>
    </header>
  );
}
