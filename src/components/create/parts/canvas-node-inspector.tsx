"use client";

import { ArrowDown, ArrowUp, Link2, Replace, Unplug } from "lucide-react";
import { useState } from "react";

import { CANVAS_LIMITS, type CanvasEdgeV1, type CanvasGenerationNodeV1, type CanvasGenerationParametersV1, type CanvasLocalNodeV1 } from "@/lib/canvas/contracts";

import type { CanvasActiveView } from "../canvas/controller-types";
import { type CanvasEditorPort, type CanvasEditorTarget } from "../canvas/editor-state";
import { canvasNodeLabel, canvasSourceStatus } from "../canvas/renderer-adapter";
import type { CanvasNodeActions } from "../canvas/renderer-types";
import type { ChannelInfo } from "../types";
import { CanvasSourceSummary } from "./canvas-node-picker";
import styles from "./canvas-stage.module.css";

export type CanvasNodeInspectorProps = {
  contextual?: boolean;
  active: CanvasActiveView;
  node: CanvasGenerationNodeV1;
  channels: readonly ChannelInfo[];
  editor: CanvasEditorPort;
  target: CanvasEditorTarget;
  actions: CanvasNodeActions;
  onParameters: (patch: Partial<CanvasGenerationParametersV1>) => boolean;
  onConnect: (sourceId: string) => boolean;
  onReplace: (edgeId: string, sourceId: string) => boolean;
  onDisconnect: (edgeId: string) => void;
  onReorder: (sourceIds: string[]) => void;
  onOpenProviderSettings: () => void;
};

type ConnectionPickerProps = { label: string; candidates: CanvasLocalNodeV1[]; active: CanvasActiveView; actions: CanvasNodeActions; onConnect: (sourceId: string) => boolean; disabled?: boolean; replacing?: boolean };
function ConnectionPicker({ label, candidates, active, actions, onConnect, disabled = false, replacing = false }: ConnectionPickerProps) {
  const [sourceId, setSourceId] = useState("");
  const source = candidates.find((node) => node.id === sourceId);
  return <div><div className={styles.connectionPicker}>
    <select aria-label={label} value={sourceId} disabled={disabled || candidates.length === 0} onChange={(event) => setSourceId(event.target.value)}>
      <option value="">{candidates.length ? label : "请先添加输入节点"}</option>
      {candidates.map((source) => <option key={source.id} value={source.id}>{canvasNodeLabel(source)} · {canvasSourceStatus(active, source)}</option>)}
    </select>
    <button type="button" aria-label={`${replacing ? "确认" : "连接"}${label}`} className={styles.smallButton} disabled={disabled || !source} onClick={() => { if (onConnect(sourceId)) setSourceId(""); }}>{replacing ? <Replace aria-hidden className="size-3.5" /> : <Link2 aria-hidden className="size-3.5" />}</button>
  </div>{source && <CanvasSourceSummary active={active} node={source} actions={actions} />}</div>;
}

export function CanvasNodeInspector({ contextual = false, active, node, actions, onConnect, onReplace, onDisconnect, onReorder }: CanvasNodeInspectorProps) {
  const pickerProps = { active, actions };
  const inputs = active.scene.edges.filter((edge): edge is Extract<CanvasEdgeV1, { kind: "image-input" }> => edge.target === node.id && edge.kind === "image-input").sort((a, b) => a.ordinal - b.ordinal);
  const promptEdge = active.scene.edges.find((edge) => edge.target === node.id && edge.kind === "prompt-input");
  const prompt = active.scene.nodes.find((source) => source.id === promptEdge?.source);
  return (
        <details className={styles.inspectorSection} open={contextual ? undefined : true}>
          <summary>高级连接 · 提示词来源与参考顺序</summary>
          <h4>直接输入</h4>
          <p className={styles.helpText}>连接只提供输入。运行按钮只执行当前节点，不运行整张图。</p>
          <label className={styles.field}><span>提示词 · 恰好一个</span></label>
          {prompt && promptEdge ? <><div className={styles.connectedPrompt}><span>{canvasNodeLabel(prompt)}</span><button type="button" className={styles.iconButton} aria-label="断开提示词输入" onClick={() => onDisconnect(promptEdge.id)}><Unplug aria-hidden className="size-3.5" /></button></div>
            <ConnectionPicker {...pickerProps} replacing label="替换提示词来源" candidates={active.scene.nodes.filter((source) => source.kind === "prompt" && source.id !== prompt.id)} onConnect={(sourceId) => onReplace(promptEdge.id, sourceId)} /></>
            : <ConnectionPicker {...pickerProps} label="选择提示词" candidates={active.scene.nodes.filter((source) => source.kind === "prompt")} onConnect={onConnect} />}
          <div className={styles.inputListHeading}><span>参考顺序</span><span>{inputs.length} / {CANVAS_LIMITS.referencesPerRun}</span></div>
          <ol className={styles.orderedInputs} aria-label="有序参考图输入">
            {inputs.map((edge, index) => {
              const source = active.scene.nodes.find((item) => item.id === edge.source);
              const unavailable = source?.kind === "reference" ? active.references[source.id]?.state === "missing" : source?.kind === "result" ? !active.images[source.imageId] : true;
              const move = (direction: -1 | 1) => {
                const ordered = inputs.map((item) => item.source);
                [ordered[index], ordered[index + direction]] = [ordered[index + direction], ordered[index]];
                onReorder(ordered);
              };
              return <li key={edge.id}>
                <span className={styles.ordinal}>{edge.ordinal}</span><span className={styles.inputName}>{source ? canvasNodeLabel(source) : "输入节点缺失"}{unavailable && <small className={styles.problemText}>图片尚不可用</small>}</span>
                <button type="button" className={styles.iconButton} aria-label={`上移参考图 ${edge.ordinal}`} disabled={index === 0} onClick={() => move(-1)}><ArrowUp aria-hidden className="size-3" /></button>
                <button type="button" className={styles.iconButton} aria-label={`下移参考图 ${edge.ordinal}`} disabled={index === inputs.length - 1} onClick={() => move(1)}><ArrowDown aria-hidden className="size-3" /></button>
                <button type="button" className={styles.iconButton} aria-label={`断开参考图 ${edge.ordinal}`} onClick={() => onDisconnect(edge.id)}><Unplug aria-hidden className="size-3" /></button>
                <div className={styles.inputReplacement}><ConnectionPicker {...pickerProps} replacing label={`替换参考图 ${edge.ordinal} 来源`} candidates={active.scene.nodes.filter((candidate) => (candidate.kind === "reference" || candidate.kind === "result") && candidate.id !== edge.source)} onConnect={(sourceId) => onReplace(edge.id, sourceId)} /></div>
              </li>;
            })}
          </ol>
          <ConnectionPicker {...pickerProps} label="选择参考图或结果" candidates={active.scene.nodes.filter((source) => (source.kind === "reference" || source.kind === "result") && !inputs.some((edge) => edge.source === source.id))} onConnect={onConnect} disabled={inputs.length >= CANVAS_LIMITS.referencesPerRun} />
          <p className={styles.helpText}>序号决定输入顺序。旧结果可以连回原生成节点。</p>
        </details>
  );
}
