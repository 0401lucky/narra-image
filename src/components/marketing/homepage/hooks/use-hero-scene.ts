"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { HERO_SCENES, HOME_MOTION } from "../constants";
import type { HomeScene, HomeSceneId } from "../types";

type HeroSceneState = {
  scene: HomeScene;
  imageState: "loading" | "ready" | "error";
  imageRevision: number;
  requestedId: HomeSceneId | null;
  failedId: HomeSceneId | null;
};

type UseHeroSceneResult = HeroSceneState & {
  requestScene: (id: HomeSceneId) => void;
  imageFailed: (id: HomeSceneId, revision: number) => void;
};

const initialState: HeroSceneState = {
  scene: HERO_SCENES[0],
  imageState: "loading",
  imageRevision: 0,
  requestedId: null,
  failedId: null,
};

// 图片完成 decode 后才原子提交场景与提示词；超时/失败保留最后完整场景。
export function useHeroScene(): UseHeroSceneResult {
  const [state, setState] = useState<HeroSceneState>(initialState);
  const snapshot = useRef(initialState);
  const mounted = useRef(false);
  const epoch = useRef(0);
  const pending = useRef<(() => void) | null>(null);

  const publish = useCallback((next: HeroSceneState) => {
    snapshot.current = next;
    setState(next);
  }, []);

  const cancelPending = useCallback(() => {
    epoch.current += 1;
    pending.current?.();
    pending.current = null;
  }, []);

  const requestScene = useCallback((id: HomeSceneId) => {
    if (!mounted.current) return;
    const scene = HERO_SCENES.find((item) => item.id === id);
    if (!scene) return;
    cancelPending();
    const ticket = epoch.current;
    const current = snapshot.current;
    if (current.scene.id === id && current.imageState === "ready") {
      publish({ ...current, requestedId: null, failedId: null });
      return;
    }
    publish({ ...current, requestedId: id, failedId: null });
    const image = new Image();
    let settled = false;
    let decoding = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const dispose = () => {
      image.onload = null;
      image.onerror = null;
      if (timeout !== null) clearTimeout(timeout);
      timeout = null;
    };
    const finish = (success: boolean) => {
      if (settled) return;
      settled = true;
      dispose();
      if (!mounted.current || epoch.current !== ticket) return;
      pending.current = null;
      if (success) {
        publish({ scene, imageState: "ready", imageRevision: snapshot.current.imageRevision + 1, requestedId: null, failedId: null });
      } else {
        const last = snapshot.current;
        publish({ ...last, imageState: last.scene.id === id ? "error" : last.imageState, requestedId: null, failedId: id });
      }
    };
    const decode = () => {
      if (decoding || settled) return;
      decoding = true;
      if (typeof image.decode !== "function") {
        finish(image.naturalWidth > 0);
        return;
      }
      image.decode().then(() => finish(image.naturalWidth > 0), () => finish(false));
    };
    image.onload = decode;
    image.onerror = () => finish(false);
    pending.current = dispose;
    timeout = setTimeout(() => finish(false), HOME_MOTION.imageDeadlineMs);
    image.src = scene.image;
    if (image.complete && image.naturalWidth > 0) decode();
  }, [cancelPending, publish]);

  useEffect(() => {
    mounted.current = true;
    // The SSR image is eager; this cached read also verifies decoding before ready.
    requestScene(HERO_SCENES[0].id);
    return () => {
      mounted.current = false;
      cancelPending();
    };
  }, [cancelPending, requestScene]);

  const imageFailed = useCallback((id: HomeSceneId, revision: number) => {
    if (!mounted.current || snapshot.current.scene.id !== id || snapshot.current.imageRevision !== revision) return;
    publish({ ...snapshot.current, imageState: "error", failedId: id });
  }, [publish]);

  return { ...state, requestScene, imageFailed };
}
