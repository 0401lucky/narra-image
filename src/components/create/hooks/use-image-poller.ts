"use client";

// 单个 generation 任务的轮询 Hook。
// 1) setTimeout + 退避（POLL_DELAYS_MS）替代固定 setInterval；
// 2) 监听 visibilitychange/focus/pageshow，标签页隐藏时挂起，恢复后立即补拉；
// 3) 任务进入 succeeded/failed 即停止；超过 POLL_MAX_ATTEMPTS 兜底放弃。
import { useEffect, useRef } from "react";

import { POLL_DELAYS_MS, POLL_MAX_ATTEMPTS } from "../constants";
import type { GenerationItem } from "../types";

type PollerEntry = {
  handle: ReturnType<typeof setTimeout>;
  attempts: number;
};

type UseImagePollerOptions = {
  generations: GenerationItem[];
  onUpdate: (updated: GenerationItem) => void;
};

function nextDelay(attempts: number) {
  return POLL_DELAYS_MS[Math.min(attempts, POLL_DELAYS_MS.length - 1)];
}

export function useImagePoller({ generations, onUpdate }: UseImagePollerOptions) {
  const pollersRef = useRef<Map<string, PollerEntry>>(new Map());
  // 组件卸载时清空所有定时器，避免泄漏。
  useEffect(() => {
    const pollers = pollersRef.current;
    return () => {
      pollers.forEach((entry) => clearTimeout(entry.handle));
      pollers.clear();
    };
  }, []);

  useEffect(() => {
    const pollers = pollersRef.current;

    function stopPoller(id: string) {
      const entry = pollers.get(id);
      if (entry) {
        clearTimeout(entry.handle);
        pollers.delete(id);
      }
    }

    async function pollOnce(id: string, attempts: number) {
      if (attempts > POLL_MAX_ATTEMPTS) {
        stopPoller(id);
        return;
      }
      try {
        const response = await fetch(`/api/me/generations/${id}`);
        if (!response.ok) {
          schedulePoller(id, attempts + 1);
          return;
        }
        const json = (await response.json()) as {
          data?: { generation: GenerationItem };
        };
        const updated = json?.data?.generation;
        if (!updated) {
          schedulePoller(id, attempts + 1);
          return;
        }
        if (updated.status === "pending") {
          schedulePoller(id, attempts + 1);
          return;
        }
        // 命中 succeeded/failed：写回外部状态并结束。
        onUpdate(updated);
        stopPoller(id);
      } catch {
        // 单次失败不致命，按下一档延时继续。
        schedulePoller(id, attempts + 1);
      }
    }

    function schedulePoller(id: string, attempts: number, delay = nextDelay(attempts)) {
      // 标签页不可见时占位，等可见性事件唤醒；避免后台浏览器节流引发的重试堆积。
      if (typeof document !== "undefined" && document.hidden) {
        const entry: PollerEntry = { attempts, handle: setTimeout(() => {}, 0) };
        pollers.set(id, entry);
        return;
      }

      const handle = setTimeout(async () => {
        await pollOnce(id, attempts);
      }, delay);

      pollers.set(id, { attempts, handle });
    }

    const pendingIds = generations
      .filter((generation) => generation.status === "pending")
      .map((generation) => generation.id);

    pendingIds.forEach((id) => {
      if (pollers.has(id)) return;
      schedulePoller(id, 0);
    });

    // 已经不再 pending 的任务（外部状态被替换或会话切走）应立即停掉轮询。
    for (const id of Array.from(pollers.keys())) {
      if (!pendingIds.includes(id)) {
        stopPoller(id);
      }
    }

    function pauseAllPollers() {
      for (const [id, entry] of Array.from(pollers.entries())) {
        clearTimeout(entry.handle);
        pollers.set(id, { attempts: entry.attempts, handle: setTimeout(() => {}, 0) });
      }
    }

    function resumePendingPollers() {
      if (typeof document !== "undefined" && document.hidden) return;
      // 切回前台：对仍处于 pending 的任务立即补拉一次，避免后台已完成但 UI 卡住。
      for (const id of pendingIds) {
        const entry = pollers.get(id);
        if (entry) clearTimeout(entry.handle);
        schedulePoller(id, entry?.attempts ?? 0, 0);
      }
    }

    function handleVisibilityChange() {
      if (typeof document === "undefined") return;
      if (document.hidden) {
        // 隐藏时挂起所有 poller，保留 attempts 以便恢复时按对应延时继续。
        pauseAllPollers();
      } else {
        resumePendingPollers();
      }
    }

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("focus", resumePendingPollers);
      window.addEventListener("pageshow", resumePendingPollers);
    }
    return () => {
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", resumePendingPollers);
        window.removeEventListener("pageshow", resumePendingPollers);
      }
    };
  }, [generations, onUpdate]);
}
