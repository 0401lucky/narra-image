"use client";

import type { NodeProps } from "@xyflow/react";
import { Download, ImageOff, RefreshCw, ScanEye } from "lucide-react";

import { getThumbUrl } from "@/lib/image-url";
import { cn } from "@/lib/utils";

import { CANVAS_INPUT_CLASS, CANVAS_PORTS } from "../../canvas/renderer-constants";
import type { CanvasImageTarget, CanvasResultFlowNode } from "../../canvas/renderer-types";
import styles from "../canvas-stage.module.css";
import { CanvasNodeShell, CanvasPort } from "./node-shell";

export function CanvasResultNode({ data, selected }: NodeProps<CanvasResultFlowNode>) {
  const portsReadOnly = data.readOnly || Boolean(data.previewOnly);
  return <CanvasNodeShell kind="result" selected={selected} readOnly={data.readOnly} previewOnly={data.previewOnly} onRemove={() => data.actions.removeNode(data.node.id)}>
    <CanvasResultContent data={data} />
    <CanvasPort id={CANVAS_PORTS.provenanceInput} type="target" label="原始生成来源" variant="provenance" readOnly={portsReadOnly} />
    <CanvasPort id={CANVAS_PORTS.imageOutput} type="source" label="固定结果图输出" readOnly={portsReadOnly} />
  </CanvasNodeShell>;
}

type CanvasResultContentProps = { data: CanvasResultFlowNode["data"] };
export function CanvasResultContent({ data }: CanvasResultContentProps) {
  const { canvasId, node, actions, image, previewOnly = false } = data;
  const target: CanvasImageTarget | null = image?.jobId === node.jobId && image.id === node.imageId && image.url ? {
    kind: "result", canvasId, nodeId: node.id, url: image.url, imageId: node.imageId, jobId: node.jobId,
    actualWidth: image.actualWidth, actualHeight: image.actualHeight, actualSize: image.actualSize,
  } : null;
  return (
      <div className={styles.nodeBody}>
        {target ? <div className={styles.imageButton}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={getThumbUrl(target.url, 640)} alt="画布生成结果" draggable={false} loading="lazy" decoding="async" />
        </div> : <div className={styles.missingImage}><ImageOff aria-hidden className="size-8" /><span>结果图片暂不可用</span></div>}
        <div className={styles.nodeFootnote}><span>固定结果，不随重跑替换</span><span>{image?.actualSize ?? (image?.actualWidth && image.actualHeight ? `${image.actualWidth}x${image.actualHeight}` : "")}</span></div>
        {!previewOnly && (target ? <div className={cn(CANVAS_INPUT_CLASS, styles.nodeActions)} onClick={(event) => event.stopPropagation()}>
          <button type="button" className={styles.smallButton} aria-label="查看生成原图" onClick={() => actions.viewImage(target)}><ScanEye aria-hidden className="size-3.5" />查看原图</button>
          <button type="button" className={styles.smallButton} onClick={() => actions.downloadImage(target)}><Download aria-hidden className="size-3.5" />下载</button>
        </div> : <div className={cn(CANVAS_INPUT_CLASS, styles.nodeActions)} onClick={(event) => event.stopPropagation()}>
          <button type="button" className={styles.smallButton} onClick={actions.refreshRuntime}><RefreshCw aria-hidden className="size-3.5" />重新读取结果图片</button>
          <p className={styles.helpText}>只读取原结果，不会重新生成。</p>
        </div>)}
      </div>
  );
}
