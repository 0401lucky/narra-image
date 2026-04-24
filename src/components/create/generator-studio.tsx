"use client";

import { Sparkles, WandSparkles, Download, ZoomIn, X, ImagePlus, Settings2, Send, Paperclip, SquarePen, PanelLeftClose, PanelLeftOpen, Trash2, MessageSquare } from "lucide-react";
import { useMemo, useRef, useState, useTransition, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

import { CheckInButton } from "@/components/benefits/check-in-button";
import type { GenerationType } from "@/lib/types";

type ViewerUser = {
  credits: number;
  role: "user" | "admin";
} | null;

type GenerationItem = {
  count: number;
  createdAt: string;
  creditsSpent: number;
  generationType: GenerationType;
  id: string;
  images: Array<{
    id: string;
    url: string;
  }>;
  model: string;
  negativePrompt?: string | null;
  prompt: string;
  providerMode: "built_in" | "custom";
  size: string;
  sourceImageUrl: string | null;
  status: "pending" | "succeeded" | "failed";
};

type SavedProvider = {
  baseUrl: string;
  label?: string | null;
  model: string;
} | null;

type ChannelInfo = {
  creditCost: number;
  defaultModel: string;
  id: string;
  models: string[];
  name: string;
};

type GeneratorStudioProps = {
  compact?: boolean;
  checkInSummary: {
    checkInReward: number;
    checkedInToday: boolean;
  };
  currentUser: ViewerUser;
  initialGenerations?: GenerationItem[];
  initialSavedProvider?: (SavedProvider & { models?: string[] }) | null;
  channels?: ChannelInfo[];
};

// --- Session helpers ---
type SessionInfo = {
  id: string;
  title: string;
  generationIds: string[];
  createdAt: string;
};

function genSessionId() {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function loadSessions(): SessionInfo[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem("narra_sessions") || "[]");
  } catch { return []; }
}

function saveSessions(sessions: SessionInfo[]) {
  localStorage.setItem("narra_sessions", JSON.stringify(sessions));
}

export function GeneratorStudio({
  compact = false,
  checkInSummary,
  currentUser,
  initialGenerations = [],
  initialSavedProvider = null,
  channels = [],
}: GeneratorStudioProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isFetchingModels, startFetchingModels] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [modelProbeError, setModelProbeError] = useState<string | null>(null);
  const [generationType, setGenerationType] = useState<GenerationType>("text_to_image");
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(
    channels[0]?.id ?? null
  );
  const selectedChannel = channels.find((c) => c.id === selectedChannelId) ?? channels[0] ?? null;
  const [model, setModel] = useState(
    initialSavedProvider?.model || selectedChannel?.defaultModel || "gpt-image-1",
  );
  const [availableModels, setAvailableModels] = useState<string[]>(
    initialSavedProvider?.models || []
  );
  const [size, setSize] = useState<"1024x1024" | "1024x1536" | "1536x1024">(
    "1024x1024",
  );
  const [count, setCount] = useState(1);
  const [providerMode, setProviderMode] = useState<"built_in" | "custom">(
    "built_in",
  );
  const [customBaseUrl, setCustomBaseUrl] = useState(
    initialSavedProvider?.baseUrl || "",
  );
  const [customApiKey, setCustomApiKey] = useState("");
  const [rememberProvider, setRememberProvider] = useState(false);
  const [allGenerations] = useState(initialGenerations);
  const [credits, setCredits] = useState(currentUser?.credits ?? 0);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [referenceImage, setReferenceImage] = useState<{
    file: File;
    previewUrl: string;
  } | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // Session state
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionGenerations, setSessionGenerations] = useState<GenerationItem[]>([]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Initialize sessions from localStorage and backfill legacy generations
  useEffect(() => {
    let stored = loadSessions();
    const knownIds = new Set(stored.flatMap((s) => s.generationIds));
    const orphans = initialGenerations.filter((g) => !knownIds.has(g.id));

    if (orphans.length > 0 && stored.length === 0) {
      // First time — create a session for legacy data
      const legacy: SessionInfo = {
        id: genSessionId(),
        title: orphans[0]?.prompt?.slice(0, 30) || "历史会话",
        generationIds: orphans.map((g) => g.id),
        createdAt: orphans[0]?.createdAt || new Date().toISOString(),
      };
      stored = [legacy];
      saveSessions(stored);
    }

    setSessions(stored);
    // Set active session to the last one, or create a new one
    if (stored.length > 0) {
      const last = stored[stored.length - 1];
      setActiveSessionId(last.id);
      setSessionGenerations(
        initialGenerations.filter((g) => last.generationIds.includes(g.id))
          .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll to bottom when generations change
  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTo({
        top: scrollAreaRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [sessionGenerations, isPending]);

  // Adjust textarea height
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [prompt]);

  const sortedGenerations = sessionGenerations;

  async function handleDownload(url: string) {
    try {
      const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(url)}`;
      const response = await fetch(proxyUrl);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const pathname = new URL(url, window.location.href).pathname;
      const nameFromUrl = pathname.split("/").filter(Boolean).pop();
      a.href = blobUrl;
      a.download = nameFromUrl && nameFromUrl.includes(".") ? nameFromUrl : "narra-image.png";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  const sizeOptions = useMemo(
    () => [
      { label: "方形", value: "1024x1024" },
      { label: "竖版", value: "1024x1536" },
      { label: "横版", value: "1536x1024" },
    ],
    [],
  );

  async function handleGenerate() {
    if (!currentUser) {
      router.push("/login");
      return;
    }

    setError(null);

    if (generationType === "image_to_image" && !referenceImage) {
      setError("请先上传参考图");
      return;
    }

    const response =
      generationType === "image_to_image"
        ? await fetch("/api/generate", {
            method: "POST",
            body: (() => {
              const formData = new FormData();
              formData.append("generationType", "image_to_image");
              formData.append("model", model);
              formData.append("prompt", prompt);
              formData.append("providerMode", providerMode);
              if (selectedChannelId && providerMode === "built_in") {
                formData.append("channelId", selectedChannelId);
              }
              if (referenceImage) {
                formData.append("image", referenceImage.file);
              }
              if (providerMode === "custom") {
                formData.append("customApiKey", customApiKey);
                formData.append("customBaseUrl", customBaseUrl);
                formData.append("customModel", model);
                formData.append("rememberProvider", rememberProvider ? "true" : "false");
              }
              return formData;
            })(),
          })
        : await fetch("/api/generate", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              channelId: providerMode === "built_in" ? selectedChannelId : undefined,
              count,
              customProvider:
                providerMode === "custom"
                  ? {
                      apiKey: customApiKey,
                      baseUrl: customBaseUrl,
                      label: "我的渠道",
                      model,
                      remember: rememberProvider,
                    }
                  : null,
              generationType: "text_to_image",
              model,
              negativePrompt: negativePrompt || null,
              prompt,
              providerMode,
              size,
            }),
          });

    const result = (await response.json()) as {
      data?: {
        generation: GenerationItem;
      };
      error?: string;
    };

    if (!response.ok) {
      setError(result.error || "生成失败，请稍后再试");
      return;
    }

    const generation = result.data?.generation;
    if (!generation) {
      setError("服务端没有返回图片");
      return;
    }

    setSessionGenerations((current) => [...current, generation]);
    // Update session in localStorage
    setSessions((prev) => {
      let updated = [...prev];
      let session = updated.find((s) => s.id === activeSessionId);
      if (!session) {
        // Create session on first generation if none active
        session = {
          id: activeSessionId || genSessionId(),
          title: generation.prompt.slice(0, 30),
          generationIds: [],
          createdAt: new Date().toISOString(),
        };
        updated.push(session);
        if (!activeSessionId) setActiveSessionId(session.id);
      }
      session.generationIds.push(generation.id);
      if (session.generationIds.length === 1) {
        session.title = generation.prompt.slice(0, 30);
      }
      saveSessions(updated);
      return updated;
    });
    setPrompt("");
    if (generation.providerMode === "built_in") {
      setCredits((current) => Math.max(0, current - generation.creditsSpent));
    }
  }

  async function handleReferenceImageChange(file: File | null) {
    if (!file) {
      return;
    }

    setReferenceImage({
      file,
      previewUrl: URL.createObjectURL(file),
    });
    setGenerationType("image_to_image");
    setError(null);
  }

  async function handleUseImageForEdit(url: string) {
    try {
      // Use server-side proxy to avoid CORS issues with external storage (S3/R2)
      const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(url)}`;
      const response = await fetch(proxyUrl);
      if (!response.ok) throw new Error("fetch failed");
      const blob = await response.blob();
      const file = new File([blob], `edit-${Date.now()}.png`, {
        type: blob.type || "image/png",
      });
      await handleReferenceImageChange(file);
    } catch {
      setError("当前图片暂时无法加入编辑，请稍后再试");
      return;
    }

    setGenerationType("image_to_image");
    setPrompt("");
    textareaRef.current?.focus();
  }

  async function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          await handleReferenceImageChange(file);
          e.preventDefault();
          break;
        }
      }
    }
  }

  async function handleProbeModels() {
    setModelProbeError(null);

    const response = await fetch("/api/provider-models/probe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        apiKey: customApiKey || null,
        baseUrl: customBaseUrl,
      }),
    });

    const result = (await response.json()) as {
      data?: {
        models: Array<{
          id: string;
          imageLikely: boolean;
        }>;
      };
      error?: string;
    };

    if (!response.ok) {
      setModelProbeError(result.error || "拉取模型失败");
      return;
    }

    const models = result.data?.models ?? [];
    setAvailableModels(models.map((item) => item.id));
    if (models[0]?.id) {
      setModel(models[0].id);
    }
  }


  function handleNewConversation() {
    const newId = genSessionId();
    setActiveSessionId(newId);
    setSessionGenerations([]);
    setPrompt("");
    setNegativePrompt("");
    setReferenceImage(null);
    setGenerationType("text_to_image");
    setError(null);
    setShowSettings(false);
    // Don't add to sessions yet — only add when first generation happens
  }

  const [sidebarOpen, setSidebarOpen] = useState(false);

  function switchToSession(sessionId: string) {
    setActiveSessionId(sessionId);
    const session = sessions.find((s) => s.id === sessionId);
    if (session) {
      const gens = initialGenerations
        .filter((g) => session.generationIds.includes(g.id))
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      setSessionGenerations(gens);
    }
    setPrompt("");
    setNegativePrompt("");
    setReferenceImage(null);
    setError(null);
    if (window.innerWidth < 768) setSidebarOpen(false);
  }

  function deleteSession(sessionId: string) {
    setSessions((prev) => {
      const updated = prev.filter((s) => s.id !== sessionId);
      saveSessions(updated);
      return updated;
    });
    if (activeSessionId === sessionId) {
      handleNewConversation();
    }
  }

  function formatTime(dateStr: string) {
    const d = new Date(dateStr);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const time = `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
    if (isToday) return `今天 ${time}`;
    return `${(d.getMonth()+1).toString().padStart(2,"0")}/${d.getDate().toString().padStart(2,"0")} ${time}`;
  }

  return (
    <div className="flex h-full w-full relative">
      {/* 左侧会话历史侧边栏 */}
      {/* 移动端遮罩 */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/30 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside className={`${
        sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
      } fixed md:relative z-40 md:z-0 flex h-full w-64 shrink-0 flex-col border-r border-[var(--line)] bg-[var(--surface)] transition-transform duration-200 ease-out`}>
        {/* 侧边栏头部 */}
        <div className="flex items-center gap-2 p-3 border-b border-[var(--line)]">
          <button
            onClick={handleNewConversation}
            className="flex flex-1 items-center gap-2 rounded-xl bg-[var(--ink)] px-4 py-2.5 text-xs font-medium text-white shadow-sm transition hover:bg-[var(--accent)]"
          >
            <SquarePen className="size-3.5" />
            新建对话
          </button>
          <button
            onClick={() => setSidebarOpen(false)}
            className="rounded-lg p-2 text-[var(--ink-soft)] transition hover:bg-[var(--surface-strong)] md:hidden"
          >
            <PanelLeftClose className="size-4" />
          </button>
        </div>

        {/* 会话列表 */}
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5" style={{ scrollbarWidth: "thin" }}>
          {sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-center">
              <MessageSquare className="size-6 text-[var(--ink-soft)] opacity-30 mb-2" />
              <p className="text-xs text-[var(--ink-soft)]">暂无会话记录</p>
            </div>
          ) : (
            [...sessions].reverse().map((session) => (
              <div
                key={session.id}
                className={`group flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left transition cursor-pointer ${
                  activeSessionId === session.id
                    ? "bg-[var(--surface-strong)] ring-1 ring-[var(--line)]"
                    : "hover:bg-[var(--surface-strong)]/60"
                }`}
                onClick={() => switchToSession(session.id)}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-[var(--ink)] truncate leading-tight">
                    {session.title || "新对话"}
                  </p>
                  <p className="text-[10px] text-[var(--ink-soft)] mt-0.5">
                    {session.generationIds.length} 轮 · {formatTime(session.createdAt)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); deleteSession(session.id); }}
                  className="shrink-0 rounded-md p-1 text-[var(--ink-soft)] opacity-0 transition group-hover:opacity-100 hover:bg-rose-50 hover:text-rose-500"
                  title="删除会话"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* 主内容区 */}
      <div className="flex flex-1 flex-col relative bg-gradient-to-b from-[var(--surface)] to-[var(--surface-strong)]/20 min-w-0">
        {/* 顶部工具栏 */}
        <div className="flex items-center gap-2 px-4 py-2 md:px-6">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg p-2 text-[var(--ink-soft)] transition hover:bg-[var(--surface-strong)] md:hidden"
          >
            <PanelLeftOpen className="size-4" />
          </button>
        </div>

        {/* 对话流区域 */}
        <div
          ref={scrollAreaRef}
          className="flex-1 overflow-y-auto px-4 pb-40 md:px-8 scroll-smooth"
          style={{ scrollbarWidth: "thin" }}
        >
          <div className="mx-auto max-w-3xl space-y-8">
            {sortedGenerations.length === 0 ? (
              <div className="flex h-[40vh] flex-col items-center justify-center text-center">
                <div className="mb-6 rounded-full bg-gradient-to-br from-[var(--accent)]/20 to-purple-500/20 p-5 ring-1 ring-[var(--line)]">
                  <WandSparkles className="size-8 text-[var(--accent)]" />
                </div>
                <h2 className="text-2xl font-semibold tracking-tight text-[var(--ink)]">你好，你想创作什么？</h2>
                <p className="mt-2 text-[var(--ink-soft)] max-w-md">
                  在下方输入描述开始生成图片，或者直接粘贴一张图片进入图生图模式。
                </p>
              </div>
            ) : (
              sortedGenerations.map((generation) => (
                <div key={generation.id} id={`gen-${generation.id}`} className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex gap-4">
                  <div className="shrink-0 flex size-9 items-center justify-center rounded-full bg-[var(--surface-strong)] border border-[var(--line)] text-sm font-semibold">
                    You
                  </div>
                  <div className="flex flex-col gap-2 max-w-[85%]">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[var(--ink)]">You</span>
                      <span className="text-xs text-[var(--ink-soft)] bg-[var(--surface-strong)] px-2 py-0.5 rounded-full">
                        {generation.generationType === "image_to_image" ? "图生图" : "文生图"}
                      </span>
                    </div>
                    <div className="rounded-2xl rounded-tl-none border border-[var(--line)] bg-[var(--surface-strong)]/30 px-5 py-3.5 text-sm leading-relaxed text-[var(--ink)] shadow-sm">
                      {generation.prompt}
                      {generation.sourceImageUrl && (
                        <div className="mt-3">
                          <img 
                            src={generation.sourceImageUrl} 
                            alt="Reference" 
                            className="h-24 w-auto rounded-lg border border-[var(--line)] object-cover shadow-sm"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* 助手（生成结果）消息 */}
                <div className="flex gap-4">
                  <div className="shrink-0 flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent)] to-purple-500 text-white shadow-md">
                    <Sparkles className="size-5" />
                  </div>
                  <div className="flex flex-col gap-2 max-w-[85%] w-full">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[var(--ink)]">Narra AI</span>
                      <span className="text-xs text-[var(--ink-soft)]">{generation.model} • {generation.size}</span>
                    </div>
                    
                    {generation.images.length > 0 ? (
                      <div className="space-y-3">
                        <p className="text-xs text-[var(--ink-soft)]">结果 {generation.images.length}</p>
                        <div className={`grid gap-3 ${generation.images.length > 1 ? "grid-cols-2" : "grid-cols-1"}`} style={{ maxWidth: generation.images.length === 1 ? "280px" : "400px" }}>
                          {generation.images.map((image) => (
                            <div
                              key={image.id}
                              className="group relative overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)]/50 shadow-sm"
                            >
                              <img
                                src={image.url}
                                alt="生成结果"
                                className="w-full h-auto object-cover cursor-pointer transition-transform duration-300 hover:scale-[1.02]"
                                onClick={() => setZoomedImage(image.url)}
                              />
                              {/* 底部操作栏 — 始终可见 */}
                              <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-[var(--line)]/50 bg-[var(--surface)]/80">
                                <button
                                  type="button"
                                  onClick={() => void handleUseImageForEdit(image.url)}
                                  className="flex items-center gap-1.5 rounded-full bg-[var(--surface-strong)] px-3 py-1.5 text-xs font-medium text-[var(--ink)] border border-[var(--line)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                                >
                                  <ImagePlus className="size-3" />
                                  加入编辑
                                </button>
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => setZoomedImage(image.url)}
                                    className="rounded-lg p-1.5 text-[var(--ink-soft)] transition hover:bg-[var(--surface-strong)] hover:text-[var(--ink)]"
                                    title="放大查看"
                                  >
                                    <ZoomIn className="size-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDownload(image.url)}
                                    className="rounded-lg p-1.5 text-[var(--ink-soft)] transition hover:bg-[var(--surface-strong)] hover:text-[var(--ink)]"
                                    title="下载保存"
                                  >
                                    <Download className="size-3.5" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-2xl rounded-tl-none border border-rose-500/20 bg-rose-500/10 px-5 py-3.5 text-sm text-rose-400">
                        生成失败或图片未能成功返回。
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
          
          {/* Loading 占位符 */}
          {isPending && (
            <div className="flex gap-4 animate-in fade-in duration-300">
               <div className="shrink-0 flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent)] to-purple-500 text-white shadow-md">
                 <Sparkles className="size-5 animate-pulse" />
               </div>
               <div className="flex flex-col gap-2 max-w-[85%] w-full">
                 <div className="flex items-center gap-2">
                   <span className="text-sm font-medium text-[var(--ink)]">Narra AI</span>
                   <span className="text-xs text-[var(--ink-soft)] animate-pulse">正在生成中...</span>
                 </div>
                 <div className="h-48 w-64 rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)]/30 animate-pulse" />
               </div>
            </div>
          )}
        </div>
      </div>

      {/* 底部输入悬浮区 */}
      <div className="absolute bottom-0 inset-x-0 z-20 bg-gradient-to-t from-[var(--surface)] via-[var(--surface)]/95 to-transparent pt-6 pb-4 px-4 md:px-8">
        <div className="mx-auto max-w-4xl">
          <div className="noise-overlay relative flex flex-col rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)]/70 backdrop-blur-2xl shadow-xl transition-all duration-300 ring-1 ring-white/5">

            {/* 参考图区域 */}
            {referenceImage && (
              <div className="px-5 pt-5 pb-1 flex items-start">
                <div className="relative group rounded-xl overflow-hidden border border-[var(--line)]">
                  <img src={referenceImage.previewUrl} alt="Reference" className="h-20 w-auto object-cover" />
                  <button
                    onClick={() => {
                      setReferenceImage(null);
                      if (prompt.trim() === "") setGenerationType("text_to_image");
                    }}
                    className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-rose-500"
                  >
                    <X className="size-3" />
                  </button>
                  <div className="absolute bottom-0 inset-x-0 bg-black/60 text-[10px] text-white text-center py-0.5">
                    参考图
                  </div>
                </div>
              </div>
            )}

            {/* 错误提示 */}
            {error && (
              <div className="mx-5 mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-2 text-sm text-rose-400 flex items-center justify-between">
                <span>{error}</span>
                <button onClick={() => setError(null)}><X className="size-4" /></button>
              </div>
            )}

            {/* 输入框主区域 */}
            <div className="flex items-end gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <textarea
                  ref={textareaRef}
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  onPaste={handlePaste}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (!isPending && prompt.trim()) {
                        startTransition(handleGenerate);
                      }
                    }
                  }}
                  placeholder={
                    generationType === "image_to_image" || referenceImage
                      ? "描述你希望如何修改这张参考图..."
                      : "输入提示词生成图片，或直接粘贴图片进入图生图..."
                  }
                  className="w-full resize-none bg-transparent py-1 text-sm text-[var(--ink)] placeholder:text-[var(--ink-soft)]/50 outline-none max-h-[120px]"
                  style={{ minHeight: "36px" }}
                  rows={1}
                />
              </div>

              <div className="flex shrink-0 items-center gap-2 mb-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    void handleReferenceImageChange(event.target.files?.[0] ?? null);
                    event.target.value = ''; // reset
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-full p-2.5 text-[var(--ink-soft)] transition hover:bg-[var(--line)] hover:text-[var(--ink)]"
                  title="上传参考图"
                >
                  <Paperclip className="size-5" />
                </button>
                <button
                  type="button"
                  onClick={() => startTransition(handleGenerate)}
                  disabled={isPending || (!prompt.trim() && !referenceImage)}
                  className="group relative flex size-10 items-center justify-center overflow-hidden rounded-full bg-[var(--ink)] text-white shadow-md transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100"
                >
                  <div className="absolute inset-0 bg-gradient-to-tr from-[var(--accent)] to-[var(--accent-soft)] opacity-0 transition-opacity group-hover:opacity-100" />
                  {isPending ? (
                    <Sparkles className="relative z-10 size-4 animate-spin" />
                  ) : (
                    <Send className="relative z-10 size-4 -ml-0.5 mt-0.5" />
                  )}
                </button>
              </div>
            </div>

            {/* 底部控制栏 */}
            <div className="flex items-center justify-between border-t border-[var(--line)]/50 px-4 py-2">
              <div className="flex flex-wrap items-center gap-2">
                {/* 模式切换 */}
                <div className="flex items-center rounded-lg bg-[var(--surface-strong)] p-0.5">
                  <button
                    onClick={() => setGenerationType("text_to_image")}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                      generationType === "text_to_image" ? "bg-white text-black shadow-sm" : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
                    }`}
                  >
                    文生图
                  </button>
                  <button
                    onClick={() => {
                      setGenerationType("image_to_image");
                      if (!referenceImage) fileInputRef.current?.click();
                    }}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                      generationType === "image_to_image" ? "bg-white text-black shadow-sm" : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
                    }`}
                  >
                    图生图
                  </button>
                </div>

                {/* 尺寸切换（文生图独有） */}
                {generationType === "text_to_image" && (
                  <div className="flex items-center rounded-lg bg-[var(--surface-strong)] p-0.5 hidden sm:flex">
                    {sizeOptions.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setSize(opt.value as "1024x1024" | "1024x1536" | "1536x1024")}
                        className={`rounded-md px-2 py-1 text-xs transition-colors ${
                          size === opt.value ? "bg-white text-black shadow-sm" : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}

                {/* 高级设置按钮 */}
                <button
                  onClick={() => setShowSettings(!showSettings)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    showSettings ? "bg-[var(--accent)]/10 text-[var(--accent)]" : "text-[var(--ink-soft)] hover:bg-[var(--surface-strong)]"
                  }`}
                >
                  <Settings2 className="size-3.5" />
                  高级设置
                </button>
              </div>

              {/* 右侧：渠道 + 模型选择 */}
              <div className="hidden md:flex items-center gap-3">
                {providerMode === "built_in" && channels.length > 1 && (
                  <select
                    value={selectedChannelId ?? ""}
                    onChange={(e) => {
                      setSelectedChannelId(e.target.value);
                      const ch = channels.find((c) => c.id === e.target.value);
                      if (ch) setModel(ch.defaultModel);
                    }}
                    className="bg-transparent text-xs font-medium text-[var(--ink)] outline-none border-none cursor-pointer"
                  >
                    {channels.map((ch) => (
                      <option key={ch.id} value={ch.id}>{ch.name}</option>
                    ))}
                  </select>
                )}
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="bg-transparent text-xs font-medium text-[var(--ink)] outline-none border-none cursor-pointer"
                >
                  <option value={model}>{model}</option>
                  {(providerMode === "built_in" ? (selectedChannel?.models ?? []) : availableModels).map((m: string) => (
                    m !== model && <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* 高级设置面板 (展开) */}
            {showSettings && (
              <div className="border-t border-[var(--line)]/50 bg-[var(--surface)]/50 p-5 rounded-b-[2rem] animate-in slide-in-from-top-2">
                <div className="grid gap-6 md:grid-cols-2">
                  <div className="space-y-4">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-[var(--ink-soft)]">生成张数</label>
                      <div className="flex gap-2">
                        {[1, 2, 3, 4].map((num) => (
                          <button
                            key={num}
                            onClick={() => setCount(num)}
                            className={`flex-1 rounded-lg border py-1.5 text-sm transition-colors ${
                              count === num ? "border-[var(--accent)] bg-[var(--accent)]/5 text-[var(--accent)] font-medium" : "border-[var(--line)] bg-[var(--surface-strong)] text-[var(--ink-soft)] hover:border-[var(--ink-soft)]"
                            }`}
                          >
                            {num}
                          </button>
                        ))}
                      </div>
                    </div>
                    {generationType === "text_to_image" && (
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-[var(--ink-soft)]">负向提示词</label>
                        <textarea
                          value={negativePrompt}
                          onChange={(e) => setNegativePrompt(e.target.value)}
                          placeholder="例如：畸形、低画质"
                          className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-strong)]/50 px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                          rows={2}
                        />
                      </div>
                    )}
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="mb-1.5 flex items-center justify-between text-xs font-medium text-[var(--ink-soft)]">
                        <span>渠道配置</span>
                        <div className="flex bg-[var(--surface-strong)] rounded text-[10px]">
                          <button
                            onClick={() => setProviderMode("built_in")}
                            className={`px-2 py-0.5 rounded ${providerMode === "built_in" ? "bg-[var(--ink)] text-white" : ""}`}
                          >内置</button>
                          <button
                            onClick={() => setProviderMode("custom")}
                            className={`px-2 py-0.5 rounded ${providerMode === "custom" ? "bg-[var(--ink)] text-white" : ""}`}
                          >自填</button>
                        </div>
                      </label>

                      {providerMode === "custom" ? (
                        <div className="space-y-2">
                          <input
                            value={customBaseUrl}
                            onChange={(e) => setCustomBaseUrl(e.target.value)}
                            placeholder="Base URL (例如: https://api.openai.com/v1)"
                            className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-strong)]/50 px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
                          />
                          <input
                            value={customApiKey}
                            onChange={(e) => setCustomApiKey(e.target.value)}
                            placeholder="API Key"
                            type="password"
                            className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-strong)]/50 px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
                          />
                          <div className="flex items-center justify-between mt-2">
                            <label className="flex items-center gap-2 text-xs text-[var(--ink-soft)] cursor-pointer">
                              <input
                                type="checkbox"
                                checked={rememberProvider}
                                onChange={(e) => setRememberProvider(e.target.checked)}
                                className="rounded border-[var(--line)] text-[var(--accent)] focus:ring-[var(--accent)]"
                              />
                              记住配置
                            </label>
                            <button
                              onClick={() => startFetchingModels(handleProbeModels)}
                              disabled={isFetchingModels || !customBaseUrl}
                              className="text-xs text-[var(--accent)] hover:underline disabled:opacity-50"
                            >
                              {isFetchingModels ? "拉取中..." : "拉取模型"}
                            </button>
                          </div>
                          {modelProbeError && <p className="text-[10px] text-rose-500 mt-1">{modelProbeError}</p>}
                        </div>
                      ) : (
                        <div className="rounded-lg border border-dashed border-[var(--line)] bg-[var(--surface-strong)]/30 p-3 text-xs text-[var(--ink-soft)]">
                          当前使用站点内置通道，每次生成默认扣除 5 积分。
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 图片放大预览遮罩 */}
      {zoomedImage && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in"
          onClick={() => setZoomedImage(null)}
        >
          <button 
            type="button"
            className="absolute top-6 right-6 text-white/70 transition hover:text-white hover:scale-110"
            onClick={() => setZoomedImage(null)}
          >
            <X className="size-8" />
          </button>
          <img 
            src={zoomedImage} 
            alt="Zoomed" 
            className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-2xl animate-in zoom-in-95"
            onClick={(e) => e.stopPropagation()} 
          />
          <div className="absolute bottom-8 flex items-center gap-4">
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDownload(zoomedImage);
              }}
              className="flex items-center gap-2 rounded-full bg-white/20 px-6 py-3 text-sm font-medium text-white backdrop-blur-md shadow-lg transition hover:bg-[var(--accent)] hover:scale-105"
            >
              <Download className="size-4" />
              保存高清原图
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleUseImageForEdit(zoomedImage);
                setZoomedImage(null);
              }}
              className="flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-medium text-black shadow-lg transition hover:bg-[var(--accent)] hover:text-white hover:scale-105"
            >
              <ImagePlus className="size-4" />
              加入编辑
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
