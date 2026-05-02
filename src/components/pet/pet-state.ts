// 宠物开关共享状态：通过 localStorage 持久化 + 自定义事件做跨组件通知
// 这里不做 React Context，保持轻量；任意组件都可以订阅 PET_TOGGLE_EVENT 获取最新状态

import { useSyncExternalStore } from "react";

export const PET_STORAGE_KEY = "narra:pet:enabled";
export const PET_TOGGLE_EVENT = "narra:pet:toggle";

export type PetToggleDetail = { enabled: boolean };

// 安全读取开关状态：SSR 阶段返回默认值 false
export function readPetEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(PET_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

// 写入开关状态并广播事件，订阅方据此联动
export function writePetEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PET_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // localStorage 不可用时不阻断，仅丢失持久化能力
  }
  window.dispatchEvent(
    new CustomEvent<PetToggleDetail>(PET_TOGGLE_EVENT, {
      detail: { enabled },
    }),
  );
}

// 订阅开关状态：使用 useSyncExternalStore，避免在 useEffect 中同步 setState
// React 19 的 react-hooks/set-state-in-effect 规则禁止此类用法
function subscribePetEnabled(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(PET_TOGGLE_EVENT, callback);
  // 跨标签页同步
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(PET_TOGGLE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

// 客户端读取最新开关状态（每次外部事件触发后由 React 调用）
function getPetEnabledSnapshot(): boolean {
  return readPetEnabled();
}

// 服务端兜底：未登录或 SSR 阶段一律视为关闭
function getPetEnabledServerSnapshot(): boolean {
  return false;
}

// React Hook：组件订阅开关，自动处理 SSR 一致性与跨标签同步
export function usePetEnabled(): boolean {
  return useSyncExternalStore(
    subscribePetEnabled,
    getPetEnabledSnapshot,
    getPetEnabledServerSnapshot,
  );
}
