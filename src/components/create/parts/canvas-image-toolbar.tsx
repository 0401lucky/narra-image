"use client";

import { Download, ScanEye, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";

import type { CanvasLocalNodeV1 } from "@/lib/canvas/contracts";
import { cn } from "@/lib/utils";

import type { CanvasActiveView } from "../canvas/controller-types";
import { CANVAS_INPUT_CLASS } from "../canvas/renderer-constants";
import type { CanvasImageTarget, CanvasNodeActions } from "../canvas/renderer-types";
import styles from "./canvas-stage.module.css";

type CanvasImageToolbarProps = {
  active: CanvasActiveView;
  node: Extract<CanvasLocalNodeV1, { kind: "reference" | "result" }>;
  viewport: RefObject<HTMLDivElement | null>;
  actions: CanvasNodeActions;
  readOnly: boolean;
  onCreate: () => void;
};

export function CanvasImageToolbar({ active, node, viewport, actions, readOnly, onCreate }: CanvasImageToolbarProps) {
  const [position, setPosition] = useState<CSSProperties>();
  const toolbarElement = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<{ blobId: string; url: string } | null>(null);
  const reference = node.kind === "reference" ? active.references[node.id] : null;
  const image = node.kind === "result" ? active.images[node.imageId] : null;
  const blobId = reference?.blobId;
  const { acquirePreview, reportError } = actions;
  useEffect(() => {
    if (!blobId) return;
    try {
      const lease = acquirePreview(node.id);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Selected-image controls own a separate preview lease.
      setPreview(lease ? { blobId, url: lease.url } : null);
      return () => lease?.release();
    } catch (error) { reportError(error); }
  }, [acquirePreview, blobId, node.id, reportError]);
  const url = reference?.url ?? (preview?.blobId === blobId ? preview?.url : null);
  const target: CanvasImageTarget | null = node.kind === "reference" && url
    ? { kind: "reference", canvasId: active.document.id, nodeId: node.id, url, ...(reference?.assetId ? { assetId: reference.assetId } : {}) }
    : node.kind === "result" && image?.id === node.imageId && image.jobId === node.jobId && image.url
      ? { kind: "result", canvasId: active.document.id, nodeId: node.id, url: image.url, imageId: node.imageId, jobId: node.jobId,
        actualWidth: image.actualWidth, actualHeight: image.actualHeight, actualSize: image.actualSize }
      : null;
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    let card: HTMLElement | null = null;
    const update = () => {
      const current = Array.from(element.querySelectorAll<HTMLElement>(".react-flow__node")).find((value) => value.dataset.id === node.id) ?? null;
      if (current !== card) {
        if (card) observer.unobserve(card);
        card = current;
        if (card) observer.observe(card);
      }
      const bounds = element.getBoundingClientRect(), rect = card?.getBoundingClientRect(), visible = window.visualViewport;
      const left = Math.max(bounds.left, visible?.offsetLeft ?? 0), top = Math.max(bounds.top, visible?.offsetTop ?? 0);
      const right = Math.min(bounds.right, (visible?.offsetLeft ?? 0) + (visible?.width ?? window.innerWidth));
      const bottom = Math.min(bounds.bottom, (visible?.offsetTop ?? 0) + (visible?.height ?? window.innerHeight));
      const docks = Array.from(element.parentElement?.querySelectorAll<HTMLElement>("[data-canvas-dock], [data-canvas-camera]") ?? []).map((dock) => dock.getBoundingClientRect());
      // Both lower docks can cover controls for a partly offscreen selected image.
      const availableBottom = Math.min(bottom, ...docks.filter((dock) => dock.top > top && dock.top < bottom).map((dock) => dock.top - 8));
      const width = Math.min(310, Math.max(0, right - left - 16));
      const height = toolbarElement.current?.getBoundingClientRect().height || 54;
      const toolbarTop = Math.max(top + 8, Math.min((rect?.top ?? top + height + 16) - height - 8, availableBottom - height - 8));
      setPosition({ left: Math.max(left + 8, Math.min(rect?.left ?? left + 8, right - width - 8)), top: toolbarTop, width,
        maxHeight: Math.max(0, availableBottom - toolbarTop), overflowY: "auto" });
    };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    if (toolbarElement.current) observer.observe(toolbarElement.current);
    element.parentElement?.querySelectorAll<HTMLElement>("[data-canvas-dock], [data-canvas-camera]").forEach((dock) => observer.observe(dock));
    // A selected image can mount after the toolbar's initial fallback measurement.
    const mounts = new MutationObserver(update);
    mounts.observe(element, { childList: true, subtree: true });
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => { mounts.disconnect(); observer.disconnect(); window.removeEventListener("scroll", update, true); window.removeEventListener("resize", update); window.visualViewport?.removeEventListener("resize", update); window.visualViewport?.removeEventListener("scroll", update); };
  }, [viewport, node.id, node.position.x, node.position.y, active.viewport.x, active.viewport.y, active.viewport.zoom]);

  return <div ref={toolbarElement} style={position} className={cn(styles.contextToolbar, CANVAS_INPUT_CLASS)} role="group" aria-label="所选图片操作">
    {!readOnly && <button type="button" className={styles.saveButton} disabled={!target} onClick={onCreate}><Sparkles aria-hidden className="size-4" />继续创作</button>}
    <button type="button" className={styles.smallButton} disabled={!target} aria-label="查看所选原图" onClick={() => { if (target) actions.viewImage(target); }}><ScanEye aria-hidden className="size-4" />查看</button>
    <button type="button" className={styles.iconButton} disabled={!target} aria-label="下载所选原图" onClick={() => { if (target) actions.downloadImage(target); }}><Download aria-hidden className="size-4" /></button>
  </div>;
}
