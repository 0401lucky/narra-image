"use client";

import { useEffect, useState, type CSSProperties, type RefObject } from "react";

import { canvasComposerPlacement } from "../canvas/composer-placement";

// Keep the editor outside Flow's scaled tree, with one stable native input tree.
export function useCanvasComposerPlacement(viewport: RefObject<HTMLDivElement | null>, nodeId: string | undefined, touch: boolean, layoutIdentity: string, cameraIdentity: string): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties>();
  useEffect(() => {
    const element = viewport.current;
    if (!element || !nodeId) return;
    let node: HTMLElement | null = null;
    const region = touch ? element.closest("section") ?? element : element;
    const update = () => {
      const current = Array.from(element.querySelectorAll<HTMLElement>(".react-flow__node")).find((item) => item.dataset.id === nodeId) ?? null;
      if (current !== node) {
        if (node) observer.unobserve(node);
        node = current;
        if (node) observer.observe(node);
      }
      const rect = region.getBoundingClientRect();
      const visible = window.visualViewport;
      const left = Math.max(rect.left, visible?.offsetLeft ?? 0), top = Math.max(rect.top, visible?.offsetTop ?? 0);
      const right = Math.min(rect.right, (visible?.offsetLeft ?? 0) + (visible?.width ?? window.innerWidth));
      const bottom = Math.min(rect.bottom, (visible?.offsetTop ?? 0) + (visible?.height ?? window.innerHeight));
      const bounds = { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
      const card = node?.getBoundingClientRect();
      const placed = canvasComposerPlacement(bounds, card ? { left: card.left, top: card.top, width: card.width, height: card.height } : null,
        { width: 384, height: touch ? Math.min(620, bounds.height * 0.78) : 620 }, touch);
      setStyle({ position: "fixed", left: placed.left, top: placed.top, width: placed.width, height: placed.height, maxHeight: placed.height, right: "auto", bottom: "auto" });
    };
    const observer = new ResizeObserver(update);
    observer.observe(region);
    // Flow may mount a newly created node after this effect's first measurement.
    const mounts = new MutationObserver(update);
    mounts.observe(element, { childList: true, subtree: true });
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => { mounts.disconnect(); observer.disconnect(); window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); window.visualViewport?.removeEventListener("resize", update); window.visualViewport?.removeEventListener("scroll", update); };
  }, [viewport, nodeId, touch, layoutIdentity, cameraIdentity]);
  return style;
}
