"use client";

import { ArrowDown, ArrowUp, Link2, Replace, Unplug } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { CANVAS_LIMITS, type CanvasEdgeV1, type CanvasGenerationNodeV1, type CanvasGenerationParametersV1, type CanvasLocalNodeV1 } from "@/lib/canvas/contracts";
import { imageSizeLimits } from "@/lib/generation/sizes";

import type { CanvasActiveView } from "../canvas/controller-types";
import { CANVAS_PARAMETER_LABELS, canvasEditorKey, type CanvasEditorPort, type CanvasEditorTarget, type CanvasParameterField } from "../canvas/editor-state";
import { canvasNodeLabel, canvasSourceStatus, isCanvasSaveShortcut } from "../canvas/renderer-adapter";
import type { CanvasNodeActions } from "../canvas/renderer-types";
import { MODERATION_OPTIONS, OUTPUT_FORMAT_OPTIONS, QUALITY_OPTIONS, SIZE_OPTIONS } from "../constants";
import type { ChannelInfo } from "../types";
import { getSizeSelectValue } from "../utils";
import { CanvasSourceSummary } from "./canvas-node-picker";
import styles from "./canvas-stage.module.css";

export type CanvasNodeInspectorProps = {
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

type CommitFieldProps = {
  field: CanvasParameterField;
  editor: CanvasEditorPort;
  target: CanvasEditorTarget;
  value: string;
  placeholder?: string;
  inputMode?: "numeric" | "text";
  multiline?: boolean;
};

function CommitField({ field, editor, target, value, placeholder, inputMode, multiline = false }: CommitFieldProps) {
  const element = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const [composing, setComposing] = useState(false);
  const [focused, setFocused] = useState(false);
  const draft = editor.readDraft(target)?.fields[field];
  const text = draft?.text ?? value;
  const [input, setInput] = useState({ source: text, text });
  // A canonical refresh must not replace the native IME's selected text.
  if (input.source !== text && (!composing || !focused)) setInput({ source: text, text });
  const label = CANVAS_PARAMETER_LABELS[field];
  const focus = editor.state.focus;
  useEffect(() => {
    if (focus?.field === field && canvasEditorKey(focus.target) === canvasEditorKey(target)) element.current?.focus({ preventScroll: true });
    if (focus?.field === field && canvasEditorKey(focus.target) === canvasEditorKey(target)) element.current?.scrollIntoView?.({ block: "nearest" });
  }, [field, focus, target]);
  const commit = () => editor.commitField(target, field).ok;
  const props = {
    ref: element, "aria-label": label, "aria-invalid": draft?.invalid ?? false, value: input.text, placeholder, inputMode,
    onFocus: () => setFocused(true),
    onCompositionStart: () => setComposing(true),
    onCompositionEnd: () => setComposing(false),
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const next = event.target.value;
      editor.setField(target, field, next, value);
      setInput({ source: next, text: next });
    },
    onBlur: () => { setFocused(false); if (!composing) commit(); },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (!composing && !event.nativeEvent.isComposing && event.keyCode !== 229 && isCanvasSaveShortcut(event)) {
        if (!commit()) { event.preventDefault(); event.stopPropagation(); }
        return;
      }
      event.stopPropagation();
      if (!multiline && event.key === "Enter" && !composing && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); commit(); }
    },
  };
  return <label className={styles.field}><span>{label}</span>{multiline ? <textarea {...props} rows={3} /> : <input {...props} />}{draft && <span className={draft.invalid ? styles.problemText : styles.helpText} role={draft.invalid ? "alert" : undefined}>{draft.invalid ? "参数未应用，请检查输入" : "参数待应用，仅在本页保留"}</span>}</label>;
}

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

export function CanvasNodeInspector({ active, node, channels, editor, target, actions, onParameters, onConnect, onReplace, onDisconnect, onReorder, onOpenProviderSettings }: CanvasNodeInspectorProps) {
  const parameters = node.parameters;
  const draft = editor.readDraft(target);
  const customSize = draft?.customSize ?? getSizeSelectValue(parameters.size) === "custom";
  const fieldProps = { editor, target };
  const pickerProps = { active, actions };
  const inputs = active.scene.edges.filter((edge): edge is Extract<CanvasEdgeV1, { kind: "image-input" }> => edge.target === node.id && edge.kind === "image-input").sort((a, b) => a.ordinal - b.ordinal);
  const promptEdge = active.scene.edges.find((edge) => edge.target === node.id && edge.kind === "prompt-input");
  const prompt = active.scene.nodes.find((source) => source.id === promptEdge?.source);
  const channel = channels.find((item) => item.id === parameters.channelId);
  const models = channel?.models ?? [...new Set(channels.flatMap((item) => item.models))];
  const imageMode = inputs.length > 0;

  return (
    <div aria-label="生成节点参数与输入">
        <section className={styles.inspectorSection}>
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
        </section>
        <section className={styles.inspectorSection}>
          <h4>生成参数</h4>
          <div className={styles.providerToggle} role="group" aria-label="节点渠道来源">
            <button type="button" aria-pressed={parameters.providerMode === "built_in"} onClick={() => onParameters({ providerMode: "built_in" })}>平台渠道</button>
            <button type="button" aria-pressed={parameters.providerMode === "custom"} onClick={() => onParameters({ providerMode: "custom", channelId: null })}>自填 API</button>
          </div>
          {parameters.providerMode === "built_in" ? <>
            <label className={styles.field}><span>平台渠道</span><select aria-label="节点平台渠道" value={parameters.channelId ?? ""} onChange={(event) => {
              const next = channels.find((item) => item.id === event.target.value);
              onParameters(next ? { channelId: next.id, model: next.defaultModel } : { channelId: null });
            }}><option value="">自动选择渠道</option>{parameters.channelId && !channel && <option value={parameters.channelId}>已保存的渠道（当前不可用）</option>}{channels.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label className={styles.field}><span>模型</span><select aria-label="节点模型" value={parameters.model} onChange={(event) => { if (models.includes(event.target.value)) onParameters({ model: event.target.value }); }}>
              {!models.includes(parameters.model) && <option value={parameters.model}>{parameters.model}（已保存）</option>}{models.map((model) => <option key={model} value={model}>{model}</option>)}
            </select></label>
          </> : <>
            <CommitField {...fieldProps} field="model" value={parameters.model} />
            <button type="button" className={styles.smallButton} onClick={onOpenProviderSettings}>配置此节点的 API 凭据</button>
            <p className={styles.helpText}>凭据只在运行时提供，不保存在节点或画布中。</p>
          </>}
          {parameters.providerMode !== "custom" && draft?.fields.model && <CommitField {...fieldProps} field="model" value={parameters.model} />}
          <label className={styles.field}><span>输出尺寸</span><select aria-label="节点输出尺寸" value={customSize ? "custom" : getSizeSelectValue(parameters.size)} onChange={(event) => {
            const option = SIZE_OPTIONS.find((item) => item.value === event.target.value);
            if (!option) return;
            if (option.value === "custom") {
              editor.setCustomSize(target, true);
              if (parameters.size === "auto" && !draft?.fields.size) editor.setField(target, "size", "", "");
              return;
            }
            if (onParameters({ size: option.value })) { editor.clearField(target, "size"); editor.setCustomSize(target, false); }
          }}>{SIZE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}{option.detail ? ` · ${option.detail}` : ""}</option>)}</select></label>
          {(customSize || draft?.fields.size) && <><CommitField {...fieldProps} field="size" value={parameters.size} placeholder="例如 1536x1024" /><p className={styles.helpText}>宽高按 {imageSizeLimits.multiple}px 规整，最大边 {imageSizeLimits.maxEdge}px。</p></>}
          {imageMode ? <p className={styles.effectiveMode}>已连接图片：图生图每次固定输出 {CANVAS_LIMITS.imageOutputCount} 张。</p> : <label className={styles.field}><span>生成张数</span><select aria-label="节点生成张数" value={parameters.count} onChange={(event) => onParameters({ count: Number(event.target.value) })}>{Array.from({ length: CANVAS_LIMITS.textOutputCount }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} 张</option>)}</select></label>}
          <div className={styles.fieldPair}>
            <label className={styles.field}><span>质量</span><select aria-label="节点质量" value={parameters.quality} onChange={(event) => { const option = QUALITY_OPTIONS.find((item) => item.value === event.target.value); if (option) onParameters({ quality: option.value }); }}>{QUALITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label className={styles.field}><span>格式</span><select aria-label="节点输出格式" value={parameters.outputFormat} onChange={(event) => { const option = OUTPUT_FORMAT_OPTIONS.find((item) => item.value === event.target.value); if (option) onParameters({ outputFormat: option.value }); }}>{OUTPUT_FORMAT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          </div>
          {(parameters.outputFormat !== "png" || draft?.fields.outputCompression) && <CommitField {...fieldProps} field="outputCompression" value={String(parameters.outputCompression ?? 100)} inputMode="numeric" />}
          <label className={styles.field}><span>审核模式</span><select aria-label="节点审核模式" value={parameters.moderation} onChange={(event) => { const option = MODERATION_OPTIONS.find((item) => item.value === event.target.value); if (option) onParameters({ moderation: option.value }); }}>{MODERATION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          {(!imageMode || draft?.fields.negativePrompt) && <CommitField {...fieldProps} field="negativePrompt" value={parameters.negativePrompt ?? ""} multiline />}
          {(!imageMode || draft?.fields.seed) && <CommitField {...fieldProps} field="seed" value={parameters.seed === null ? "" : String(parameters.seed)} inputMode="numeric" placeholder="留空由模型决定" />}
          <p className={styles.helpText}>参数只属于此节点。运行后继续编辑，仅影响下一次手动运行。</p>
        </section>
    </div>
  );
}
