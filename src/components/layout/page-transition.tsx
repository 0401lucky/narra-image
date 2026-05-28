"use client";

import { AnimatePresence, motion } from "motion/react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  if (pathname.startsWith("/admin")) {
    return <div className="flex min-h-screen flex-col">{children}</div>;
  }

  const isCreatePage = pathname === "/create";
  const shellMotion = isCreatePage
    ? ({
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -4 },
        initial: { opacity: 0, y: 6 },
        transition: { duration: 0.18, ease: "easeOut" },
      } as const)
    : ({
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -8 },
        initial: { opacity: 0, y: 10 },
        transition: { duration: 0.24, ease: "easeOut" },
      } as const);

  return (
    <div className="page-transition-shell">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={pathname}
          initial={shellMotion.initial}
          animate={shellMotion.animate}
          exit={shellMotion.exit}
          transition={shellMotion.transition}
          className={
            isCreatePage
              ? "flex h-[100dvh] flex-col overflow-hidden"
              : "flex min-h-screen flex-col"
          }
        >
          {children}
        </motion.div>
      </AnimatePresence>

      {mounted && !isCreatePage && (
        <motion.div
          key={`gate-${pathname}`}
          aria-hidden
          className="route-transition-gate"
          initial={{ opacity: 1, clipPath: "inset(0% 0% 0% 0%)" }}
          animate={{ opacity: 0, clipPath: "inset(0% 48% 0% 48%)" }}
          transition={{ duration: 0.32, ease: "easeInOut" }}
        >
          <span className="route-transition-gate-line" />
          <span className="route-transition-gate-scan route-transition-gate-scan-left" />
          <span className="route-transition-gate-scan route-transition-gate-scan-right" />
        </motion.div>
      )}
    </div>
  );
}
