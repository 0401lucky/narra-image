"use client";

import { useEffect, useRef, type RefObject } from "react";

import { useHomeMotion } from "./use-home-motion";

type UsePointerDepthOptions = {
  enabled: boolean;
  maxTilt?: number;
  perspective?: number;
};

// 只在精细指针事件后安排一帧，移出/暂停立即复位；不建立每卡空转循环。
export function usePointerDepth<T extends HTMLElement>({
  enabled,
  maxTilt = 4.5,
  perspective = 1200,
}: UsePointerDepthOptions): RefObject<T | null> {
  const ref = useRef<T>(null);
  const motion = useHomeMotion();

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let frame: number | null = null;
    let disposed = false;
    let clientX = 0;
    let clientY = 0;
    element.style.setProperty("--pointer-perspective", `${perspective}px`);

    function reset() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      element!.dataset.pointerActive = "false";
      element!.style.setProperty("--rotate-x", "0deg");
      element!.style.setProperty("--rotate-y", "0deg");
      element!.style.setProperty("--pointer-x", "0");
      element!.style.setProperty("--pointer-y", "0");
      for (const key of ["--mouse-x", "--mouse-y", "--glare-x", "--glare-y"]) {
        element!.style.setProperty(key, "50%");
      }
    }

    function paint() {
      frame = null;
      if (disposed) return;
      const rect = element!.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      element!.dataset.pointerActive = "true";
      element!.style.setProperty("--pointer-x", (x * 2 - 1).toFixed(4));
      element!.style.setProperty("--pointer-y", (y * 2 - 1).toFixed(4));
      element!.style.setProperty("--rotate-x", `${((y * 2 - 1) * -maxTilt).toFixed(2)}deg`);
      element!.style.setProperty("--rotate-y", `${((x * 2 - 1) * maxTilt).toFixed(2)}deg`);
      for (const key of ["--mouse-x", "--glare-x"]) element!.style.setProperty(key, `${(x * 100).toFixed(2)}%`);
      for (const key of ["--mouse-y", "--glare-y"]) element!.style.setProperty(key, `${(y * 100).toFixed(2)}%`);
    }

    function move(event: PointerEvent) {
      if (event.pointerType === "touch" || disposed) return;
      clientX = event.clientX;
      clientY = event.clientY;
      if (frame === null) frame = requestAnimationFrame(paint);
    }

    reset();
    if (enabled && motion.enabled && motion.finePointer) {
      element.addEventListener("pointermove", move, { passive: true });
      element.addEventListener("pointerleave", reset);
      element.addEventListener("pointercancel", reset);
    }
    return () => {
      disposed = true;
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerleave", reset);
      element.removeEventListener("pointercancel", reset);
      reset();
    };
  }, [enabled, maxTilt, motion.enabled, motion.finePointer, perspective]);

  return ref;
}
