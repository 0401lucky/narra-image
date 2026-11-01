"use client";

// 仅测量可见区域：软键盘/旋转只更新 CSS，不更新权限、场景相机或节点身份。
import { useEffect, useMemo, useState, type CSSProperties, type RefObject } from "react";

import { canvasVisibleBounds, type CanvasVisibleBounds } from "../canvas/mobile-interaction";

type CanvasViewportResult = { bounds: CanvasVisibleBounds | null; style: CSSProperties };
export function useCanvasMobileViewport(scope?: RefObject<HTMLElement | null>, enabled = true): CanvasViewportResult {
  const [bounds, setBounds] = useState<CanvasVisibleBounds | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let frame: number | null = null;
    let alive = true;
    const viewport = window.visualViewport;
    const measure = () => {
      frame = null;
      if (!alive) return;
      const rect = scope?.current?.getBoundingClientRect();
      const next = canvasVisibleBounds(rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : null, viewport ?? null,
        { width: window.innerWidth, height: window.innerHeight });
      setBounds((old) => old && old.top === next.top && old.left === next.left && old.width === next.width && old.height === next.height ? old : next);
    };
    const schedule = () => { if (frame === null) frame = window.requestAnimationFrame(measure); };
    schedule();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    if (scope?.current) observer?.observe(scope.current);
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    window.addEventListener("scroll", schedule, true);
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    return () => {
      alive = false;
      if (frame !== null) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      window.removeEventListener("scroll", schedule, true);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
    };
  }, [enabled, scope]);
  const style = useMemo((): CSSProperties => bounds ? {
    "--canvas-visible-top": `${bounds.top}px`, "--canvas-visible-left": `${bounds.left}px`,
    "--canvas-visible-width": `${bounds.width}px`, "--canvas-visible-height": `${bounds.height}px`,
    "--canvas-panel-height": `${Math.min(bounds.height, 576, bounds.height < 480 ? bounds.height : Math.max(320, bounds.height * 0.72))}px`,
  } as CSSProperties : {}, [bounds]);
  return { bounds, style };
}
