"use client";

import { useEffect, useRef, useState } from "react";

import { HOME_MOTION } from "../constants";
import { useHomeMotion } from "./use-home-motion";

// 三组展示数字共用一条有截止的 rAF；首屏 SSR 为最终值，后台不推进时间。
export function useHomeCountUp(visible: boolean): number {
  const motion = useHomeMotion();
  const [progress, setProgress] = useState(1);
  const elapsed = useRef(0);
  const complete = useRef(false);

  useEffect(() => {
    if (motion.reducedMotion || motion.paused) {
      complete.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProgress(1);
      return;
    }
    if (!motion.enabled || !visible || complete.current) return;
    let frame: number;
    let disposed = false;
    let previous: number | null = null;
    const step = (time: number) => {
      if (disposed) return;
      if (previous !== null) elapsed.current += Math.max(0, time - previous);
      previous = time;
      const linear = Math.min(1, elapsed.current / HOME_MOTION.countUpMs);
      setProgress(1 - Math.pow(1 - linear, 3));
      complete.current = linear >= 1;
      if (!complete.current) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
    };
  }, [motion.enabled, motion.paused, motion.reducedMotion, visible]);

  return motion.reducedMotion || motion.paused ? 1 : progress;
}
