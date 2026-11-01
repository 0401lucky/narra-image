"use client";

// 画布控制器随工作台挂载，不随懒加载渲染器切换；账户变化销毁旧来源、预览与回调。
// 首屏不读取浏览器存储。pagehide 仅尽力写入，事务确认前不承诺本地恢复。
import { useEffect, useRef, useState } from "react";

import {
  createCanvasController,
  emptyCanvasControllerSnapshot,
  type CanvasController,
  type CanvasControllerOptions,
  type CanvasControllerSnapshot,
} from "../canvas/controller";

export type UseCanvasDocumentsResult = {
  controller: CanvasController | null;
  snapshot: CanvasControllerSnapshot;
};
type MountedController = UseCanvasDocumentsResult & { ownerId: string; enabled: boolean };

export function useCanvasDocuments(options: CanvasControllerOptions): UseCanvasDocumentsResult {
  const { ownerId, enabled, readOnly, defaultParameters, jobs } = options;
  const latest = useRef(options);
  const controllerRef = useRef<CanvasController | null>(null);
  const [mounted, setMounted] = useState<MountedController | null>(null);

  useEffect(() => { latest.current = options; }, [options]);
  useEffect(() => {
    const instance = createCanvasController({ ...latest.current, ownerId, enabled, jobs,
      acquireTransientLease: (input) => latest.current.acquireTransientLease(input),
    });
    controllerRef.current = instance;
    let live = true;
    const publish = () => {
      if (live) setMounted({ ownerId, enabled, controller: instance, snapshot: instance.getSnapshot() });
    };
    const unsubscribe = instance.subscribe(publish);
    const pageHide = () => { void instance.flushLocal(); };
    window.addEventListener("pagehide", pageHide);
    void instance.start();
    return () => {
      live = false;
      unsubscribe();
      window.removeEventListener("pagehide", pageHide);
      instance.dispose();
      if (controllerRef.current === instance) controllerRef.current = null;
    };
  }, [ownerId, enabled, jobs]);
  useEffect(() => { controllerRef.current?.setReadOnly(readOnly); }, [readOnly]);
  useEffect(() => { controllerRef.current?.setDefaults(defaultParameters); }, [defaultParameters]);

  if (mounted?.ownerId !== ownerId || mounted.enabled !== enabled) return { controller: null, snapshot: emptyCanvasControllerSnapshot({ ownerId, enabled, readOnly }) };
  return { controller: mounted.controller, snapshot: mounted.snapshot };
}
