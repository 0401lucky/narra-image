"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { CANVAS_LIMITS } from "@/lib/canvas/contracts";
import { imageSizeLimits } from "@/lib/generation/sizes";

import { CANVAS_PARAMETER_LABELS, canvasEditorKey, type CanvasEditorPort, type CanvasEditorTarget, type CanvasParameterField } from "../canvas/editor-state";
import { isCanvasSaveShortcut } from "../canvas/renderer-adapter";
import { MODERATION_OPTIONS, OUTPUT_FORMAT_OPTIONS, QUALITY_OPTIONS, SIZE_OPTIONS } from "../constants";
import { getSizeSelectValue } from "../utils";
import type { CanvasNodeInspectorProps } from "./canvas-node-inspector";
import styles from "./canvas-stage.module.css";

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

type CanvasGenerationSettingsProps = Pick<CanvasNodeInspectorProps, "active" | "node" | "channels" | "editor" | "target" | "onParameters" | "onOpenProviderSettings"> & { children: ReactNode };

export function CanvasGenerationSettings({ active, node, channels, editor, target, onParameters, onOpenProviderSettings, children }: CanvasGenerationSettingsProps) {
  const parameters = node.parameters;
  const draft = editor.readDraft(target);
  const customSize = draft?.customSize ?? getSizeSelectValue(parameters.size) === "custom";
  const fieldProps = { editor, target };
  const channel = channels.find((item) => item.id === parameters.channelId);
  const models = channel?.models ?? [...new Set(channels.flatMap((item) => item.models))];
  const imageMode = active.scene.edges.some((edge) => edge.kind === "image-input" && edge.target === node.id);
  const advanced = useRef<HTMLDetailsElement>(null);
  const focus = editor.state.focus;
  useLayoutEffect(() => {
    // Open the native disclosure before CommitField's focus/scroll effects.
    if (advanced.current && focus && canvasEditorKey(focus.target) === canvasEditorKey(target) && !["model", "size"].includes(focus.field)) advanced.current.open = true;
  }, [focus, target]);

  return <section aria-label="生成节点参数与输入" className={styles.generationSettings}>
    <div className={styles.compactParameters}>
      {parameters.providerMode === "custom" ? <CommitField {...fieldProps} field="model" value={parameters.model} /> :
        <label className={styles.field}><span>模型</span><select aria-label="节点模型" value={parameters.model} onChange={(event) => { if (models.includes(event.target.value)) onParameters({ model: event.target.value }); }}>
          {!models.includes(parameters.model) && <option value={parameters.model}>{parameters.model}</option>}{models.map((model) => <option key={model} value={model}>{model}</option>)}
        </select></label>}
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
    </div>
    {parameters.providerMode !== "custom" && draft?.fields.model && <CommitField {...fieldProps} field="model" value={parameters.model} />}
    {(customSize || draft?.fields.size) && <><CommitField {...fieldProps} field="size" value={parameters.size} placeholder="例如 1536x1024" /><p className={styles.helpText}>宽高按 {imageSizeLimits.multiple}px 规整，最大边 {imageSizeLimits.maxEdge}px。</p></>}
    <details ref={advanced} className={styles.advancedSettings}>
      <summary>更多设置与连接</summary>
      <div className={styles.providerToggle} role="group" aria-label="节点渠道来源">
        <button type="button" aria-pressed={parameters.providerMode === "built_in"} onClick={() => onParameters({ providerMode: "built_in" })}>平台渠道</button>
        <button type="button" aria-pressed={parameters.providerMode === "custom"} onClick={() => onParameters({ providerMode: "custom", channelId: null })}>自填 API</button>
      </div>
      {parameters.providerMode === "built_in" ?
        <label className={styles.field}><span>平台渠道</span><select aria-label="节点平台渠道" value={parameters.channelId ?? ""} onChange={(event) => {
          const next = channels.find((item) => item.id === event.target.value);
          onParameters(next ? { channelId: next.id, model: next.defaultModel } : { channelId: null });
        }}><option value="">自动选择渠道</option>{parameters.channelId && !channel && <option value={parameters.channelId}>已保存的渠道（当前不可用）</option>}{channels.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> :
        <><button type="button" className={styles.smallButton} onClick={onOpenProviderSettings}>配置此节点的 API 凭据</button><p className={styles.helpText}>凭据只在运行时提供，不保存在节点或画布中。</p></>}
      {imageMode ? <p className={styles.effectiveMode}>已连接图片：图生图每次固定输出 {CANVAS_LIMITS.imageOutputCount} 张。</p> : <label className={styles.field}><span>生成张数</span><select aria-label="节点生成张数" value={parameters.count} onChange={(event) => onParameters({ count: Number(event.target.value) })}>{Array.from({ length: CANVAS_LIMITS.textOutputCount }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} 张</option>)}</select></label>}
      <div className={styles.fieldPair}>
        <label className={styles.field}><span>质量</span><select aria-label="节点质量" value={parameters.quality} onChange={(event) => { const option = QUALITY_OPTIONS.find((item) => item.value === event.target.value); if (option) onParameters({ quality: option.value }); }}>{QUALITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label className={styles.field}><span>格式</span><select aria-label="节点输出格式" value={parameters.outputFormat} onChange={(event) => { const option = OUTPUT_FORMAT_OPTIONS.find((item) => item.value === event.target.value); if (option) onParameters({ outputFormat: option.value }); }}>{OUTPUT_FORMAT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      </div>
      {(parameters.outputFormat !== "png" || draft?.fields.outputCompression) && <CommitField {...fieldProps} field="outputCompression" value={String(parameters.outputCompression ?? 100)} inputMode="numeric" />}
      <label className={styles.field}><span>审核模式</span><select aria-label="节点审核模式" value={parameters.moderation} onChange={(event) => { const option = MODERATION_OPTIONS.find((item) => item.value === event.target.value); if (option) onParameters({ moderation: option.value }); }}>{MODERATION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      {(!imageMode || draft?.fields.negativePrompt) && <CommitField {...fieldProps} field="negativePrompt" value={parameters.negativePrompt ?? ""} multiline />}
      {(!imageMode || draft?.fields.seed) && <CommitField {...fieldProps} field="seed" value={parameters.seed === null ? "" : String(parameters.seed)} inputMode="numeric" placeholder="留空由模型决定" />}
      {children}
    </details>
  </section>;
}
