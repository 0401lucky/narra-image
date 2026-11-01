"use client";

// 未完成参数归属于挂载的账户工作台，面板/画布渲染器关闭不丢弃输入。
import { useEffect, useMemo, useSyncExternalStore } from "react";

import type { CanvasController } from "../canvas/controller";
import type { CanvasControllerSnapshot } from "../canvas/controller-types";
import { createCanvasEditorState, type CanvasEditorPort } from "../canvas/editor-state";

export function useCanvasEditor(view: CanvasControllerSnapshot, controller: CanvasController | null): CanvasEditorPort {
  const store = useMemo(() => createCanvasEditorState(view.ownerId, controller), [view.ownerId, controller]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => { store.reconcile(view); }, [store, view]);
  return useMemo(() => ({ ...store, state }), [store, state]);
}
