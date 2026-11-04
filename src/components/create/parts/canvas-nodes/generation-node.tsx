"use client";

import type { NodeProps } from "@xyflow/react";
import { CircleHelp, ImagePlus, LoaderCircle, Play, RotateCcw, SlidersHorizontal } from "lucide-react";

import { normalizeCanvasRunParametersV1 } from "@/lib/canvas/contracts";
import { cn } from "@/lib/utils";

import { CANVAS_INPUT_CLASS, CANVAS_PORTS, CANVAS_RUN_LABELS } from "../../canvas/renderer-constants";
import type { CanvasGenerationFlowNode } from "../../canvas/renderer-types";
import { getSizeLabel } from "../../utils";
import styles from "../canvas-stage.module.css";
import { CanvasNodeShell, CanvasPort } from "./node-shell";

export function CanvasGenerationNode({ data, selected }: NodeProps<CanvasGenerationFlowNode>) {
  const portsReadOnly = data.readOnly || Boolean(data.previewOnly) || data.graphView === false;
  return <CanvasNodeShell kind="generation" selected={selected} readOnly={data.readOnly} previewOnly={data.previewOnly} replaced={data.editorReplacesCard} onRemove={() => data.actions.removeNode(data.node.id)}>
    <CanvasGenerationContent data={data} />
    <CanvasPort id={CANVAS_PORTS.promptInput} type="target" label="生成节点提示词输入" variant="prompt" readOnly={portsReadOnly} />
    <CanvasPort id={CANVAS_PORTS.imageInput} type="target" label="生成节点参考图输入" readOnly={portsReadOnly} />
    <CanvasPort id={CANVAS_PORTS.provenanceOutput} type="source" label="已生成结果来源" variant="provenance" readOnly={portsReadOnly} />
  </CanvasNodeShell>;
}

type CanvasGenerationContentProps = { data: CanvasGenerationFlowNode["data"]; hideActions?: boolean };
export function CanvasGenerationContent({ data, hideActions = false }: CanvasGenerationContentProps) {
  const { node, referenceCount, prompt, sharedPromptCount, previewOnly = false } = data;
  const parameters = normalizeCanvasRunParametersV1(node.parameters, referenceCount);
  return (
      <div className={styles.nodeBody}>
        <p className={cn(styles.creationPromptPreview, !prompt?.text && styles.emptyPromptPreview)}>{prompt?.text || "描述你的想法，让画面在这里发生。"}</p>
        {sharedPromptCount > 1 && <p className={styles.sharedPromptLabel}>共享提示词 · {sharedPromptCount} 个创作</p>}
        <div className={styles.creationMeta}><span><ImagePlus aria-hidden className="size-3.5" />{referenceCount ? `${referenceCount} 张参考图` : "添加参考图"}</span><span>{parameters.count} 张输出</span></div>
        <div className={styles.creationSettingsPreview}><span>{parameters.model}</span><span>{getSizeLabel(parameters.size)}</span></div>
        <CanvasGenerationStatus data={data} />
        {!previewOnly && !hideActions && <CanvasGenerationActions data={data} hideRun={data.editorOpen} />}
      </div>
  );
}

export function CanvasGenerationStatus({ data }: { data: CanvasGenerationFlowNode["data"] }) {
  const { run } = data;
  if (!run) return null;
  const progressing = ["preparing", "submitting", "pending"].includes(run.phase);
  return <><p role="status" className={cn(styles.runState, ["failed", "rejected", "uncertain", "unavailable"].includes(run.phase) && styles.problemText)}>
    {progressing && <LoaderCircle aria-hidden className="size-3.5 animate-spin" />}{CANVAS_RUN_LABELS[run.phase]}
  </p>{run.error && <p className={styles.nodeError} role="alert">{run.error}</p>}</>;
}

type CanvasGenerationActionsProps = { data: CanvasGenerationFlowNode["data"]; hideSettings?: boolean; hideRun?: boolean };
export function CanvasGenerationActions({ data, hideSettings = false, hideRun = false }: CanvasGenerationActionsProps) {
  const { node, readOnly, actions, run } = data;
  const busy = run !== null && ["preparing", "submitting", "pending", "uncertain", "unavailable"].includes(run.phase);
  const progressing = run !== null && ["preparing", "submitting", "pending"].includes(run.phase);
  if (readOnly) return null;
  return <>
          <div className={cn(CANVAS_INPUT_CLASS, styles.generationActions)} onClick={(event) => event.stopPropagation()}>
            {!hideRun && <button type="button" className={styles.runButton} aria-label={progressing ? "生成中" : "运行此节点"} disabled={busy} onClick={() => actions.runNode(node.id)}>
              {progressing ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Play aria-hidden className="size-4" />}
              {progressing ? "生成中" : "生成图片"}
            </button>}
            {!hideSettings && <button type="button" className={styles.smallButton} aria-label="设置生成节点参数" onClick={() => actions.inspectNode(node.id)}><SlidersHorizontal aria-hidden className="size-4" /></button>}
          </div>
        {!hideRun && run?.phase === "uncertain" && <div className={cn(CANVAS_INPUT_CLASS, styles.recoveryActions)} onClick={(event) => event.stopPropagation()}>
          <p>保留原请求编号与输入。重试不会使用之后的编辑内容。</p>
          <button type="button" className={styles.smallButton} onClick={() => actions.retryTransport(run.runId)}><RotateCcw aria-hidden className="size-3.5" />重试原请求</button>
          <button type="button" className={styles.smallButton} onClick={actions.recoverRuns}>查询请求状态</button>
        </div>}
        {!hideRun && run?.phase === "unavailable" && <button type="button" className={cn(CANVAS_INPUT_CLASS, styles.smallButton)} onClick={(event) => { event.stopPropagation(); actions.refreshRuntime(); }}><CircleHelp aria-hidden className="size-3.5" />重新读取任务</button>}
  </>;
}
