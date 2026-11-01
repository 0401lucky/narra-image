"use client";

// 会话元数据只在账户首次挂载时初始化，不把刷新结果覆盖到本地操作上。
// 所有异步写入检查账户/挂载轮次；新会话还检查调用方捕获的草稿是否仍有效。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { SessionInfo } from "../types";

type ApiResponse<T> = {
  data?: T;
  error?: string;
};

type ConversationDTO = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  generationIds: string[];
};

function dtoToSessionInfo(value: unknown): SessionInfo | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const dto = value as Partial<ConversationDTO>;
  if (typeof dto.id !== "string" || !dto.id.trim() || typeof dto.title !== "string"
    || typeof dto.createdAt !== "string" || !Number.isFinite(Date.parse(dto.createdAt))
    || !Array.isArray(dto.generationIds)
    || !dto.generationIds.every((id) => typeof id === "string" && id.trim())) return null;
  return {
    createdAt: dto.createdAt,
    generationIds: [...dto.generationIds],
    generationCount: dto.generationIds.length,
    id: dto.id,
    title: dto.title,
  };
}

type CreateSessionOptions = {
  signal?: AbortSignal;
  isCurrent?: () => boolean;
};

type SessionContext = {
  scope: object;
  active: boolean;
  epoch: number;
  sessions: SessionInfo[];
  deleting: Set<string>;
  deleted: Set<string>;
  requests: Set<AbortController>;
};

type UseSessionsResult = {
  sessions: SessionInfo[];
  createSession: (title?: string, options?: CreateSessionOptions) => Promise<SessionInfo | null>;
  renameSession: (id: string, title: string) => Promise<void>;
  appendGeneration: (sessionId: string, generationId: string) => void;
  replaceGeneration: (sessionId: string, previousId: string, nextId: string) => void;
  deleteSession: (id: string) => Promise<boolean>;
  isSessionLive: (id: string) => boolean;
  readLastActive: () => string | null;
  writeLastActive: (id: string | null) => void;
};

export function useSessions(ownerId: string, initial: SessionInfo[] = []): UseSessionsResult {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const bootstrap = useMemo(() => ({ ownerId, initial }), [ownerId]);
  const contextRef = useRef<SessionContext | null>(null);
  const [view, setView] = useState(() => ({ scope: bootstrap, sessions: initial }));
  const activeKey = `narra_active_conversation_id:${ownerId}`;

  const getContext = useCallback(() => {
    const context = contextRef.current;
    return context?.scope === bootstrap && context.active ? context : null;
  }, [bootstrap]);
  const publish = useCallback((context: SessionContext) => {
    if (getContext() === context) setView({ scope: bootstrap, sessions: context.sessions });
  }, [bootstrap, getContext]);

  useEffect(() => {
    if (contextRef.current?.scope !== bootstrap) {
      contextRef.current = {
        scope: bootstrap, active: false, epoch: 0, sessions: bootstrap.initial,
        deleting: new Set(), deleted: new Set(), requests: new Set(),
      };
    }
    const context = contextRef.current;
    context.active = true;
    context.epoch += 1;
    publish(context);
    return () => {
      context.active = false;
      context.epoch += 1;
      context.requests.forEach((controller) => controller.abort());
      context.requests.clear();
    };
  }, [bootstrap, publish]);

  const beginRequest = useCallback((signal?: AbortSignal) => {
    const context = getContext();
    if (!context || signal?.aborted) return null;
    const controller = new AbortController();
    const epoch = context.epoch;
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    context.requests.add(controller);
    return {
      context,
      signal: controller.signal,
      isCurrent: () => getContext() === context && context.epoch === epoch && !controller.signal.aborted,
      finish: () => {
        context.requests.delete(controller);
        signal?.removeEventListener("abort", abort);
      },
    };
  }, [getContext]);

  const createSession = useCallback(async (title?: string, options: CreateSessionOptions = {}): Promise<SessionInfo | null> => {
    if (options.isCurrent && !options.isCurrent()) return null;
    const request = beginRequest(options.signal);
    if (!request) return null;
    const isCurrent = () => request.isCurrent() && (!options.isCurrent || options.isCurrent());
    try {
      const response = await fetch("/api/me/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(title ? { title } : {}),
        signal: request.signal,
      });
      if (!isCurrent() || !response.ok) return null;
      const json = (await response.json()) as ApiResponse<{ conversation: unknown }> | null;
      if (!isCurrent()) return null;
      const next = dtoToSessionInfo(json?.data?.conversation);
      if (!next || request.context.deleted.has(next.id)) return null;
      request.context.sessions = [next, ...request.context.sessions.filter((session) => session.id !== next.id)];
      publish(request.context);
      return next;
    } catch {
      return null;
    } finally {
      request.finish();
    }
  }, [beginRequest, publish]);

  const isSessionLive = useCallback((id: string) => {
    const context = getContext();
    return Boolean(context && !context.deleting.has(id) && !context.deleted.has(id)
      && context.sessions.some((session) => session.id === id));
  }, [getContext]);

  // 重命名会话；title 由调用方决定（一般在首次发送 generation 后调用）。
  const renameSession = useCallback(async (id: string, title: string) => {
    if (!isSessionLive(id)) return;
    const request = beginRequest();
    if (!request) return;
    try {
      const response = await fetch(`/api/me/conversations/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
        signal: request.signal,
      });
      if (!request.isCurrent() || !response.ok || !isSessionLive(id)) return;
      request.context.sessions = request.context.sessions.map((session) => session.id === id ? { ...session, title } : session);
      publish(request.context);
    } catch {
      // 保留本地元数据，重新打开页面时再读取服务端快照。
    } finally {
      request.finish();
    }
  }, [beginRequest, isSessionLive, publish]);

  // 在本地状态中追加 generationId（不发起 API 调用，因为 generation 写入时已经把 conversationId 写到 GenerationJob 上）。
  const appendGeneration = useCallback((sessionId: string, generationId: string) => {
    const context = getContext();
    if (!context || !isSessionLive(sessionId)) return;
    context.sessions = context.sessions.map((s) =>
      s.id === sessionId && !s.generationIds.includes(generationId)
        ? { ...s, generationIds: [...s.generationIds, generationId], generationCount: (s.generationCount ?? s.generationIds.length) + 1 }
        : s,
    );
    publish(context);
  }, [getContext, isSessionLive, publish]);

  const replaceGeneration = useCallback((sessionId: string, previousId: string, nextId: string) => {
    const context = getContext();
    if (!context || !isSessionLive(sessionId)) return;
    context.sessions = context.sessions.map((s) => {
      if (s.id !== sessionId) return s;
      if (!s.generationIds.includes(previousId)) {
        return s.generationIds.includes(nextId)
          ? s
          : { ...s, generationIds: [...s.generationIds, nextId] };
      }
      const generationIds = s.generationIds
        .map((id) => (id === previousId ? nextId : id))
        .filter((id, index, ids) => ids.indexOf(id) === index);
      return { ...s, generationIds };
    });
    publish(context);
  }, [getContext, isSessionLive, publish]);

  // 删除会话。
  const deleteSession = useCallback(async (id: string) => {
    if (!isSessionLive(id)) return false;
    const request = beginRequest();
    if (!request) return false;
    request.context.deleting.add(id);
    try {
      const response = await fetch(`/api/me/conversations/${encodeURIComponent(id)}`, {
        method: "DELETE",
        signal: request.signal,
      });
      if (!request.isCurrent() || !response.ok) return false;
      request.context.deleted.add(id);
      request.context.sessions = request.context.sessions.filter((session) => session.id !== id);
      publish(request.context);
      return true;
    } catch {
      return false;
    } finally {
      request.context.deleting.delete(id);
      request.finish();
    }
  }, [beginRequest, isSessionLive, publish]);

  // 读写"上次活跃的会话 id"，仅用 localStorage 做体感缓存（不存核心数据）。
  const readLastActive = useCallback(() => {
    if (!getContext() || typeof window === "undefined") return null;
    try {
      return localStorage.getItem(activeKey);
    } catch {
      return null;
    }
  }, [activeKey, getContext]);
  const writeLastActive = useCallback((id: string | null) => {
    if (!getContext() || typeof window === "undefined") return;
    try {
      if (id) localStorage.setItem(activeKey, id);
      else localStorage.removeItem(activeKey);
    } catch {
      // 隐私模式或配额不足：忽略。
    }
  }, [activeKey, getContext]);

  return {
    sessions: view.scope === bootstrap ? view.sessions : [],
    createSession,
    renameSession,
    appendGeneration,
    replaceGeneration,
    deleteSession,
    isSessionLive,
    readLastActive,
    writeLastActive,
  };
}
