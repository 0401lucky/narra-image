"use client";

// 按账户/会话加载内容；选择、请求和挂载轮次共同拒绝迟到响应。
// 只显式加载一页更早记录，保留本地已接收任务和终态，不使用全局历史兜底。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CANVAS_LIMITS } from "@/lib/canvas/contracts";
import type { ConversationGenerationsPage } from "@/lib/conversations/contracts";

import { STUDIO_READ_TIMEOUT_MS } from "../constants";
import { isGenerationItem } from "../generation-item";
import type { GenerationItem, SessionInfo } from "../types";

type ConversationEntry = {
  generations: Map<string, GenerationItem>;
  replacedIds: Set<string>;
  loaded: boolean;
  nextCursor: string | null;
  loading: boolean;
  loadingOlder: boolean;
  error: string | null;
  failedCursor: string | null;
};

type PageRequest = {
  conversationId: string;
  entry: ConversationEntry;
  controller: AbortController;
  mountEpoch: number;
  selectionEpoch: number;
};

type ConversationContext = {
  scope: object;
  ownerId: string;
  active: boolean;
  mountEpoch: number;
  selectionEpoch: number;
  selectedId: string | null;
  entries: Map<string, ConversationEntry>;
  deletedIds: Set<string>;
  request: PageRequest | null;
};

type UseConversationGenerationsOptions = {
  ownerId: string;
  initialPage?: ConversationGenerationsPage | null;
  initialConversations?: SessionInfo[];
  initialGenerations?: GenerationItem[];
};

type ConversationView = {
  scope: object;
  conversationId: string | null;
  generations: GenerationItem[];
  loading: boolean;
  loadingOlder: boolean;
  error: string | null;
  hasMore: boolean;
};

type UseConversationGenerationsResult = Omit<ConversationView, "scope"> & {
  selectConversation: (id: string | null) => void;
  registerConversation: (session: SessionInfo) => void;
  forgetConversation: (id: string) => void;
  acceptGeneration: (conversationId: string, generation: GenerationItem, replaceId?: string | null) => boolean;
  updateGeneration: (generation: GenerationItem) => void;
  loadOlder: () => Promise<void>;
  reload: () => Promise<void>;
};

function emptyEntry(loaded = false): ConversationEntry {
  return { generations: new Map(), replacedIds: new Set(), loaded, nextCursor: null, loading: false, loadingOlder: false, error: null, failedCursor: null };
}

function mergeGeneration(entry: ConversationEntry, generation: GenerationItem) {
  if (entry.replacedIds.has(generation.id)) return;
  const current = entry.generations.get(generation.id);
  if (current) {
    if (current.status !== "pending" && generation.status !== current.status) return;
    if (current.status === generation.status && current.updatedAt && generation.updatedAt
      && Date.parse(current.updatedAt) > Date.parse(generation.updatedAt)) return;
  }
  entry.generations.set(generation.id, generation);
}

function seedContext(scope: object, { ownerId, initialPage, initialConversations = [], initialGenerations = [] }: UseConversationGenerationsOptions): ConversationContext {
  const entries = new Map<string, ConversationEntry>();
  for (const session of initialConversations) {
    const entry = emptyEntry();
    for (const generation of initialGenerations) {
      if (generation.conversationId === session.id) mergeGeneration(entry, generation);
    }
    entry.loaded = session.generationCount === undefined
      ? session.generationIds.every((id) => entry.generations.has(id))
      : entry.generations.size >= session.generationCount;
    entries.set(session.id, entry);
  }
  if (initialPage) {
    const entry = entries.get(initialPage.conversationId) ?? emptyEntry();
    for (const generation of initialPage.generations) {
      if (generation.conversationId === initialPage.conversationId) mergeGeneration(entry, generation);
    }
    entry.loaded = true;
    entry.nextCursor = initialPage.nextCursor;
    entries.set(initialPage.conversationId, entry);
  }
  return { scope, ownerId, active: false, mountEpoch: 0, selectionEpoch: 0, selectedId: null, entries, deletedIds: new Set(), request: null };
}

function abortRequest(context: ConversationContext) {
  const request = context.request;
  context.request = null;
  if (!request) return;
  request.controller.abort();
  request.entry.loading = false;
  request.entry.loadingOlder = false;
}

function readView(context: ConversationContext): ConversationView {
  const entry = context.selectedId ? context.entries.get(context.selectedId) : undefined;
  return {
    scope: context.scope,
    conversationId: context.selectedId,
    generations: entry ? [...entry.generations.values()].sort((a, b) => {
      const time = Date.parse(a.createdAt) - Date.parse(b.createdAt);
      return time || (a.id === b.id ? 0 : a.id < b.id ? -1 : 1);
    }) : [],
    loading: entry?.loading ?? false,
    loadingOlder: entry?.loadingOlder ?? false,
    error: entry?.error ?? null,
    hasMore: Boolean(entry?.nextCursor),
  };
}

type ConversationClientPage = Omit<ConversationGenerationsPage, "generations"> & { generations: GenerationItem[] };

function isPageForConversation(value: unknown, id: string): value is ConversationClientPage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const page = value as Record<string, unknown>;
  return page.conversationId === id && Array.isArray(page.generations)
    && page.generations.length <= CANVAS_LIMITS.maximumPageSize
    && (page.nextCursor === null || (typeof page.nextCursor === "string" && page.nextCursor.length <= 2048 && /^[A-Za-z0-9_-]+$/.test(page.nextCursor)))
    && page.generations.every((generation) => isGenerationItem(generation) && generation.conversationId === id);
}

export function useConversationGenerations(options: UseConversationGenerationsOptions): UseConversationGenerationsResult {
  // A refresh is not a new bootstrap. A different authenticated owner is.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const bootstrap = useMemo(() => ({ ...options }), [options.ownerId]);
  const contextRef = useRef<ConversationContext | null>(null);
  const [view, setView] = useState<ConversationView>(() => ({
    scope: bootstrap, conversationId: null, generations: [], loading: false, loadingOlder: false, error: null, hasMore: false,
  }));
  const getContext = useCallback(() => {
    const context = contextRef.current;
    return context?.scope === bootstrap && context.active ? context : null;
  }, [bootstrap]);
  const publish = useCallback(() => {
    const context = getContext();
    if (context) setView(readView(context));
  }, [getContext]);

  const requestPage = useCallback(async (cursor: string | null) => {
    const context = getContext();
    if (!context) return;
    const id = context.selectedId;
    if (!context.active || !id || context.deletedIds.has(id) || context.request) return;
    const entry = context.entries.get(id);
    if (!entry) return;
    const request: PageRequest = {
      conversationId: id, entry, controller: new AbortController(),
      mountEpoch: context.mountEpoch, selectionEpoch: context.selectionEpoch,
    };
    context.request = request;
    entry.loading = cursor === null;
    entry.loadingOlder = cursor !== null;
    entry.error = null;
    entry.failedCursor = null;
    publish();
    const isCurrent = () => getContext() === context && context.request === request
      && context.mountEpoch === request.mountEpoch && context.selectionEpoch === request.selectionEpoch
      && context.selectedId === id && context.entries.get(id) === entry && !context.deletedIds.has(id)
      && !request.controller.signal.aborted;
    let failureMessage = "会话加载失败，请稍后重试";
    let timedOut = false;
    let rejectAbort: (reason?: unknown) => void = () => {};
    const interrupted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
    const onAbort = () => rejectAbort(request.controller.signal.reason);
    request.controller.signal.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => { timedOut = true; request.controller.abort(); }, STUDIO_READ_TIMEOUT_MS);
    try {
      const read = async () => {
        const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
        const response = await fetch(`/api/me/conversations/${encodeURIComponent(id)}/generations${query}`, {
          cache: "no-store", credentials: "same-origin", signal: request.controller.signal,
        });
        if (!isCurrent()) return;
        if (!response.ok) {
          if (response.status === 404) {
            entry.generations.clear();
            entry.nextCursor = null;
            context.deletedIds.add(id);
            failureMessage = "会话不存在，请选择其他会话";
          }
          throw new Error(failureMessage);
        }
        failureMessage = "会话内容格式不正确，请重试";
        const result: unknown = await response.json();
        if (!isCurrent()) return;
        const data = result && typeof result === "object" && "data" in result ? result.data : undefined;
        if (!isPageForConversation(data, id) || (cursor !== null && data.nextCursor === cursor)) {
          throw new Error(failureMessage);
        }
        for (const generation of data.generations) mergeGeneration(entry, generation);
        entry.loaded = true;
        entry.nextCursor = data.nextCursor;
      };
      // A stalled fetch/body that ignores abort cannot retain the loading guard.
      // Late continuations still check the captured request and selection epoch.
      await Promise.race([read(), interrupted]);
    } catch {
      if (context.request !== request || !context.active || context.mountEpoch !== request.mountEpoch
        || context.selectionEpoch !== request.selectionEpoch || (request.controller.signal.aborted && !timedOut)) return;
      entry.error = timedOut ? "会话加载超时，请重试" : failureMessage;
      entry.failedCursor = cursor;
    } finally {
      clearTimeout(timeout);
      request.controller.signal.removeEventListener("abort", onAbort);
      if (context.request === request) {
        context.request = null;
        entry.loading = false;
        entry.loadingOlder = false;
        publish();
      }
    }
  }, [getContext, publish]);

  useEffect(() => {
    if (contextRef.current?.scope !== bootstrap) contextRef.current = seedContext(bootstrap, bootstrap);
    const context = contextRef.current;
    context.active = true;
    context.mountEpoch += 1;
    // Browser-only selection is initialized after mount; owner changes reset its namespace.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    publish();
    const entry = context.selectedId ? context.entries.get(context.selectedId) : undefined;
    if (entry && !entry.loaded) void requestPage(null);
    return () => {
      context.active = false;
      context.mountEpoch += 1;
      abortRequest(context);
    };
  }, [bootstrap, publish, requestPage]);

  const selectConversation = useCallback((id: string | null) => {
    const context = getContext();
    if (!context) return;
    context.selectionEpoch += 1;
    abortRequest(context);
    context.selectedId = id && !context.deletedIds.has(id) ? id : null;
    if (context.selectedId && !context.entries.has(context.selectedId)) context.entries.set(context.selectedId, emptyEntry());
    publish();
    const entry = context.selectedId ? context.entries.get(context.selectedId) : undefined;
    if (entry && !entry.loaded) void requestPage(null);
  }, [getContext, publish, requestPage]);

  const registerConversation = useCallback((session: SessionInfo) => {
    const context = getContext();
    if (!context || context.deletedIds.has(session.id) || context.entries.has(session.id)) return;
    context.entries.set(session.id, emptyEntry((session.generationCount ?? session.generationIds.length) === 0));
  }, [getContext]);

  const forgetConversation = useCallback((id: string) => {
    const context = getContext();
    if (!context) return;
    context.deletedIds.add(id);
    context.entries.delete(id);
    if (context.selectedId === id) selectConversation(null);
  }, [getContext, selectConversation]);

  const acceptGeneration = useCallback((conversationId: string, generation: GenerationItem, replaceId?: string | null): boolean => {
    const context = getContext();
    if (!context || context.deletedIds.has(conversationId) || generation.conversationId !== conversationId) return false;
    const entry = context.entries.get(conversationId);
    if (!entry) return false;
    if (replaceId && replaceId !== generation.id) {
      entry.replacedIds.add(replaceId);
      entry.generations.delete(replaceId);
    }
    mergeGeneration(entry, generation);
    publish();
    return true;
  }, [getContext, publish]);

  const updateGeneration = useCallback((generation: GenerationItem) => {
    const context = getContext();
    if (!context) return;
    for (const [id, entry] of context.entries) {
      if (context.deletedIds.has(id) || !entry.generations.has(generation.id)) continue;
      if (generation.conversationId !== undefined && generation.conversationId !== id) {
        entry.generations.delete(generation.id);
      } else {
        mergeGeneration(entry, generation);
      }
    }
    publish();
  }, [getContext, publish]);

  const loadOlder = useCallback(async () => {
    const context = getContext();
    if (!context) return;
    const cursor = context.selectedId ? context.entries.get(context.selectedId)?.nextCursor : null;
    if (cursor) await requestPage(cursor);
  }, [getContext, requestPage]);

  const reload = useCallback(async () => {
    const context = getContext();
    if (!context) return;
    const entry = context.selectedId ? context.entries.get(context.selectedId) : undefined;
    // Retry the failed page; a first-page refresh must not rewind an older-page error.
    const cursor = entry?.error ? entry.failedCursor : null;
    context.selectionEpoch += 1;
    abortRequest(context);
    await requestPage(cursor);
  }, [getContext, requestPage]);

  const current = view.scope === bootstrap ? view : {
    conversationId: null, generations: [], loading: false, loadingOlder: false, error: null, hasMore: false,
  };
  return {
    conversationId: current.conversationId, generations: current.generations,
    loading: current.loading, loadingOlder: current.loadingOlder, error: current.error, hasMore: current.hasMore,
    selectConversation, registerConversation, forgetConversation, acceptGeneration, updateGeneration, loadOlder, reload,
  };
}
