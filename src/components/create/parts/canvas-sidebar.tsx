"use client";

import { Layers3, Plus } from "lucide-react";

import { cn } from "@/lib/utils";

import type { CanvasControllerSnapshot } from "../canvas/controller-types";
import { CANVAS_CLOUD_LABELS } from "../canvas/renderer-constants";
import styles from "./canvas-stage.module.css";

type CanvasSidebarProps = {
  snapshot: CanvasControllerSnapshot;
  onNew: () => void;
  onSelect: (canvasId: string) => void;
  onLoadMore: () => void;
};

export function CanvasSidebar({ snapshot, onNew, onSelect, onLoadMore }: CanvasSidebarProps) {
  return (
    <aside className={styles.sidebar} aria-label="画布导航">
      <div className={styles.sidebarHeading}><Layers3 aria-hidden className="size-4" /><span>我的画布</span><span className={styles.documentCount}>{snapshot.documents.length}</span></div>
      {!snapshot.readOnly && <button type="button" className={styles.newButton} disabled={!snapshot.ready} onClick={onNew}><Plus aria-hidden className="size-4" />新建空白画布</button>}
      <div className={styles.desktopDocuments}>
        {snapshot.documents.length === 0 && <p className={styles.sidebarEmpty}>{snapshot.loading ? "正在读取画布…" : "还没有画布。对话内容不会自动加入这里。"}</p>}
        <nav aria-label="独立画布列表">
          {snapshot.documents.map((document) => (
            <button type="button" key={document.id} aria-current={snapshot.activeCanvasId === document.id ? "page" : undefined}
              disabled={document.deleting} onClick={() => onSelect(document.id)}
              className={cn(styles.documentButton, snapshot.activeCanvasId === document.id && styles.activeDocument)}>
              <span className={styles.documentMark} aria-hidden><Layers3 className="size-4" /></span>
              <span className="min-w-0"><span className={styles.documentTitle}>{document.title}</span><span className={styles.documentState}>{document.deleting ? "正在删除…" : CANVAS_CLOUD_LABELS[document.cloudState]}</span></span>
            </button>
          ))}
        </nav>
      </div>
      <label className={styles.mobileDocuments}>
        <span className="sr-only">选择画布</span>
        <select aria-label="选择画布" value={snapshot.activeCanvasId ?? ""} onChange={(event) => { if (event.target.value) onSelect(event.target.value); }}>
          <option value="" disabled>{snapshot.documents.length ? "选择画布" : "暂无画布"}</option>
          {snapshot.documents.map((document) => <option key={document.id} value={document.id} disabled={document.deleting}>{document.title}</option>)}
        </select>
      </label>
      {snapshot.nextCursor && <button type="button" className={styles.loadMoreButton} onClick={onLoadMore} disabled={snapshot.loading}>{snapshot.loading ? "读取中…" : "加载更多画布"}</button>}
      <p className={styles.sidebarNote}>本地自动存草稿<br />手动保存后可跨设备恢复</p>
    </aside>
  );
}
