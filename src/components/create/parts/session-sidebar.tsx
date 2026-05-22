"use client";

// 左侧会话列表侧边栏。完全受控：sessions / activeSessionId 由父组件传入。
import { MessageSquare, PanelLeftClose, SquarePen, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { getThumbUrl } from "@/lib/image-url";
import { formatSessionTime } from "../utils";
import type { SessionInfo } from "../types";

type SessionSidebarProps = {
  sessions: SessionInfo[];
  activeSessionId: string | null;
  open: boolean;
  onClose: () => void;
  onNewConversation: () => void;
  onSwitchSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  // Mobile recent images integration
  historyImages?: Array<{ id: string; url: string; createdAt: string }>;
  onPickImage?: (url: string) => void;
};

export function SessionSidebar({
  sessions,
  activeSessionId,
  open,
  onClose,
  onNewConversation,
  onSwitchSession,
  onDeleteSession,
  historyImages = [],
  onPickImage,
}: SessionSidebarProps) {
  const [activeTab, setActiveTab] = useState<"sessions" | "images">("sessions");

  // 倒序展示：最新会话在最上；用 useMemo 避免每次渲染都构造新数组。
  const displaySessions = useMemo(() => [...sessions].reverse(), [sessions]);
  return (
    <>
      {/* 移动端遮罩：仅在打开时渲染，避免桌面端额外节点。 */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/30 md:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={`${
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        } fixed md:relative z-40 md:z-0 flex h-full w-72 shrink-0 flex-col bg-[#f6efe6]/82 transition-transform duration-200 ease-out backdrop-blur-xl xl:w-80`}
      >
        <div className="flex items-center gap-2 p-4">
          <button
            onClick={onNewConversation}
            className="flex flex-1 items-center justify-between rounded-[1.15rem] bg-[#24170f] px-5 py-4 text-sm font-semibold text-white shadow-[0_16px_34px_rgba(36,23,15,0.2)] transition hover:-translate-y-0.5 hover:bg-[var(--accent)]"
          >
            <span className="inline-flex items-center gap-2">
              <SquarePen className="size-4" />
              新建对话
            </span>
            <span aria-hidden className="text-lg leading-none text-[#f1b99a]">✦</span>
          </button>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-[var(--ink-soft)] transition hover:bg-[var(--surface-strong)] md:hidden"
          >
            <PanelLeftClose className="size-4" />
          </button>
        </div>
        {/* Tab switcher: Only shown on mobile since desktop has its own HistoryRail */}
        <div className="mx-4 mb-3 flex rounded-xl border border-[var(--line)] bg-[#f7efe4]/70 p-1 md:hidden shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab("sessions")}
            className={`flex-1 rounded-lg py-1.5 text-center text-xs font-semibold transition ${
              activeTab === "sessions"
                ? "bg-[#24170f] text-white shadow-sm"
                : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
            }`}
          >
            对话历史
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("images")}
            className={`flex-1 rounded-lg py-1.5 text-center text-xs font-semibold transition ${
              activeTab === "images"
                ? "bg-[#24170f] text-white shadow-sm"
                : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
            }`}
          >
            最近图片
          </button>
        </div>

        <div className="px-4 pb-2 text-sm font-semibold text-[#3a281d] hidden md:block">对话历史</div>
        <div className="premium-scrollbar flex-1 overflow-y-auto px-4 pb-4">
          {activeTab === "images" ? (
            historyImages.length === 0 ? (
              <div className="flex h-32 flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--line)] bg-[#fffaf2]/42 text-center">
                <p className="text-xs text-[var(--ink-soft)]">暂无历史生成图片</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {historyImages.map((image) => (
                  <button
                    key={image.id}
                    type="button"
                    onClick={() => onPickImage?.(image.url)}
                    className="group relative overflow-hidden rounded-xl border-4 border-white bg-[#fffaf2] shadow-sm transition hover:border-[#fff4e5] active:scale-95"
                    title="点击放大"
                  >
                    <img
                      src={getThumbUrl(image.url, 256)}
                      alt="历史图片"
                      loading="lazy"
                      decoding="async"
                      className="block aspect-square w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                    />
                  </button>
                ))}
              </div>
            )
          ) : sessions.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--line)] bg-[#fffaf2]/42 text-center">
              <MessageSquare className="size-6 text-[var(--ink-soft)] opacity-30 mb-2" />
              <p className="text-xs text-[var(--ink-soft)]">暂无会话记录</p>
            </div>
          ) : (
            <div className="space-y-2">
              {displaySessions.map((session) => (
                <div
                  key={session.id}
                  className={`group flex w-full cursor-pointer items-center gap-3 rounded-2xl border px-3 py-3 text-left shadow-sm transition ${
                    activeSessionId === session.id
                      ? "border-[#c78f55] bg-[#fff5e6] shadow-[0_12px_26px_rgba(84,52,29,0.1)]"
                      : "border-transparent bg-[#fffaf2]/48 hover:border-[var(--line)] hover:bg-[#fffaf2]/80"
                  }`}
                  onClick={() => onSwitchSession(session.id)}
                >
                  <div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl border border-[var(--line)] bg-[linear-gradient(135deg,#f1b99a,#fffaf2_45%,#9a77c7)] text-xs font-semibold text-[#24170f]">
                    {session.title?.trim()?.[0] ?? "图"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-[var(--ink)] truncate leading-tight">
                      {session.title || "新对话"}
                    </p>
                    <p className="text-[10px] text-[var(--ink-soft)] mt-0.5">
                      {session.generationIds.length} 轮 · {formatSessionTime(session.createdAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={`删除会话 ${session.title || "新对话"}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteSession(session.id);
                    }}
                    className="shrink-0 rounded-md p-1 text-[var(--ink-soft)]/40 transition group-hover:text-[var(--ink-soft)] focus:text-[var(--ink-soft)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] hover:bg-rose-50 hover:text-rose-500"
                    title="删除会话"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
