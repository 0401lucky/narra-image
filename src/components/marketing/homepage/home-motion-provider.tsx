"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { HOME_MEDIA } from "./constants";
import { HomeMotionContext } from "./motion-context";
import styles from "./homepage.module.css";

type HomeMotionProviderProps = { children: ReactNode };

export function HomeMotionProvider({ children }: HomeMotionProviderProps) {
  const [environment, setEnvironment] = useState({ ready: false, reducedMotion: false, pageVisible: true, finePointer: false });
  const [paused, setPaused] = useState(false);
  const togglePaused = useCallback(() => setPaused((value) => !value), []);

  useEffect(() => {
    const reduced = window.matchMedia?.(HOME_MEDIA.reduced);
    const pointer = window.matchMedia?.(HOME_MEDIA.finePointer);
    const sync = () => setEnvironment({
      ready: true,
      reducedMotion: reduced?.matches ?? false,
      pageVisible: !document.hidden,
      finePointer: pointer?.matches ?? false,
    });
    // SSR stays readable; browser-only preferences are applied after hydration.
    sync();
    reduced?.addEventListener("change", sync);
    pointer?.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      reduced?.removeEventListener("change", sync);
      pointer?.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  const value = useMemo(() => ({
    ...environment,
    paused,
    enabled: environment.ready && environment.pageVisible && !environment.reducedMotion && !paused,
    togglePaused,
  }), [environment, paused, togglePaused]);

  return (
    <HomeMotionContext.Provider value={value}>
      <div
        className={cn(styles.scope, styles.page)}
        data-homepage
        data-motion-paused={paused}
        data-motion-reduced={environment.reducedMotion}
        data-motion-active={value.enabled}
      >
        {children}
      </div>
    </HomeMotionContext.Provider>
  );
}
