"use client";

import { Focus, ListTree } from "lucide-react";
import { useEffect, useState } from "react";

import type { CanvasLocalNodeV1 } from "@/lib/canvas/contracts";
import { getThumbUrl } from "@/lib/image-url";

import type { CanvasActiveView } from "../canvas/controller-types";
import { canvasNodeLabel, canvasSourceStatus } from "../canvas/renderer-adapter";
import type { CanvasNodeActions } from "../canvas/renderer-types";
import styles from "./canvas-stage.module.css";

type CanvasNodePickerProps = { active: CanvasActiveView; onSelect: (nodeId: string) => void; onLocate: (nodeId: string) => void };
export function CanvasNodePicker({ active, onSelect, onLocate }: CanvasNodePickerProps) {
  return <div className={styles.nodePicker}>
    <ListTree aria-hidden className="size-4" />
    <select aria-label="选择画布节点" value={active.selectedNodeId ?? ""} onChange={(event) => { if (event.target.value) onSelect(event.target.value); }}>
      <option value="">节点列表 · {active.scene.nodes.length}</option>
      {active.scene.nodes.map((node) => <option key={node.id} value={node.id}>{canvasNodeLabel(node)} · {canvasSourceStatus(active, node)}</option>)}
    </select>
    <button type="button" className={styles.iconButton} aria-label="定位所选节点" disabled={!active.selectedNodeId} onClick={() => { if (active.selectedNodeId) onLocate(active.selectedNodeId); }}><Focus aria-hidden className="size-4" /></button>
  </div>;
}

type CanvasSourceSummaryProps = { active: CanvasActiveView; node: CanvasLocalNodeV1; actions: CanvasNodeActions };
export function CanvasSourceSummary({ active, node, actions }: CanvasSourceSummaryProps) {
  const reference = node.kind === "reference" ? active.references[node.id] : null;
  const blobId = reference?.blobId;
  const [preview, setPreview] = useState<{ blobId: string; url: string } | null>(null);
  const { acquirePreview, reportError } = actions;
  useEffect(() => {
    if (!blobId) return;
    try {
      const lease = acquirePreview(node.id);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- A scoped original lease belongs only to this preview.
      setPreview(lease ? { blobId, url: lease.url } : null);
      return () => lease?.release();
    } catch (error) { reportError(error); }
  }, [acquirePreview, blobId, node.id, reportError]);
  const image = node.kind === "result" ? active.images[node.imageId] : null;
  const url = reference?.url ?? (blobId && preview?.blobId === blobId ? preview.url : null)
    ?? (node.kind === "result" && image?.jobId === node.jobId ? image.url : null);
  return <div className={styles.sourceSummary}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {url && <img src={getThumbUrl(url, 160)} alt="所选输入预览" draggable={false} loading="lazy" />}
    <span>{canvasNodeLabel(node)}<small>{canvasSourceStatus(active, node)}</small></span>
  </div>;
}
