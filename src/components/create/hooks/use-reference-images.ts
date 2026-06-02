"use client";

// 参考图状态 Hook：
// 1) 集中管理 ObjectURL 创建与释放，避免组件卸载时泄漏；
// 2) 限制最多 MAX_REFERENCE_IMAGES 张并产生友好提示；
// 3) 暴露 add / remove / clear 三种命令式操作；
// 4) addFiles 同步返回结果（不依赖 setState reducer 闭包的延迟执行）。
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

import { MAX_REFERENCE_IMAGES } from "../constants";
import type { ReferenceImage } from "../types";

type AddFilesResult = "ok" | "exceeded" | "empty";

type UseReferenceImagesResult = {
  referenceImages: ReferenceImage[];
  addFiles: (files: File[] | FileList | null) => AddFilesResult;
  removeImage: (id: string) => void;
  clear: () => void;
  moveImage: (id: string, direction: -1 | 1) => void;
  reorderImage: (sourceId: string, targetId: string) => void;
  setImages: Dispatch<SetStateAction<ReferenceImage[]>>;
};

export function useReferenceImages(): UseReferenceImagesResult {
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  // 持有当前 URL 集合用于卸载时释放，避免 ObjectURL 泄漏。
  const liveUrlsRef = useRef<Set<string>>(new Set());
  // 同步跟踪当前数组长度，用于 addFiles 不依赖 setState reducer 也能算出 exceeded。
  const liveCountRef = useRef(0);

  useEffect(() => {
    liveCountRef.current = referenceImages.length;
    referenceImages.forEach((image) => liveUrlsRef.current.add(image.previewUrl));
  }, [referenceImages]);

  useEffect(() => {
    // 复制到 effect 局部变量；卸载时遍历这个集合，避免 ref 在中途指向新对象的潜在风险。
    const liveUrls = liveUrlsRef.current;
    return () => {
      liveUrls.forEach((url) => URL.revokeObjectURL(url));
      liveUrls.clear();
    };
  }, []);

  const addFiles = useCallback((files: File[] | FileList | null): AddFilesResult => {
    const imageFiles = Array.from(files ?? []).filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) return "empty";

    const remaining = Math.max(0, MAX_REFERENCE_IMAGES - liveCountRef.current);
    const acceptedFiles = imageFiles.slice(0, remaining);
    const exceeded = acceptedFiles.length < imageFiles.length;

    if (acceptedFiles.length === 0) {
      return exceeded ? "exceeded" : "empty";
    }

    const additions: ReferenceImage[] = acceptedFiles.map((file) => ({
      file,
      id: `${Date.now()}_${file.name}_${Math.random().toString(36).slice(2, 8)}`,
      previewUrl: URL.createObjectURL(file),
    }));

    // 立即把新 URL 入账，避免 effect 还没跑就被卸载导致泄漏。
    additions.forEach((item) => liveUrlsRef.current.add(item.previewUrl));
    liveCountRef.current += additions.length;
    setReferenceImages((current) => [...current, ...additions]);

    return exceeded ? "exceeded" : "ok";
  }, []);

  const removeImage = useCallback((id: string) => {
    setReferenceImages((current) => {
      const target = current.find((item) => item.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
        liveUrlsRef.current.delete(target.previewUrl);
      }
      return current.filter((item) => item.id !== id);
    });
  }, []);

  const clear = useCallback(() => {
    setReferenceImages((current) => {
      current.forEach((image) => {
        URL.revokeObjectURL(image.previewUrl);
        liveUrlsRef.current.delete(image.previewUrl);
      });
      return [];
    });
  }, []);

  const moveImage = useCallback((id: string, direction: -1 | 1) => {
    setReferenceImages((current) => {
      const index = current.findIndex((item) => item.id === id);
      if (index < 0) return current;
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.length) return current;

      const next = current.slice();
      const [target] = next.splice(index, 1);
      next.splice(nextIndex, 0, target);
      return next;
    });
  }, []);

  const reorderImage = useCallback((sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    setReferenceImages((current) => {
      const sourceIndex = current.findIndex((item) => item.id === sourceId);
      const targetIndex = current.findIndex((item) => item.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;

      const next = current.slice();
      const [source] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, source);
      return next;
    });
  }, []);

  return {
    addFiles,
    clear,
    moveImage,
    referenceImages,
    removeImage,
    reorderImage,
    setImages: setReferenceImages,
  };
}
