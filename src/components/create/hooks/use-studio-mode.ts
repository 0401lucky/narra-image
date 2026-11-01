"use client";

// 模式和触控布局只切换展示层；挂载能力不随宽度、旋转或软键盘变化。
import { useCallback, useEffect, useState } from "react";

export type StudioMode = "conversation" | "canvas";
type UseStudioModeResult = {
  mode: StudioMode;
  canvasReadOnly: boolean;
  touchPresentation: boolean;
  changeMode: (mode: StudioMode) => void;
};

export function useStudioMode(ownerId: string, canvasEnabled: boolean): UseStudioModeResult {
  const [mode, setMode] = useState<StudioMode>("conversation");
  const [mountedOwner, setMountedOwner] = useState<string | null>(null);
  const [touchPresentation, setTouchPresentation] = useState(true);
  const preferenceKey = `narra_studio_mode_v1:${ownerId}`;

  useEffect(() => {
    let restored: StudioMode = "conversation";
    if (canvasEnabled) {
      try { if (window.localStorage.getItem(preferenceKey) === "canvas") restored = "canvas"; }
      catch { /* A blocked preference store does not disable either workspace. */ }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Browser preferences are mount-only, never SSR inputs.
    setMode(restored);
  }, [canvasEnabled, preferenceKey]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR cannot authorize browser mutations.
    setMountedOwner(ownerId);
  }, [ownerId]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const touch = window.matchMedia("(max-width: 767px), (pointer: coarse), (hover: none)");
    const update = () => setTouchPresentation(touch.matches);
    update();
    touch.addEventListener("change", update);
    return () => touch.removeEventListener("change", update);
  }, []);

  const changeMode = useCallback((next: StudioMode) => {
    if (next === "canvas" && !canvasEnabled) return;
    setMode(next);
    try { window.localStorage.setItem(preferenceKey, next); }
    catch { /* The current mode still works without a durable preference. */ }
  }, [canvasEnabled, preferenceKey]);

  return { mode: canvasEnabled ? mode : "conversation", canvasReadOnly: !canvasEnabled || mountedOwner !== ownerId, touchPresentation, changeMode };
}
