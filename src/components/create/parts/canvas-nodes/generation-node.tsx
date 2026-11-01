"use client";

import type { NodeProps } from "@xyflow/react";
import { CircleHelp, LoaderCircle, Play, RotateCcw, SlidersHorizontal, Sparkles } from "lucide-react";

import { normalizeCanvasRunParametersV1 } from "@/lib/canvas/contracts";
import { cn } from "@/lib/utils";

import { CANVAS_INPUT_CLASS, CANVAS_PORTS, CANVAS_RUN_LABELS } from "../../canvas/renderer-constants";
import type { CanvasGenerationFlowNode } from "../../canvas/renderer-types";
import { getSizeLabel } from "../../utils";
import styles from "../canvas-stage.module.css";
import { CanvasNodeShell, CanvasPort } from "./node-shell";

export function CanvasGenerationNode({ data, selected }: NodeProps<CanvasGenerationFlowNode>) {
  const portsReadOnly = data.readOnly || Boolean(data.previewOnly);
  return <CanvasNodeShell kind="generation" selected={selected} readOnly={data.readOnly} previewOnly={data.previewOnly} onRemove={() => data.actions.removeNode(data.node.id)}>
    <CanvasGenerationContent data={data} />
    <CanvasPort id={CANVAS_PORTS.promptInput} type="target" label="生成节点提示词输入" variant="prompt" readOnly={portsReadOnly} />
    <CanvasPort id={CANVAS_PORTS.imageInput} type="target" label="生成节点参考图输入" readOnly={portsReadOnly} />
    <CanvasPort id={CANVAS_PORTS.provenanceOutput} type="source" label="已生成结果来源" variant="provenance" readOnly={portsReadOnly} />
  </CanvasNodeShell>;
}

type CanvasGenerationContentProps = { data: CanvasGenerationFlowNode["data"]; hideActions?: boolean };
export function CanvasGenerationContent({ data, hideActions = false }: CanvasGenerationContentProps) {
  const { node, readOnly, referenceCount, hasPrompt, run, previewOnly = false } = data;
  const parameters = normalizeCanvasRunParametersV1(node.parameters, referenceCount);
  const progressing = run !== null && ["preparing", "submitting", "pending"].includes(run.phase);
  return (
      <div className={styles.nodeBody}>
        <p className={styles.nodeEyebrow}><Sparkles aria-hidden className="size-3.5" /> 只运行当前节点</p>
        <h3 className={styles.modelName}>{parameters.model}</h3>
        <p className={styles.nodeDescription}>{getSizeLabel(parameters.size)} · {parameters.outputFormat.toUpperCase()}</p>
        <div className={styles.inputSummary}>
          <span className={cn(!hasPrompt && styles.problemText)}>{hasPrompt ? "提示词已连接" : "待连接一个提示词"}</span>
          <span>{referenceCount ? `${referenceCount} 张参考图 · 固定 1 张输出` : `文生图 · ${parameters.count} 张输出`}</span>
        </div>
        {run && <p role="status" className={cn(styles.runState, ["failed", "rejected", "uncertain", "unavailable"].includes(run.phase) && styles.problemText)}>
          {progressing && <LoaderCircle aria-hidden className="size-3.5 animate-spin" />}{CANVAS_RUN_LABELS[run.phase]}
        </p>}
        {run?.error && <p className={styles.nodeError} role="alert">{run.error}</p>}
        {!previewOnly && !hideActions && <CanvasGenerationActions data={data} hideRun={data.editorOpen} />}
        <p className={styles.nodeFootnote}>{readOnly ? "当前仅查看" : previewOnly ? "选择后打开编辑面板，手动运行" : "编辑与连接不会自动生成"}</p>
      </div>
  );
}

type CanvasGenerationActionsProps = { data: CanvasGenerationFlowNode["data"]; hideSettings?: boolean; hideRun?: boolean };
export function CanvasGenerationActions({ data, hideSettings = false, hideRun = false }: CanvasGenerationActionsProps) {
  const { node, readOnly, actions, run } = data;
  const busy = run !== null && ["preparing", "submitting", "pending", "uncertain", "unavailable"].includes(run.phase);
  const progressing = run !== null && ["preparing", "submitting", "pending"].includes(run.phase);
  if (readOnly) return null;
  return <>
          <div className={cn(CANVAS_INPUT_CLASS, styles.generationActions)} onClick={(event) => event.stopPropagation()}>
            {!hideRun && <button type="button" className={styles.runButton} disabled={busy} onClick={() => actions.runNode(node.id)}>
              {progressing ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Play aria-hidden className="size-4" />}
              {progressing ? "生成中" : "运行此节点"}
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
