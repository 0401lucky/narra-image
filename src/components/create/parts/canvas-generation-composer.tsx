"use client";

import { ArrowDown, ArrowUp, ImagePlus, Replace, Unplug } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { CANVAS_IMPORT_IMAGE_TYPES, CANVAS_LIMITS, type CanvasGenerationNodeV1 } from "@/lib/canvas/contracts";

import type { CanvasController } from "../canvas/controller";
import { canvasSourceStatus } from "../canvas/renderer-adapter";
import { CanvasSourceSummary } from "./canvas-node-picker";
import { CanvasPromptField } from "./canvas-prompt-field";
import type { CanvasNodeInspectorProps } from "./canvas-node-inspector";
import styles from "./canvas-stage.module.css";

type CanvasGenerationComposerProps = Pick<CanvasNodeInspectorProps, "active" | "target" | "actions" | "onConnect" | "onDisconnect" | "onReorder"> & {
  node: CanvasGenerationNodeV1;
  controller: CanvasController;
  readOnly: boolean;
  onCaptureImport: () => (files: File[]) => void;
  onReplaceSource: (edgeId: string, source: string, expectedSource: string) => boolean;
};
type PickerIntent = { edgeId: string; expectedSource: string } | { edgeId?: never; expectedSource?: never };

export function CanvasGenerationComposer({ active, node, target, actions, controller, readOnly, onConnect, onDisconnect, onReorder, onCaptureImport, onReplaceSource }: CanvasGenerationComposerProps) {
  const edge = active.scene.edges.find((item) => item.kind === "prompt-input" && item.target === node.id);
  const prompt = active.scene.nodes.find((item) => item.id === edge?.source && item.kind === "prompt");
  const shared = edge ? active.scene.edges.filter((item) => item.kind === "prompt-input" && item.source === edge.source).length : 0;
  const binding = useRef<string | null>(edge?.source ?? null);
  const promptFocused = useRef(false);
  useLayoutEffect(() => { if (!promptFocused.current) binding.current = edge?.source ?? null; }, [edge?.source]);
  const fileInput = useRef<HTMLInputElement>(null);
  const chooser = useRef<((files: File[]) => void) | null>(null);
  const [picker, setPicker] = useState<PickerIntent | null>(null);
  useEffect(() => {
    const input = fileInput.current;
    const cancel = () => { chooser.current = null; };
    input?.addEventListener("cancel", cancel);
    return () => { input?.removeEventListener("cancel", cancel); cancel(); };
  }, [controller, target.ownerId, target.canvasId, target.nodeId, readOnly]);
  const inputs = active.scene.edges.filter((item) => item.kind === "image-input" && item.target === node.id).sort((a, b) => (a.kind === "image-input" ? a.ordinal : 0) - (b.kind === "image-input" ? b.ordinal : 0));
  const sources = active.scene.nodes.filter((item) => item.kind === "reference" || item.kind === "result");
  return <section className={styles.composerPrimary} aria-label="图片创作">
    <h4>描述你想创作的画面</h4>
    {shared > 1 && <p className={styles.sharedPrompt} role="status">共享提示词 · {shared} 个生成节点使用此来源。编辑会同步影响它们的下一次运行。</p>}
    {readOnly ? <p className={styles.promptText}>{prompt?.kind === "prompt" ? prompt.text : "尚未填写提示词"}</p> : <CanvasPromptField label="创作提示词" value={prompt?.kind === "prompt" ? prompt.text : ""}
      onFocus={() => { promptFocused.current = true; }} onBlur={() => { promptFocused.current = false; binding.current = edge?.source ?? null; }} onChange={(text) => {
      try {
        const accepted = controller.updateGenerationPrompt(target.canvasId, target.nodeId, { text, expectedPromptNodeId: binding.current });
        // A repaired source is acknowledged before a second native input event.
        binding.current = accepted.promptNodeId;
        return true;
      } catch (error) { actions.reportError(error); return false; }
    }} />}
    <p className={styles.helpText}>文字即时存入本地草稿。Enter 换行，只有点击运行才会生成。</p>
    <div className={styles.inputListHeading}><h4>参考图</h4><span>{inputs.length} / {CANVAS_LIMITS.referencesPerRun}</span></div>
    <ol className={styles.referenceThumbnails} aria-label="参考图缩略图与顺序">
      {inputs.map((input, index) => {
        const source = sources.find((item) => item.id === input.source);
        const ordinal = index + 1;
        return <li key={input.id}><span className={styles.ordinal}>{ordinal}</span>{source ? <CanvasSourceSummary active={active} node={source} actions={actions} /> : <span>输入节点缺失</span>}
          {!readOnly && <div className={styles.nodeActions}>
            <button type="button" className={styles.iconButton} aria-label={`上移缩略参考图 ${ordinal}`} disabled={index === 0} onClick={() => { const order = inputs.map((item) => item.source); [order[index], order[index - 1]] = [order[index - 1], order[index]]; onReorder(order); }}><ArrowUp aria-hidden className="size-3" /></button>
            <button type="button" className={styles.iconButton} aria-label={`下移缩略参考图 ${ordinal}`} disabled={index === inputs.length - 1} onClick={() => { const order = inputs.map((item) => item.source); [order[index], order[index + 1]] = [order[index + 1], order[index]]; onReorder(order); }}><ArrowDown aria-hidden className="size-3" /></button>
            <button type="button" className={styles.iconButton} aria-label={`替换缩略参考图 ${ordinal}`} onClick={() => setPicker({ edgeId: input.id, expectedSource: input.source })}><Replace aria-hidden className="size-3" /></button>
            <button type="button" className={styles.iconButton} aria-label={`移除缩略参考图 ${ordinal}`} onClick={() => onDisconnect(input.id)}><Unplug aria-hidden className="size-3" /></button>
          </div>}
        </li>;
      })}
    </ol>
    {!readOnly && <div className={styles.nodeActions}>
      <button type="button" className={styles.smallButton} disabled={inputs.length >= CANVAS_LIMITS.referencesPerRun} onClick={() => setPicker({})}>从画布选择</button>
      <button type="button" className={styles.smallButton} disabled={inputs.length >= CANVAS_LIMITS.referencesPerRun} onClick={() => { chooser.current = onCaptureImport(); fileInput.current?.click(); }}><ImagePlus aria-hidden className="size-4" />导入并连接</button>
      <input ref={fileInput} type="file" multiple accept={CANVAS_IMPORT_IMAGE_TYPES.join(",")} className="hidden" aria-label="导入生成节点参考图文件" onChange={(event) => {
        const files = Array.from(event.currentTarget.files ?? []), captured = chooser.current;
        event.currentTarget.value = ""; chooser.current = null;
        if (files.length) captured?.(files);
      }} />
    </div>}
    {picker && !readOnly && <section className={styles.thumbnailPicker} aria-label="选择参考图缩略图"><div className={styles.inputListHeading}><h4>{picker.edgeId ? "替换参考图" : "选择画布图片"}</h4><button type="button" className={styles.smallButton} onClick={() => setPicker(null)}>取消选择</button></div>
      {sources.length ? sources.map((source) => {
        const available = source.kind === "reference" ? ["ready", "local"].includes(active.references[source.id]?.state ?? "missing") : source.kind === "result" && Boolean(active.images[source.imageId]?.url) && active.images[source.imageId]?.id === source.imageId && active.images[source.imageId]?.jobId === source.jobId;
        const used = inputs.some((input) => input.source === source.id);
        return <button key={source.id} type="button" className={styles.thumbnailChoice} disabled={!available || used} aria-label={`选择参考 ${source.id.slice(-6)} · ${canvasSourceStatus(active, source)}`} onClick={() => {
          const ok = picker.edgeId ? onReplaceSource(picker.edgeId, source.id, picker.expectedSource) : onConnect(source.id);
          if (ok) setPicker(null);
        }}><CanvasSourceSummary active={active} node={source} actions={actions} /></button>;
      }) : <p className={styles.helpText}>画布还没有图片，可以导入原图。</p>}
    </section>}
  </section>;
}
