"use client";

import { useEffect, useRef, type RefObject } from "react";

import { HOME_MOTION } from "../constants";
import { useHomeMotion } from "./use-home-motion";

// 仅已解码且可见的首屏画面持有一条粒子循环；画布尺寸/DPR/数量都有上限。
export function useHomeDust(active: boolean): RefObject<HTMLCanvasElement | null> {
  const ref = useRef<HTMLCanvasElement>(null);
  const { enabled } = useHomeMotion();

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.dataset.dustActive = "false";
    if (!active || !enabled) return;
    let context: CanvasRenderingContext2D | null;
    try {
      context = canvas.getContext("2d");
    } catch {
      return;
    }
    if (!context) return;
    const ctx = context;
    let disposed = false;
    let width = 0;
    let height = 0;
    let previous: number | null = null;
    let frame: number | null = null;
    const particles = Array.from({ length: HOME_MOTION.dustParticles }, () => ({
      x: Math.random(), y: Math.random(), radius: Math.random() * 2.2 + 0.8,
      vx: (Math.random() - 0.3) * 0.0005, vy: -(Math.random() * 0.0007 + 0.0002),
      alpha: Math.random() * 0.55 + 0.2,
    }));

    const paint = (time: number) => {
      frame = null;
      if (disposed || width <= 0 || height <= 0) return;
      const delta = previous === null ? 1 : Math.min(2, Math.max(0, (time - previous) / 16.67));
      previous = time;
      ctx.clearRect(0, 0, width, height);
      for (const particle of particles) {
        particle.x = (particle.x + particle.vx * delta + 1) % 1;
        particle.y = (particle.y + particle.vy * delta + 1) % 1;
        ctx.beginPath();
        ctx.arc(particle.x * width, particle.y * height, particle.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 224, 168, ${particle.alpha})`;
        ctx.fill();
      }
      canvas.dataset.dustActive = "true";
      frame = requestAnimationFrame(paint);
    };
    const resize = () => {
      if (disposed) return;
      const rect = canvas.getBoundingClientRect();
      width = Math.min(1024, Math.max(0, rect.width));
      height = Math.min(1024, Math.max(0, rect.height));
      const ratio = Math.min(HOME_MOTION.maxPixelRatio, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (frame === null && width && height) frame = requestAnimationFrame(paint);
    };
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(resize);
      observer.observe(canvas);
    } else {
      window.addEventListener("resize", resize, { passive: true });
    }
    resize();
    return () => {
      disposed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      canvas.dataset.dustActive = "false";
    };
  }, [active, enabled]);

  return ref;
}
