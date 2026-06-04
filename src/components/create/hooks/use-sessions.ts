"use client";

// 会话状态 Hook（服务端持久化版本）。
// 数据存储：通过 /api/me/conversations 与 /api/me/conversations/[id] 完整迁移到 PostgreSQL。
// 改进点（相对 localStorage 版本）：
// 1) 跨设备一致：服务端为唯一事实来源，多设备登录看到同一份会话；
// 2) 支持管理后台审计：会话与 generation 通过外键关联，运维可见；
// 3) localStorage 仅缓存 lastActiveConversationId，提升下次进入页面的体感。
import { useCallback, useEffect, useState } from "react";

import type { SessionInfo } from "../types";

const ACTIVE_KEY = "narra_active_conversation_id";

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

function dtoToSessionInfo(dto: ConversationDTO): SessionInfo {
  return {
    createdAt: dto.createdAt,
    generationIds: dto.generationIds,
    id: dto.id,
    title: dto.title,
  };
}

export function useSessions(initial: SessionInfo[] = []) {
  const [sessions, setSessions] = useState<SessionInfo[]>(initial);

  // 拉取最新会话列表；用于初始化和外部强刷新。
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/me/conversations");
      if (!response.ok) return;
      const json = (await response.json()) as ApiResponse<{ conversations: ConversationDTO[] }>;
      if (json.data?.conversations) {
        setSessions(json.data.conversations.map(dtoToSessionInfo));
      }
    } catch {
      // 静默失败：保持现有 sessions。前端已有本地状态可用，下一次操作会重试。
    }
  }, []);

  // 创建会话；可选 title。
  const createSession = useCallback(async (title?: string): Promise<SessionInfo | null> => {
    try {
      const response = await fetch("/api/me/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(title ? { title } : {}),
      });
      if (!response.ok) return null;
      const json = (await response.json()) as ApiResponse<{ conversation: ConversationDTO }>;
      const dto = json.data?.conversation;
      if (!dto) return null;
      const next = dtoToSessionInfo(dto);
      setSessions((prev) => [next, ...prev]);
      return next;
    } catch {
      return null;
    }
  }, []);

  // 重命名会话；title 由调用方决定（一般在首次发送 generation 后调用）。
  const renameSession = useCallback(async (id: string, title: string) => {
    try {
      const response = await fetch(`/api/me/conversations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!response.ok) return;
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)));
    } catch {
      // 失败时保持本地状态；下一次 refresh 会纠正。
    }
  }, []);

  // 在本地状态中追加 generationId（不发起 API 调用，因为 generation 写入时已经把 conversationId 写到 GenerationJob 上）。
  const appendGeneration = useCallback((sessionId: string, generationId: string) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId
          ? { ...s, generationIds: [...s.generationIds, generationId] }
          : s,
      ),
    );
  }, []);

  const replaceGeneration = useCallback((sessionId: string, previousId: string, nextId: string) => {
    setSessions((prev) =>
      prev.map((s) => {
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
      }),
    );
  }, []);

  // 删除会话。
  const deleteSession = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/me/conversations/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) return;
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch {
      // 静默失败；用户可重试。
    }
  }, []);

  // 读写"上次活跃的会话 id"，仅用 localStorage 做体感缓存（不存核心数据）。
  const readLastActive = useCallback(() => {
    if (typeof window === "undefined") return null;
    try {
      return localStorage.getItem(ACTIVE_KEY);
    } catch {
      return null;
    }
  }, []);
  const writeLastActive = useCallback((id: string | null) => {
    if (typeof window === "undefined") return;
    try {
      if (id) localStorage.setItem(ACTIVE_KEY, id);
      else localStorage.removeItem(ACTIVE_KEY);
    } catch {
      // 隐私模式或配额不足：忽略。
    }
  }, []);

  // 跨标签同步：当其它标签更新了"上次活跃会话"时，自动 refresh。
  // 数据本身存于服务端，所以这里不需要监听特定 key 的变化做合并。
  useEffect(() => {
    if (typeof window === "undefined") return;
    function handleStorage(event: StorageEvent) {
      if (event.key === ACTIVE_KEY) {
        // 仅当其它标签切换了活跃会话；此处不强制 refresh 减少抖动。
      }
    }
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  return {
    sessions,
    setSessions,
    refresh,
    createSession,
    renameSession,
    appendGeneration,
    replaceGeneration,
    deleteSession,
    readLastActive,
    writeLastActive,
  };
}
