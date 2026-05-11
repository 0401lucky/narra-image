"use client";

import { AnimatePresence, motion } from "motion/react";
import { usePathname } from "next/navigation";

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname.startsWith("/admin")) {
    return <div className="flex min-h-screen flex-col">{children}</div>;
  }

  return (
    <div className="page-transition-shell">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={pathname}
          initial={{ opacity: 0, y: 18, scale: 0.985, filter: "blur(10px) saturate(1.18)" }}
          animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px) saturate(1)" }}
          exit={{ opacity: 0, y: -12, scale: 1.01, filter: "blur(8px) saturate(1.28)" }}
          transition={{ duration: 0.42, ease: [0.2, 0.82, 0.18, 1] }}
          className="flex min-h-screen flex-col"
        >
          {children}
        </motion.div>
      </AnimatePresence>

      <motion.div
        key={`gate-${pathname}`}
        aria-hidden
        className="route-transition-gate"
        initial={{ opacity: 1, clipPath: "inset(0% 0% 0% 0%)" }}
        animate={{ opacity: 0, clipPath: "inset(0% 48% 0% 48%)" }}
        transition={{ duration: 0.58, ease: [0.76, 0, 0.24, 1] }}
      >
        <span className="route-transition-gate-line" />
        <span className="route-transition-gate-scan route-transition-gate-scan-left" />
        <span className="route-transition-gate-scan route-transition-gate-scan-right" />
      </motion.div>
    </div>
  );
}
