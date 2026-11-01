"use client";

import type { NodeProps } from "@xyflow/react";
import { TextCursorInput } from "lucide-react";

import { GENERATION_PROMPT_MAX_LENGTH } from "@/lib/generation/limits";
import { cn } from "@/lib/utils";

import { CANVAS_INPUT_CLASS, CANVAS_PORTS } from "../../canvas/renderer-constants";
import type { CanvasPromptFlowNode } from "../../canvas/renderer-types";
import styles from "../canvas-stage.module.css";
import { CanvasPromptField } from "../canvas-prompt-field";
import { CanvasNodeShell, CanvasPort } from "./node-shell";

export function CanvasPromptNode({ data, selected }: NodeProps<CanvasPromptFlowNode>) {
  const { node, readOnly, actions, previewOnly, editorOpen } = data;
  return (
    <CanvasNodeShell kind="prompt" selected={selected} readOnly={readOnly} previewOnly={previewOnly} onRemove={() => actions.removeNode(node.id)}>
      <div className={styles.nodeBody}>
        <p className={styles.nodeEyebrow}><TextCursorInput aria-hidden className="size-3.5" /> 描述你的画面</p>
        {readOnly || previewOnly || editorOpen ? (
          <p tabIndex={previewOnly ? undefined : 0} className={cn(!previewOnly && CANVAS_INPUT_CLASS, styles.promptText, previewOnly && styles.previewText)} onKeyDown={(event) => event.stopPropagation()}>{node.text || "尚未填写提示词"}</p>
        ) : (
          <CanvasPromptField value={node.text} onChange={(text) => actions.updatePrompt(node.id, text)} />
        )}
        <div className={styles.nodeFootnote}><span>连接到生成节点</span><span>{node.text.length} / {GENERATION_PROMPT_MAX_LENGTH}</span></div>
      </div>
      <CanvasPort id={CANVAS_PORTS.promptOutput} type="source" label="提示词输出" variant="prompt" readOnly={readOnly || Boolean(previewOnly)} />
    </CanvasNodeShell>
  );
}
