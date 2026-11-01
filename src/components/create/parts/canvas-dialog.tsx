"use client";

import { useEffect, useId, useRef, useState } from "react";

import { CANVAS_LIMITS } from "@/lib/canvas/contracts";
import { cn } from "@/lib/utils";
import { useCanvasMobileViewport } from "../hooks/use-canvas-mobile-viewport";

import styles from "./canvas-stage.module.css";

export type CanvasDialogIntent = { kind: "rename" | "delete" | "reload"; canvasId: string; title: string }
  | { kind: "node-delete"; canvasId: string; nodeId: string; title: string };
type CanvasDialogProps = {
  intent: CanvasDialogIntent;
  error: string | null;
  onClose: () => void;
  onConfirm: (title: string) => Promise<boolean>;
};

export function CanvasDialog({ intent, error, onClose, onConfirm }: CanvasDialogProps) {
  const dialog = useRef<HTMLDivElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const composing = useRef(false);
  const viewport = useCanvasMobileViewport();
  const [title, setTitle] = useState(intent.title);
  const [pending, setPending] = useState(false);
  const headingId = useId();
  const descriptionId = useId();
  const deleting = intent.kind === "delete" || intent.kind === "node-delete";
  const heading = intent.kind === "rename" ? "重命名画布" : intent.kind === "delete" ? "删除此画布？" : intent.kind === "node-delete" ? "移除此节点？" : "重新载入账户快照？";
  const confirm = () => {
    if (pending || composing.current || !form.current?.reportValidity()) return;
    setPending(true);
    void onConfirm(title).then((success) => { if (success) onClose(); else setPending(false); });
  };

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.querySelector<HTMLElement>(intent.kind === "rename" ? "input" : "button")?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [intent.kind]);

  return (
    <div className={cn(styles.dialogBackdrop, styles.visibleDialogBackdrop)} style={viewport.style}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={(event) => {
      event.stopPropagation();
      if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape" && !pending) { event.preventDefault(); onClose(); }
      if (event.key !== "Tab") return;
      const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])") ?? []);
      const first = items[0];
      const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={headingId} aria-describedby={descriptionId} className={styles.dialog}>
        <h2 id={headingId}>{heading}</h2>
        <p id={descriptionId}>{intent.kind === "rename" ? "只修改名称，不会保存当前的节点与连线。" : deleting ? `${intent.kind === "node-delete" ? "仅移除此节点及其连接。" : "将移除画布及其组织。"}已提交的任务继续运行，生成图片仍保留在「我的作品」，不会因此取消或退款。` : "这会放弃当前本地场景和未应用参数，重新读取最近一次成功保存的账户快照。本地未同步编辑和未保存的运行绑定不会合并，请确认后继续。"}</p>
        {error && <p role="alert" className={styles.problemText}>{error}</p>}
        <form ref={form} onSubmit={(event) => event.preventDefault()}>
          {intent.kind === "rename" && <label className={styles.field}><span>画布名称</span><input aria-label="画布名称" value={title} maxLength={CANVAS_LIMITS.titleCharacters} required disabled={pending} onChange={(event) => setTitle(event.target.value)} /></label>}
          <div className={styles.dialogActions}>
            <button type="button" className={styles.smallButton} disabled={pending} onClick={onClose}>取消</button>
            <button type="button" onClick={confirm} className={cn(styles.saveButton, deleting && styles.deleteButton)} disabled={pending || (intent.kind === "rename" && !title.trim())}>{pending ? "处理中…" : intent.kind === "rename" ? "确认重命名" : intent.kind === "delete" ? "确认删除画布" : intent.kind === "node-delete" ? "确认移除节点" : "放弃本地并载入"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
