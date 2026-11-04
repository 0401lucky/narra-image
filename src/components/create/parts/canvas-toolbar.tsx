"use client";

import { Check, CloudUpload, LoaderCircle, Pencil, Save, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";

import type { CanvasDocumentView } from "../canvas/controller-types";
import { CANVAS_CLOUD_LABELS, CANVAS_LOCAL_LABELS } from "../canvas/renderer-constants";
import styles from "./canvas-stage.module.css";

type CanvasToolbarProps = {
  document: CanvasDocumentView;
  readOnly: boolean;
  pendingFields?: number;
  onRename: () => void;
  onDelete: () => void;
  onSave: () => void;
};

export function CanvasToolbar({ document, readOnly, pendingFields = 0, onRename, onDelete, onSave }: CanvasToolbarProps) {
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
          <button type="button" className={styles.saveButton} aria-label={saving ? "保存中" : "保存到账户"} onClick={onSave} disabled={saving || document.deleting}>
            {saving ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Save aria-hidden className="size-4" />}<span>{saving ? "保存中" : "保存到账户"}</span>
          </button>
        </div>}
      </div>
      {readOnly && <p className={styles.readOnlyNotice}>只读画布 · 可选择、平移与缩放</p>}
    </header>
  );
}
