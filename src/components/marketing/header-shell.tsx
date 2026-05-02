"use client";

import { useEffect, useRef, useState } from "react";

const HIDE_THRESHOLD = 80;
const DELTA = 6;

// Header 容器：滚动方向感知 hide-on-scroll，桌面端体感更轻；移动端为避免误判保持显示
export function HeaderShell({ children }: { children: React.ReactNode }) {
  const [hidden, setHidden] = useState(false);
  const hiddenRef = useRef(false);
  const lastY = useRef(0);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

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
  }, []);

  return (
    <div
      className={
        "sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--surface)]/95 transition-transform duration-200 ease-out " +
        (hidden ? "-translate-y-full" : "translate-y-0")
      }
    >
      {children}
    </div>
  );
}
