// 宠物开关共享状态：通过 localStorage 持久化 + 自定义事件做跨组件通知
// 这里不做 React Context，保持轻量；任意组件都可以订阅 PET_TOGGLE_EVENT 获取最新状态

import { useSyncExternalStore } from "react";

import { DEFAULT_PET_ID, getPetById, type PetId } from "@/components/pet/pet-catalog";

export const PET_STORAGE_KEY = "narra:pet:enabled";
export const PET_SELECTED_STORAGE_KEY = "narra:pet:selected";
export const PET_TOGGLE_EVENT = "narra:pet:toggle";
export const PET_SELECTED_EVENT = "narra:pet:selected";

export type PetToggleDetail = { enabled: boolean };
export type PetSelectedDetail = { petId: PetId };

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

// 安全读取当前宠物：未知 id 自动回落到默认宠物
export function readSelectedPetId(): PetId {
  if (typeof window === "undefined") return DEFAULT_PET_ID;
  try {
    return getPetById(window.localStorage.getItem(PET_SELECTED_STORAGE_KEY)).id as PetId;
  } catch {
    return DEFAULT_PET_ID;
  }
}

// 写入当前宠物并广播，选择宠物时不强制开启，由调用方决定
export function writeSelectedPetId(petId: PetId): void {
  if (typeof window === "undefined") return;
  const resolvedPetId = getPetById(petId).id as PetId;
  try {
    window.localStorage.setItem(PET_SELECTED_STORAGE_KEY, resolvedPetId);
  } catch {
    // localStorage 不可用时不阻断，仅丢失持久化能力
  }
  window.dispatchEvent(
    new CustomEvent<PetSelectedDetail>(PET_SELECTED_EVENT, {
      detail: { petId: resolvedPetId },
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

function subscribeSelectedPet(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(PET_SELECTED_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(PET_SELECTED_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

// 客户端读取最新开关状态（每次外部事件触发后由 React 调用）
function getPetEnabledSnapshot(): boolean {
  return readPetEnabled();
}

function getSelectedPetSnapshot(): PetId {
  return readSelectedPetId();
}

// 服务端兜底：未登录或 SSR 阶段一律视为关闭
function getPetEnabledServerSnapshot(): boolean {
  return false;
}

function getSelectedPetServerSnapshot(): PetId {
  return DEFAULT_PET_ID;
}

// React Hook：组件订阅开关，自动处理 SSR 一致性与跨标签同步
export function usePetEnabled(): boolean {
  return useSyncExternalStore(
    subscribePetEnabled,
    getPetEnabledSnapshot,
    getPetEnabledServerSnapshot,
  );
}

export function useSelectedPetId(): PetId {
  return useSyncExternalStore(
    subscribeSelectedPet,
    getSelectedPetSnapshot,
    getSelectedPetServerSnapshot,
  );
}
