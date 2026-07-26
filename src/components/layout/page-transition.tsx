"use client";

import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

// 舒展的减速曲线：前段快、尾段缓，避免匀速带来的"赶时间"感
const easeOutSoft: [number, number, number, number] = [0.22, 1, 0.36, 1];

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
  // 退场保持短促，进场放慢并留出挂载时间（delay），减少与首帧渲染抢主线程
  const shellMotion = isCreatePage
    ? ({
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -6, transition: { duration: 0.14, ease: "easeIn" } },
        initial: { opacity: 0, y: 8 },
        transition: { delay: 0.04, duration: 0.3, ease: easeOutSoft },
      } as const)
    : ({
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -10, transition: { duration: 0.16, ease: "easeIn" } },
        initial: { opacity: 0, y: 16 },
        transition: { delay: 0.05, duration: 0.5, ease: easeOutSoft },
      } as const);

  return (
    <MotionConfig reducedMotion="user">
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
          <div key={`gate-${pathname}`} aria-hidden className="route-transition-gate">
            <motion.span
              className="route-transition-gate-panel route-transition-gate-panel-left"
              initial={{ x: 0 }}
              animate={{ x: "-100%" }}
              transition={{ delay: 0.16, duration: 0.55, ease: easeOutSoft }}
            />
            <motion.span
              className="route-transition-gate-panel route-transition-gate-panel-right"
              initial={{ x: 0 }}
              animate={{ x: "100%" }}
              transition={{ delay: 0.16, duration: 0.55, ease: easeOutSoft }}
            />
          </div>
        )}
      </div>
    </MotionConfig>
  );
}
