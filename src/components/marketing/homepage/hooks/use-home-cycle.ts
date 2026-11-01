"use client";

import { useEffect, useState } from "react";

import { HOME_MOTION } from "../constants";
import { useHomeMotion } from "./use-home-motion";

// 词胶囊和版本节点共用有界定时器；离屏或切到后台时完全停止调度。
export function useHomeCycle(length: number, visible: boolean): number {
  const { enabled } = useHomeMotion();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!enabled || !visible || length < 2) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      if (disposed) return;
      setIndex((current) => (current + 1) % length);
      timer = setTimeout(step, HOME_MOTION.capabilityCycleMs);
    };
    timer = setTimeout(step, HOME_MOTION.capabilityCycleMs);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [enabled, length, visible]);

  return index;
}
