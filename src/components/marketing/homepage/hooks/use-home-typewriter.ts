"use client";

import { useEffect, useRef, useState } from "react";

import { HOME_MOTION } from "../constants";
import { useHomeMotion } from "./use-home-motion";

type UseHomeTypewriterOptions = { text: string; identity: string; visible: boolean };
type UseHomeTypewriterResult = { visualText: string; typing: boolean };

// 完整文本留给可访问内容和复制；逐字文本只是可随时停止的视觉表现。
export function useHomeTypewriter({ text, identity, visible }: UseHomeTypewriterOptions): UseHomeTypewriterResult {
  const motion = useHomeMotion();
  const [display, setDisplay] = useState({ identity, text, typing: false });
  const run = useRef({ identity, text, index: 0, complete: false });

  useEffect(() => {
    if (run.current.identity !== identity || run.current.text !== text) {
      run.current = { identity, text, index: 0, complete: false };
    }
    if (motion.reducedMotion || motion.paused) {
      run.current.complete = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDisplay({ identity, text, typing: false });
      return;
    }
    if (!motion.enabled || !visible || run.current.complete) return;
    const characters = Array.from(text);
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setDisplay({ identity, text: characters.slice(0, run.current.index).join(""), typing: true });
    const step = () => {
      if (disposed) return;
      run.current.index += 1;
      run.current.complete = run.current.index >= characters.length;
      setDisplay({ identity, text: characters.slice(0, run.current.index).join(""), typing: !run.current.complete });
      if (!run.current.complete) timer = setTimeout(step, HOME_MOTION.typewriterMs);
    };
    timer = setTimeout(step, HOME_MOTION.typewriterMs);
    return () => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [identity, motion.enabled, motion.paused, motion.reducedMotion, text, visible]);

  if (display.identity !== identity || motion.reducedMotion || motion.paused) {
    return { visualText: text, typing: false };
  }
  return { visualText: display.text, typing: display.typing && motion.enabled && visible };
}
