"use client";

import type { NodeProps } from "@xyflow/react";
import { Download, ImageOff, Replace, ScanEye } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { CANVAS_IMPORT_IMAGE_TYPES } from "@/lib/canvas/contracts";
import { getThumbUrl } from "@/lib/image-url";
import { cn } from "@/lib/utils";

import { CANVAS_INPUT_CLASS, CANVAS_PORTS, CANVAS_REFERENCE_LABELS } from "../../canvas/renderer-constants";
import type { CanvasImageTarget, CanvasReferenceFlowNode } from "../../canvas/renderer-types";
import styles from "../canvas-stage.module.css";
import { CanvasNodeShell, CanvasPort } from "./node-shell";

export function CanvasReferenceNode({ data, selected }: NodeProps<CanvasReferenceFlowNode>) {
  return <CanvasNodeShell kind="reference" selected={selected} readOnly={data.readOnly} previewOnly={data.previewOnly} onRemove={() => data.actions.removeNode(data.node.id)}>
    <CanvasReferenceContent data={data} />
    <CanvasPort id={CANVAS_PORTS.imageOutput} type="source" label="参考图输出" readOnly={data.readOnly || Boolean(data.previewOnly)} />
  </CanvasNodeShell>;
}

type CanvasReferenceContentProps = { data: CanvasReferenceFlowNode["data"] };
export function CanvasReferenceContent({ data }: CanvasReferenceContentProps) {
  const { canvasId, node, readOnly, actions, reference, previewOnly = false } = data;
  const input = useRef<HTMLInputElement>(null);
  const chooser = useRef<((file: File) => void) | null>(null);
  useEffect(() => {
    const element = input.current;
    const cancel = () => { chooser.current = null; };
    element?.addEventListener("cancel", cancel);
    return () => { element?.removeEventListener("cancel", cancel); cancel(); };
  }, [canvasId, node.id, previewOnly, readOnly]);
  const [preview, setPreview] = useState<{ blobId: string; url: string } | null>(null);
  const blobId = reference?.blobId ?? null;
  const acquirePreview = actions.acquirePreview;
  const reportError = actions.reportError;

  useEffect(() => {
    if (!blobId) return;
    try {
      const lease = acquirePreview(node.id);
      // A card owns only its URL lease. Originals and viewer leases outlive it.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreview(lease ? { blobId, url: lease.url } : null);
      return () => lease?.release();
    } catch (error) { reportError(error); }
  }, [acquirePreview, blobId, node.id, reportError]);

  const url = reference?.url ?? (preview?.blobId === blobId ? preview?.url : null);
  const target: CanvasImageTarget | null = url ? { kind: "reference", canvasId, nodeId: node.id, url, ...(reference?.assetId ? { assetId: reference.assetId } : {}) } : null;
  const state = reference?.state ?? "missing";
  return (
      <div className={styles.nodeBody}>
        {target ? previewOnly ? <div className={styles.imageButton}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={getThumbUrl(target.url, 640)} alt="画布参考图" draggable={false} loading="lazy" decoding="async" />
        </div> : (
          <button type="button" aria-label="查看参考原图" className={cn(CANVAS_INPUT_CLASS, styles.imageButton)} onClick={(event) => { event.stopPropagation(); actions.viewImage(target); }}>
            {/* Browser-local blobs and the shared thumbnail endpoint need no new image pipeline. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={getThumbUrl(target.url, 640)} alt="画布参考图" draggable={false} loading="lazy" decoding="async" />
          </button>
        ) : (
          <div className={styles.missingImage}><ImageOff aria-hidden className="size-8" /><span>参考原图暂不可用</span></div>
        )}
        <p className={cn(styles.referenceState, state === "missing" && styles.problemText)} role="status">{CANVAS_REFERENCE_LABELS[state]}</p>
        {!previewOnly && <div className={cn(CANVAS_INPUT_CLASS, styles.nodeActions)} onClick={(event) => event.stopPropagation()}>
          {target && <button type="button" className={styles.smallButton} onClick={() => actions.viewImage(target)}><ScanEye aria-hidden className="size-3.5" />查看</button>}
          {target && <button type="button" className={styles.smallButton} onClick={() => actions.downloadImage(target)} aria-label="下载参考原图"><Download aria-hidden className="size-3.5" /></button>}
          {!readOnly && <button type="button" className={styles.smallButton} onClick={() => { chooser.current = (file) => actions.replaceReference(node.id, file); input.current?.click(); }}><Replace aria-hidden className="size-3.5" />{state === "missing" ? "重新上传" : "替换原图"}</button>}
        </div>}
        {!readOnly && !previewOnly && <input ref={input} type="file" accept={CANVAS_IMPORT_IMAGE_TYPES.join(",")} aria-label="替换参考原图文件" className="hidden" onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          const replace = chooser.current ?? ((picked: File) => actions.replaceReference(node.id, picked));
          chooser.current = null;
          if (file) replace(file);
        }} />}
      </div>
  );
}
