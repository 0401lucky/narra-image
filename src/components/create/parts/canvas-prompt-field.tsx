"use client";

import { useState } from "react";

import { GENERATION_PROMPT_MAX_LENGTH } from "@/lib/generation/limits";
import { cn } from "@/lib/utils";

import { isCanvasSaveShortcut } from "../canvas/renderer-adapter";
import { CANVAS_INPUT_CLASS } from "../canvas/renderer-constants";
import styles from "./canvas-stage.module.css";

type CanvasPromptFieldProps = { value: string; onChange: (text: string) => boolean; label?: string; onFocus?: () => void; onBlur?: () => void };

export function CanvasPromptField({ value, onChange, label = "节点提示词", onFocus, onBlur }: CanvasPromptFieldProps) {
  const [composing, setComposing] = useState(false);
  const [focused, setFocused] = useState(false);
  const [input, setInput] = useState({ source: value, text: value, pending: [] as string[] });
  // Flow's passive projection may trail a native input event. Acknowledgements
  // never write an older value over a focused/composing local input.
  if (input.source !== value) {
    const acknowledgement = input.pending.lastIndexOf(value);
    if (acknowledgement >= 0) setInput({ source: value, text: input.text, pending: input.pending.slice(acknowledgement + 1) });
    else if (!composing || !focused) setInput({ source: value, text: value, pending: [] });
  }
  const accept = (text: string) => {
    if (onChange(text)) setInput((current) => ({ source: value, text, pending: current.text === text ? current.pending : [...current.pending, text] }));
  };
  return <textarea aria-label={label} value={input.text} maxLength={GENERATION_PROMPT_MAX_LENGTH} rows={5}
    className={cn(CANVAS_INPUT_CLASS, styles.promptInput)} placeholder="光线、构图、主体与风格……"
    onFocus={() => { setFocused(true); onFocus?.(); }}
    onBlur={() => { setFocused(false); onBlur?.(); }}
    onCompositionStart={() => setComposing(true)}
    onCompositionEnd={(event) => { setComposing(false); accept(event.currentTarget.value); }}
    onChange={(event) => accept(event.target.value)}
    onKeyDown={(event) => { if (composing || event.nativeEvent.isComposing || event.keyCode === 229 || !isCanvasSaveShortcut(event)) event.stopPropagation(); }}
    onWheel={(event) => event.stopPropagation()} />;
}
