"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import type { HeaderVariant } from "./homepage/types";
import homeStyles from "./homepage/header.module.css";

const HIDE_THRESHOLD = 80;
const DELTA = 6;

type HeaderShellProps = { children: ReactNode; variant?: HeaderVariant };
const variantStyles: Record<HeaderVariant, string> = {
  default: "sticky top-0 z-30 border-b border-[var(--line)] bg-[#f5efe6]/92 shadow-[0_10px_35px_rgba(84,52,29,0.06)] backdrop-blur-2xl transition-transform duration-200 ease-out",
  home: homeStyles.shell,
};

// 首页始终固定；其他页面保留原有桌面滚动隐藏行为。
export function HeaderShell({ children, variant = "default" }: HeaderShellProps) {
  const [hidden, setHidden] = useState(false);
  const hiddenRef = useRef(false);
  const lastY = useRef(0);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (variant === "home" || typeof window === "undefined") return;

    function setHiddenState(nextHidden: boolean) {
      if (hiddenRef.current === nextHidden) return;
      hiddenRef.current = nextHidden;
      setHidden(nextHidden);
    }

    function updateHeaderVisibility() {
      frameRef.current = null;
      const y = window.scrollY;
      const isMobile = window.innerWidth < 768;
      if (isMobile) {
        setHiddenState(false);
        lastY.current = y;
        return;
      }
      if (y < HIDE_THRESHOLD) {
        setHiddenState(false);
      } else if (y > lastY.current + DELTA) {
        setHiddenState(true);
      } else if (y < lastY.current - DELTA) {
        setHiddenState(false);
      }
      lastY.current = y;
    }

    function handleScroll() {
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(updateHeaderVisibility);
    }

    lastY.current = window.scrollY;
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, [variant]);

  return (
    <div
      className={cn(variantStyles[variant], variant === "default" && (hidden ? "-translate-y-full" : "translate-y-0"))}
      data-header-variant={variant}
    >
      {children}
    </div>
  );
}
