"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { HOME_MOTION } from "../constants";

type ClipboardStatus = "idle" | "copying" | "copied" | "manual";
type UsePromptClipboardOptions = { text: string; identity: string };
type UsePromptClipboardResult = { copy: () => Promise<void>; status: ClipboardStatus; reset: () => void };

// 复制完整原文；场景/作品切换与卸载使旧 Promise 失效，不让迟到反馈串到另一张卡片。
export function usePromptClipboard({ text, identity }: UsePromptClipboardOptions): UsePromptClipboardResult {
  const [feedback, setFeedback] = useState<{ identity: string; text: string; status: ClipboardStatus }>({ identity, text, status: "idle" });
  const current = useRef({ identity, text });
  const epoch = useRef(0);
  const mounted = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<(() => void) | null>(null);

  const clearFeedbackTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    pending.current?.();
    pending.current = null;
  }, []);

  useLayoutEffect(() => {
    current.current = { identity, text };
    epoch.current += 1;
    clearFeedbackTimer();
    // Returning to an earlier identity must not restore its stale copied/manual state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFeedback({ identity, text, status: "idle" });
  }, [clearFeedbackTimer, identity, text]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      epoch.current += 1;
      clearFeedbackTimer();
    };
  }, [clearFeedbackTimer]);

  const reset = useCallback(() => {
    epoch.current += 1;
    clearFeedbackTimer();
    setFeedback({ ...current.current, status: "idle" });
  }, [clearFeedbackTimer]);

  const copy = useCallback(async () => {
    const captured = { identity, text };
    const ticket = ++epoch.current;
    clearFeedbackTimer();
    const isCurrent = () => mounted.current && epoch.current === ticket
      && current.current.identity === captured.identity && current.current.text === captured.text;
    setFeedback({ ...captured, status: "copying" });
    const outcome = await new Promise<"copied" | "manual" | null>((resolve) => {
      let settled = false;
      let deadline: ReturnType<typeof setTimeout> | null = null;
      const finish = (result: "copied" | "manual" | null) => {
        if (settled) return;
        settled = true;
        if (deadline !== null) clearTimeout(deadline);
        pending.current = null;
        resolve(result);
      };
      pending.current = () => finish(null);
      deadline = setTimeout(() => finish("manual"), HOME_MOTION.clipboardDeadlineMs);
      try {
        if (!navigator.clipboard?.writeText) { finish("manual"); return; }
        navigator.clipboard.writeText(captured.text).then(() => finish("copied"), () => finish("manual"));
      } catch {
        finish("manual");
      }
    });
    if (!outcome || !isCurrent()) return;
    if (outcome === "copied") {
      setFeedback({ ...captured, status: "copied" });
      timer.current = setTimeout(() => {
        timer.current = null;
        if (isCurrent()) setFeedback({ ...captured, status: "idle" });
      }, HOME_MOTION.clipboardFeedbackMs);
    } else {
      setFeedback({ ...captured, status: "manual" });
    }
  }, [clearFeedbackTimer, identity, text]);

  return { copy, reset, status: feedback.identity === identity && feedback.text === text ? feedback.status : "idle" };
}
