import type { CanvasGenerationParametersV1, CanvasLocalNodeV1 } from "@/lib/canvas/contracts";
import { normalizeGenerationSize } from "@/lib/generation/sizes";
import { canvasGenerationParametersSchema } from "@/lib/validators";

import type { CanvasController } from "./controller";
import type { CanvasControllerSnapshot } from "./controller-types";

export type CanvasEditorTarget = Readonly<{ ownerId: string; canvasId: string; nodeId: string }>;
export type CanvasParameterField = "model" | "size" | "outputCompression" | "negativePrompt" | "seed";
export type CanvasFieldDraft = Readonly<{ text: string; base: string; invalid: boolean }>;
export type CanvasNodeFieldDrafts = Readonly<{
  target: CanvasEditorTarget;
  fields: Partial<Record<CanvasParameterField, CanvasFieldDraft>>;
  customSize?: boolean;
}>;
export type CanvasEditorSnapshot = Readonly<{
  intent: { mode: "edit" | "move"; target: CanvasEditorTarget } | null;
  drafts: ReadonlyMap<string, CanvasNodeFieldDrafts>;
  focus: { target: CanvasEditorTarget; field: CanvasParameterField; sequence: number } | null;
}>;
export type CanvasFieldCommitResult = { ok: true } | { ok: false; target?: CanvasEditorTarget; field?: CanvasParameterField; error?: unknown };

export const CANVAS_PARAMETER_LABELS: Record<CanvasParameterField, string> = {
  model: "节点第三方模型", size: "节点自定义尺寸", outputCompression: "节点压缩质量（0-100）",
  negativePrompt: "节点负向提示词", seed: "节点随机种子（可选）",
};

export function canvasEditorKey(target: CanvasEditorTarget): string {
  return JSON.stringify([target.ownerId, target.canvasId, target.nodeId]);
}

export function canvasFieldPatch(field: CanvasParameterField, text: string): Partial<CanvasGenerationParametersV1> | null {
  switch (field) {
    case "model": return { model: text };
    case "negativePrompt": return { negativePrompt: text || null };
    case "size": {
      const size = normalizeGenerationSize(text);
      return size ? { size } : null;
    }
    case "outputCompression": return text.trim() ? { outputCompression: Number(text) } : null;
    case "seed": return { seed: text.trim() ? Number(text) : null };
  }
}

// A hook-owned, nonsecret UI buffer, never a scene or persistence authority.
// Commands read the live controller only when applying a captured target.
export function createCanvasEditorState(ownerId: string, controller: CanvasController | null) {
  let snapshot: CanvasEditorSnapshot = { intent: null, drafts: new Map(), focus: null };
  const listeners = new Set<() => void>();
  const publish = (next: CanvasEditorSnapshot) => { snapshot = next; listeners.forEach((listener) => listener()); };
  const currentNode = (target: CanvasEditorTarget, viewing = false): CanvasLocalNodeV1 | null => {
    const view = controller?.getSnapshot();
    if (target.ownerId !== ownerId || view?.ownerId !== ownerId || !view.enabled || !view.ready || (!viewing && view.readOnly)
      || view.active?.document.id !== target.canvasId || (!viewing && view.active.document.deleting)) return null;
    return view.active.scene.nodes.find((node) => node.id === target.nodeId) ?? null;
  };
  const updateDraft = (target: CanvasEditorTarget, update: (current: CanvasNodeFieldDrafts) => CanvasNodeFieldDrafts) => {
    if (!currentNode(target)) return;
    const key = canvasEditorKey(target);
    const drafts = new Map(snapshot.drafts);
    drafts.set(key, update(drafts.get(key) ?? { target, fields: {} }));
    publish({ ...snapshot, drafts });
  };
  const reject = (target: CanvasEditorTarget, field: CanvasParameterField, focus: boolean, error?: unknown): CanvasFieldCommitResult => {
    updateDraft(target, (draft) => ({ ...draft, fields: { ...draft.fields, [field]: draft.fields[field] ? { ...draft.fields[field], invalid: true } : undefined } }));
    if (focus) publish({ ...snapshot, intent: { mode: "edit", target }, focus: { target, field, sequence: (snapshot.focus?.sequence ?? 0) + 1 } });
    return { ok: false, target, field, error };
  };
  const apply = (canvasId: string, nodeId?: string, onlyField?: CanvasParameterField, focus = true): CanvasFieldCommitResult => {
    const pending = [...snapshot.drafts.values()].filter((draft) => draft.target.canvasId === canvasId && (!nodeId || draft.target.nodeId === nodeId));
    const changes: { draft: CanvasNodeFieldDrafts; fields: CanvasParameterField[]; patch: Partial<CanvasGenerationParametersV1> }[] = [];
    // Validate all pending fields before changing any node or capturing Save/Run.
    for (const draft of pending) {
      const fields = (Object.keys(draft.fields) as CanvasParameterField[]).filter((field) => !onlyField || onlyField === field);
      if (!fields.length) continue;
      const node = currentNode(draft.target);
      if (node?.kind !== "generation") return { ok: false, target: draft.target };
      let patch: Partial<CanvasGenerationParametersV1> = {};
      for (const field of fields) {
        const value = canvasFieldPatch(field, draft.fields[field]!.text);
        if (!value || !canvasGenerationParametersSchema.safeParse({ ...node.parameters, ...patch, ...value }).success) return reject(draft.target, field, focus);
        patch = { ...patch, ...value };
      }
      changes.push({ draft, fields, patch });
    }
    for (const { draft, fields, patch } of changes) {
      try { controller?.updateParameters(canvasId, draft.target.nodeId, patch); }
      catch (error) { return reject(draft.target, fields[0], focus, error); }
      const current = snapshot.drafts.get(canvasEditorKey(draft.target));
      if (!current) continue;
      const remaining = { ...current.fields };
      for (const field of fields) if (current.fields[field] === draft.fields[field]) delete remaining[field];
      updateDraft(draft.target, (latest) => ({ ...latest, fields: remaining }));
    }
    return { ok: true };
  };
  const discard = (canvasId: string, nodeId?: string) => {
    const matches = (target: CanvasEditorTarget) => target.canvasId === canvasId && (!nodeId || target.nodeId === nodeId);
    const drafts = new Map([...snapshot.drafts].filter(([, draft]) => !matches(draft.target)));
    publish({ ...snapshot, drafts, intent: snapshot.intent && matches(snapshot.intent.target) ? null : snapshot.intent,
      focus: snapshot.focus && matches(snapshot.focus.target) ? null : snapshot.focus });
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    open: (target: CanvasEditorTarget, mode: "edit" | "move" = "edit") => {
      if (currentNode(target, mode === "edit")) publish({ ...snapshot, intent: { target, mode } });
    },
    close: () => publish({ ...snapshot, intent: null, focus: null }),
    readDraft: (target: CanvasEditorTarget) => snapshot.drafts.get(canvasEditorKey(target)),
    setField: (target: CanvasEditorTarget, field: CanvasParameterField, text: string, base: string) => {
      updateDraft(target, (draft) => ({ ...draft, fields: { ...draft.fields, [field]: { text, base: draft.fields[field]?.base ?? base, invalid: false } } }));
    },
    clearField: (target: CanvasEditorTarget, field: CanvasParameterField) => {
      updateDraft(target, (draft) => { const fields = { ...draft.fields }; delete fields[field]; return { ...draft, fields }; });
    },
    setCustomSize: (target: CanvasEditorTarget, customSize: boolean) => updateDraft(target, (draft) => ({ ...draft, customSize })),
    commitField: (target: CanvasEditorTarget, field: CanvasParameterField) => apply(target.canvasId, target.nodeId, field, false),
    applyPending: (canvasId: string, nodeId?: string) => apply(canvasId, nodeId),
    pendingCount: (canvasId: string) => [...snapshot.drafts.values()].filter((draft) => draft.target.canvasId === canvasId).reduce((count, draft) => count + Object.keys(draft.fields).length, 0),
    discard,
    reconcile: (view: CanvasControllerSnapshot) => {
      if (!view.enabled || view.ownerId !== ownerId) {
        if (snapshot.drafts.size || snapshot.intent) publish({ intent: null, drafts: new Map(), focus: null });
        return;
      }
      if (!view.ready) return;
      const liveDocuments = new Set(view.documents.map((document) => document.id));
      const alive = (target: CanvasEditorTarget) => liveDocuments.has(target.canvasId)
        && (view.active?.document.id !== target.canvasId || view.active.scene.nodes.some((node) => node.id === target.nodeId));
      const drafts = new Map([...snapshot.drafts].filter(([, draft]) => alive(draft.target)));
      const intent = snapshot.intent && alive(snapshot.intent.target) ? snapshot.intent : null;
      const focus = snapshot.focus && alive(snapshot.focus.target) ? snapshot.focus : null;
      if (drafts.size !== snapshot.drafts.size || intent !== snapshot.intent || focus !== snapshot.focus) publish({ drafts, intent, focus });
    },
  };
}

export type CanvasEditorPort = ReturnType<typeof createCanvasEditorState> & { state: CanvasEditorSnapshot };
