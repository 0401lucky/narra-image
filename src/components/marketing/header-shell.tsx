"use client";

import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

const HIDE_THRESHOLD = 80;
const DELTA = 6;

// Header 容器：滚动方向感知 hide-on-scroll，桌面端体感更轻；移动端为避免误判保持显示
export function HeaderShell({ children }: { children: React.ReactNode }) {
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;

    function handleScroll() {
      const y = window.scrollY;
      const isMobile = window.innerWidth < 768;
      if (isMobile) {
        setHidden(false);
        lastY.current = y;
        return;
      }
      if (y < HIDE_THRESHOLD) {
        setHidden(false);
      } else if (y > lastY.current + DELTA) {
        setHidden(true);
      } else if (y < lastY.current - DELTA) {
        setHidden(false);
      }
      lastY.current = y;
    }

    lastY.current = window.scrollY;
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <motion.div
      animate={{ y: hidden ? -100 : 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="sticky top-0 z-30 bg-[var(--surface)]/80 backdrop-blur-md"
    >
      {children}
    </motion.div>
  );
}
