"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

type UseHomeVisibilityResult<T extends HTMLElement> = {
  ref: RefObject<T | null>;
  visible: boolean;
};

// 缺少或拒绝观察器时保持内容可见；观察只控制装饰性工作，不控制访问权限。
export function useHomeVisibility<T extends HTMLElement>(): UseHomeVisibilityResult<T> {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let disposed = false;
    let observer: IntersectionObserver | undefined;
    try {
      if (typeof IntersectionObserver === "undefined") throw new Error("observer unavailable");
      observer = new IntersectionObserver((entries) => {
        if (disposed) return;
        const entry = entries.find((item) => item.target === element);
        if (entry) setVisible(entry.isIntersecting);
      }, { threshold: 0.05 });
      observer.observe(element);
    } catch {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVisible(true);
    }
    return () => {
      disposed = true;
      observer?.disconnect();
    };
  }, []);

  return { ref, visible };
}
