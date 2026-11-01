"use client";

// 仅 DOM 生命周期属于聊天面板：返回聊天时重新测量、观察和绑定输入状态。
// 提示词、参考图、设置及任务仍由上层工作台持有。
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";

import { Alert } from "@/components/ui/alert";

import { ChatStream } from "./chat-stream";
import { Composer } from "./composer";

type ChatPaneProps = {
  stream: Omit<ComponentProps<typeof ChatStream>, "ref" | "bottomInset">;
  composer: Omit<ComponentProps<typeof Composer>, "ref" | "shellRef" | "onCompositionStart" | "onCompositionEnd" | "isComposing" | "children">;
  focusRequest: number;
  history?: {
    conversationId: string | null;
    loading: boolean;
    loadingOlder: boolean;
    error: string | null;
    hasMore: boolean;
    onReload: () => Promise<void>;
    onLoadOlder: () => Promise<void>;
  };
  children?: ReactNode;
};

export function ChatPane({ stream, composer, focusRequest, history, children }: ChatPaneProps) {
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const composerShellRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isComposingRef = useRef(false);
  const [bottomInset, setBottomInset] = useState(0);
  const hideStream = stream.generations.length === 0 && Boolean(history?.loading || history?.error);

  useEffect(() => {
    const element = scrollAreaRef.current;
    if (!element || typeof element.scrollTo !== "function") return;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (distanceFromBottom < 80) element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  }, [stream.generations, composer.isPending, hideStream]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 144)}px`;
  }, [composer.prompt]);

  useEffect(() => {
    const shell = composerShellRef.current;
    if (!shell) return;
    const updateBottomInset = () => {
      const next = Math.ceil(shell.getBoundingClientRect().height);
      setBottomInset((current) => current === next ? current : next);
    };
    updateBottomInset();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateBottomInset);
    observer?.observe(shell);
    window.addEventListener("resize", updateBottomInset);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateBottomInset);
    };
  }, []);

  useEffect(() => {
    if (focusRequest === 0) return;
    const frame = requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [focusRequest]);

  return (
    <>
      {history?.conversationId && (history.hasMore || history.error || history.loading) && (
        <div className="relative z-10 shrink-0 space-y-2 border-b border-[var(--line)]/50 bg-[#fffaf2]/70 px-4 py-3 text-center text-sm text-[var(--ink-soft)]">
          {history.error && (
            <Alert variant="error">
              {history.error}
              <button type="button" onClick={() => void history.onReload()} className="ml-3 font-semibold underline">重试加载</button>
            </Alert>
          )}
          {history.hasMore && (
            <button
              type="button"
              disabled={history.loading || history.loadingOlder}
              onClick={() => void history.onLoadOlder()}
              className="rounded-full border border-[var(--line)] bg-white/80 px-4 py-1.5 font-medium transition hover:bg-white disabled:opacity-50"
            >
              {history.loadingOlder ? "正在加载更早记录..." : "加载更早记录"}
            </button>
          )}
          {history.loading && <span role="status" aria-live="polite">正在加载会话...</span>}
        </div>
      )}
      {hideStream ? <div className="relative flex-1" /> : (
        <ChatStream {...stream} ref={scrollAreaRef} bottomInset={bottomInset} />
      )}
      <Composer
        {...composer}
        ref={textareaRef}
        shellRef={composerShellRef}
        onCompositionStart={() => { isComposingRef.current = true; }}
        onCompositionEnd={() => { isComposingRef.current = false; }}
        isComposing={() => isComposingRef.current}
      >
        {children}
      </Composer>
    </>
  );
}
