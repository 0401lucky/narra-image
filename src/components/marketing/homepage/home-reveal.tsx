"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { animate } from "motion/react";

import { HOME_MOTION } from "./constants";
import { useHomeMotion } from "./hooks/use-home-motion";
import { useHomeVisibility } from "./hooks/use-home-visibility";

type HomeRevealProps = {
  children: ReactNode;
  className?: string;
  id?: string;
  as?: "div" | "section";
  delay?: number;
};

export function HomeReveal({ children, className, id, as: Tag = "div", delay = 0 }: HomeRevealProps) {
  const { ref, visible } = useHomeVisibility<HTMLDivElement>();
  const { enabled } = useHomeMotion();
  const played = useRef(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled || !visible || played.current) return;
    played.current = true;
    let disposed = false;
    // Keep DOM writes local: Motion's element renderer can outlive stop().
    const animation = animate(0, 1, {
      delay, duration: HOME_MOTION.revealDuration, ease: HOME_MOTION.ease,
      onUpdate: (progress) => {
        if (disposed) return;
        element.style.opacity = String(progress);
        element.style.transform = progress === 1 ? "none" : `translateY(${HOME_MOTION.revealOffset * (1 - progress)}px)`;
      },
    });
    return () => {
      disposed = true;
      animation.stop();
      element.style.opacity = "1";
      element.style.transform = "none";
    };
  }, [delay, enabled, ref, visible]);

  return <Tag ref={ref} id={id} className={className} data-home-reveal>{children}</Tag>;
}
