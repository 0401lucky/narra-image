"use client";

// 创作台容器组件。仅负责状态编排与子组件接线，
// 各子组件、hooks 与工具函数已拆分到同目录的 hooks / parts / utils / constants / types 下。
import { PanelLeftOpen } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";

import {
  type GenerationModeration,
  type GenerationOutputFormat,
  type GenerationQuality,
  type GenerationSizeToken,
  type GenerationType,
} from "@/lib/types";
import {
  imageSizeLimits,
  normalizeGenerationSize,
  parseImageSize,
} from "@/lib/generation/sizes";
import {
  TurnstileWidget,
  type TurnstileWidgetHandle,
} from "@/components/auth/turnstile-widget";
import type { ConversationGenerationsPage } from "@/lib/conversations/contracts";
import { canvasGenerationParametersSchema } from "@/lib/validators";
import { Alert } from "@/components/ui/alert";

import { useCanvasDocuments } from "./hooks/use-canvas-documents";
import { useCanvasEditor } from "./hooks/use-canvas-editor";
import { useCanvasImageViewer } from "./hooks/use-canvas-image-viewer";
import { useCanvasRuntimeLease } from "./hooks/use-canvas-runtime-lease";
import { useConversationGenerations } from "./hooks/use-conversation-generations";
import { useStudioMode, type StudioMode } from "./hooks/use-studio-mode";
import { useStudioJobs } from "./hooks/use-studio-jobs";
import { useReferenceImages } from "./hooks/use-reference-images";
import { useSessions } from "./hooks/use-sessions";
import { MAX_REFERENCE_IMAGES } from "./constants";
import { ChatPane } from "./parts/chat-pane";
import { CanvasLazyPane } from "./parts/canvas-lazy-pane";
import { CanvasRuntimeDialog } from "./parts/canvas-runtime-dialog";
import type { CanvasNodeTarget } from "./parts/canvas-stage";
import { SessionSidebar } from "./parts/session-sidebar";
import { StudioModeSwitch } from "./parts/studio-mode-switch";
import { isGenerationItem } from "./generation-item";
import { getSizeSelectValue, toReusableGenerationConfig } from "./utils";
import type {
  ChannelInfo,
  CustomProviderDraft,
  GenerationItem,
  ProviderSelectionMode,
  ReferenceImage,
  SavedProviderInfo,
  SessionInfo,
  StudioTurnstile,
  ViewerUser,
} from "./types";

const AdvancedSettings = dynamic(
  () => import("./parts/advanced-settings").then((mod) => mod.AdvancedSettings),
  { ssr: false },
);
const ImageZoomModal = dynamic(
  () => import("./parts/image-zoom-modal").then((mod) => mod.ImageZoomModal),
  { ssr: false },
);

type GeneratorStudioProps = {
  ownerId: string;
  canvasEnabled?: boolean;
  compact?: boolean;
  checkInSummary: {
    checkInReward: number;
    checkedInToday: boolean;
  };
  currentUser: ViewerUser;
  initialGenerations?: GenerationItem[];
  initialGenerationPage?: ConversationGenerationsPage | null;
  initialConversations?: SessionInfo[];
  initialPrompt?: string;
  channels?: ChannelInfo[];
  savedProvider?: SavedProviderInfo | null;
  turnstile?: StudioTurnstile | null;
};

// 模块级稳定空数组，避免组件每次 render 时 default 表达式创建新引用，
// 进而让 useEffect 的依赖项每次都"变化"导致死循环重跑。
const EMPTY_GENERATIONS: GenerationItem[] = [];
const EMPTY_CONVERSATIONS: SessionInfo[] = [];
const EMPTY_CHANNELS: ChannelInfo[] = [];

type StudioRequest = {
  controller: AbortController;
  isCurrent: () => boolean;
  finish: () => void;
};

type ChatCommand = {
  origin: { ownerId: string; conversationId: string | null; draftEpoch: number };
  conversationId: string | null;
  draftRevision: number;
  phase: "preparing" | "submitted";
  request: StudioRequest;
  releasePreviews: () => void;
};

type PendingConversationDelete = {
  accepted: Map<string, { replaceGenerationId?: string | null }>;
};

export function GeneratorStudio(props: GeneratorStudioProps) {
  // 同一账户刷新只更新服务端目录/余额；切换账户则销毁所有草稿、预览与请求作用域。
  return <StudioWorkspace key={props.ownerId} {...props} />;
}

function StudioWorkspace({
  ownerId,
  canvasEnabled = false,
  currentUser,
  initialGenerations = EMPTY_GENERATIONS,
  initialGenerationPage = null,
  initialConversations = EMPTY_CONVERSATIONS,
  initialPrompt = "",
  channels = EMPTY_CHANNELS,
  savedProvider = null,
  turnstile = null,
}: GeneratorStudioProps) {
  const router = useRouter();
  const { mode, canvasReadOnly, touchPresentation, changeMode } = useStudioMode(ownerId, canvasEnabled);
  const [isPending, setIsPending] = useState(false);
  const runtimeRef = useRef({ active: false, epoch: 0, requests: new Set<AbortController>() });
  const draftRef = useRef({ epoch: 0, revision: 0, conversationId: null as string | null });
  const commandRef = useRef<ChatCommand | null>(null);
  const providerProbeRef = useRef<StudioRequest | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const challengeRef = useRef<{ token: string | null; revision: number }>({ token: null, revision: 0 });
  const turnstileWidgetRef = useRef<TurnstileWidgetHandle>(null);

  useEffect(() => {
    const runtime = runtimeRef.current;
    runtime.active = true;
    runtime.epoch += 1;
    return () => {
      runtime.active = false;
      runtime.epoch += 1;
      runtime.requests.forEach((controller) => controller.abort());
      runtime.requests.clear();
      commandRef.current?.releasePreviews();
      commandRef.current = null;
    };
  }, []);

  const beginRequest = useCallback((): StudioRequest | null => {
    const runtime = runtimeRef.current;
    if (!runtime.active) return null;
    const epoch = runtime.epoch;
    const controller = new AbortController();
    runtime.requests.add(controller);
    return {
      controller,
      isCurrent: () => runtime.active && runtime.epoch === epoch && !controller.signal.aborted,
      finish: () => runtime.requests.delete(controller),
    };
  }, []);

  const updateChallenge = useCallback((token: string | null) => {
    if (!runtimeRef.current.active) return;
    challengeRef.current = { token, revision: challengeRef.current.revision + 1 };
    setTurnstileToken(token);
  }, []);
  const clearChallenge = useCallback(() => updateChallenge(null), [updateChallenge]);
  const needsTurnstile = Boolean(
    turnstile?.isEnabled && turnstile?.siteKey && turnstile?.protectGenerate,
  );
  const [generationType, setGenerationType] = useState<GenerationType>("text_to_image");
  const [prompt, setPrompt] = useState(initialPrompt);
  const [negativePrompt, setNegativePrompt] = useState("");
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(
    channels[0]?.id ?? null,
  );
  const selectedChannel = useMemo(
    () => channels.find((c) => c.id === selectedChannelId) ?? channels[0] ?? null,
    [channels, selectedChannelId],
  );
  const [model, setModel] = useState(selectedChannel?.defaultModel || "gpt-image-2");
  const [providerMode, setProviderMode] = useState<ProviderSelectionMode>("built_in");
  const [customProvider, setCustomProvider] = useState<CustomProviderDraft>(() => ({
    apiKey: "",
    baseUrl: savedProvider?.baseUrl ?? "https://api.openai.com/v1",
    label: savedProvider?.label ?? "我的 API",
    model: savedProvider?.model ?? selectedChannel?.defaultModel ?? "gpt-image-2",
    models: savedProvider?.models ?? [],
    remember: Boolean(savedProvider),
  }));
  const [customProviderProbePending, setCustomProviderProbePending] = useState(false);
  const [customProviderProbeMessage, setCustomProviderProbeMessage] = useState<string | null>(null);
  const [size, setSize] = useState<GenerationSizeToken>("auto");
  const [customSizeMode, setCustomSizeMode] = useState(false);
  const [customWidth, setCustomWidth] = useState("2048");
  const [customHeight, setCustomHeight] = useState("2048");
  const [quality, setQuality] = useState<GenerationQuality>("auto");
  const [outputFormat, setOutputFormat] = useState<GenerationOutputFormat>("png");
  const [outputCompression, setOutputCompression] = useState(100);
  const [moderation, setModeration] = useState<GenerationModeration>("auto");
  const [count, setCount] = useState(1);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [zoomedImageMeta, setZoomedImageMeta] = useState<{
    dimensionLabel?: string;
    ratioLabel?: string;
  } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const {
    referenceImages,
    addFiles,
    removeImage,
    moveImage,
    reorderImage,
    clear: clearReferenceImages,
    setImages: setReferenceImages,
  } = useReferenceImages();

  // 会话状态：基于服务端 API 持久化（本次修复 #8 落地）。
  const {
    sessions,
    createSession,
    renameSession,
    appendGeneration: appendGenerationToSession,
    deleteSession: deleteSessionRemote,
    readLastActive,
    writeLastActive,
    replaceGeneration: replaceGenerationInSession,
    isSessionLive,
  } = useSessions(ownerId, initialConversations);
  const {
    conversationId: activeSessionId,
    generations: sessionGenerations,
    loading: loadingConversation,
    loadingOlder: loadingOlderGenerations,
    error: conversationLoadError,
    hasMore: hasOlderGenerations,
    selectConversation: setActiveSessionId,
    registerConversation,
    forgetConversation,
    acceptGeneration,
    updateGeneration,
    loadOlder: loadOlderGenerations,
    reload: reloadConversation,
  } = useConversationGenerations({ ownerId, initialPage: initialGenerationPage, initialConversations, initialGenerations });

  // 初始化标记：只允许首次挂载时用服务端初始 props 决定会话视图。
  const didInitSessionRef = useRef(false);

  // 初始化：选择上次活跃会话或最新一条。
  // 会话列表为空时不展示任何历史 generation —— 已删除会话的图仍保留在作品页，
  // 但不属于任何活跃会话，不应聚合回中间对话流。
  // 该 effect 只跑一次：initialGenerations / initialConversations 在每次 router.refresh() 后都是新引用，
  // 若允许重跑会把用户"新建对话 / 删除会话"后的本地状态覆盖回旧会话。
  // 这里不主动调用 createSession API（避免在初始渲染就发起网络请求与潜在的测试副作用）；
  // 用户首次发送 generation 时会在 handleGenerate 中按需 createSession，归属落地由后端绑定。
  useEffect(() => {
    if (didInitSessionRef.current) return;
    didInitSessionRef.current = true;

    const lastId = readLastActive();
    const stored = initialConversations;
    const target = stored.find((s) => s.id === lastId) ?? stored[0] ?? null;
    if (target) {
      // readLastActive 依赖 localStorage，只能在挂载后读取（SSR 期间拿不到），因此这里必须用 effect 同步状态。
      setActiveSessionId(target.id);
      draftRef.current.conversationId = target.id;
      writeLastActive(target.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialGenerations, initialConversations]);

  const knownStatusesRef = useRef(new Map<string, GenerationItem["status"]>());
  const registeredJobsRef = useRef(new Map<string, GenerationItem>());
  const deletingConversationsRef = useRef(new Map<string, PendingConversationDelete>());
  const handleConversationJobUpdate = useCallback((conversationId: string, updated: GenerationItem) => {
    const previous = knownStatusesRef.current.get(updated.id);
    knownStatusesRef.current.set(updated.id, updated.status);
    if (!deletingConversationsRef.current.has(conversationId)) updateGeneration(updated);
    if (previous === "pending" && updated.status !== "pending") router.refresh();
  }, [router, updateGeneration]);
  const { registerConversation: registerConversationJob, getJob, updateJob, canvasJobs } = useStudioJobs({
    ownerId, onConversationUpdate: handleConversationJobUpdate,
  });
  const defaultCanvasParameters = useMemo(() => canvasGenerationParametersSchema.parse({
    model: channels[0]?.defaultModel || "gpt-image-2",
    channelId: channels[0]?.id ?? null,
  }), [channels]);
  const canvasRuntime = useCanvasRuntimeLease({ ownerId, enabled: canvasEnabled, readOnly: canvasReadOnly, savedProvider, turnstile });
  const { controller: canvasController, snapshot: canvasSnapshot } = useCanvasDocuments({
    ownerId, enabled: canvasEnabled, readOnly: canvasReadOnly,
    defaultParameters: defaultCanvasParameters, jobs: canvasJobs,
    acquireTransientLease: canvasRuntime.acquireTransientLease,
  });
  const canvasEditor = useCanvasEditor(canvasSnapshot, canvasController);
  const canvasViewer = useCanvasImageViewer(canvasController, getJob);
  const didSeedJobsRef = useRef(false);

  useEffect(() => {
    let live = true;
    let refreshQueued = false;
    const unsubscribe = canvasJobs.subscribe((origin, job) => {
      if (origin.ownerId !== ownerId) return;
      const previous = knownStatusesRef.current.get(job.id);
      knownStatusesRef.current.set(job.id, job.status);
      if (previous !== undefined && (previous !== "pending" || job.status === "pending")) return;
      if (refreshQueued) return;
      refreshQueued = true;
      // Refresh account balance on acceptance/settlement, coalescing hydration batches.
      queueMicrotask(() => {
        refreshQueued = false;
        if (live) router.refresh();
      });
    });
    return () => { live = false; unsubscribe(); };
  }, [canvasJobs, ownerId, router]);

  useEffect(() => {
    if (didSeedJobsRef.current) return;
    didSeedJobsRef.current = true;
    const knownConversations = new Set(initialConversations.map((session) => session.id));
    for (const generation of [...initialGenerations, ...(initialGenerationPage?.generations ?? [])]) {
      if (!generation.conversationId || !knownConversations.has(generation.conversationId)) continue;
      const canonical = registerConversationJob(generation.conversationId, generation);
      registeredJobsRef.current.set(generation.id, canonical);
    }
  }, [initialConversations, initialGenerationPage, initialGenerations, registerConversationJob]);

  // 已见任务的轮询属于根控制器，不随所选会话或未来的渲染器卸载而停止。
  useEffect(() => {
    if (!activeSessionId) return;
    for (const generation of sessionGenerations) {
      if (registeredJobsRef.current.get(generation.id) === generation) continue;
      const canonical = registerConversationJob(activeSessionId, generation);
      registeredJobsRef.current.set(generation.id, canonical);
      if (canonical !== generation) updateGeneration(canonical);
    }
  }, [activeSessionId, registerConversationJob, sessionGenerations, updateGeneration]);

  const sizeSelectValue = customSizeMode ? "custom" : getSizeSelectValue(size);
  const normalizedCustomSize = normalizeGenerationSize(`${customWidth}x${customHeight}`);

  // 自定义尺寸的输入态校验：覆盖空值 / 超出最大边 / 像素数过大 / 极端长宽比四种典型问题。
  // 这里只做"提示"，最终保护由 lib/generation/sizes 的 normalize 兜底（自动规整），
  // UI 提示让用户在提交前知道服务端会做什么。
  const customSizeWarning = useMemo<string | null>(() => {
    if (!customSizeMode) return null;
    const w = Number(customWidth);
    const h = Number(customHeight);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      return "请输入正整数";
    }
    if (Math.max(w, h) > imageSizeLimits.maxEdge) {
      return `单边最大 ${imageSizeLimits.maxEdge}px，将自动缩放到上限`;
    }
    const pixels = w * h;
    if (pixels > imageSizeLimits.maxPixels) {
      return `总像素超出上限，将自动缩小`;
    }
    const ratio = w / h;
    if (ratio > imageSizeLimits.maxAspectRatio || ratio < 1 / imageSizeLimits.maxAspectRatio) {
      return `长宽比超过 ${imageSizeLimits.maxAspectRatio}:1，将自动收敛`;
    }
    return null;
  }, [customSizeMode, customWidth, customHeight]);

  // 当前渠道支持的模型选项；若用户当前选择的 model 不在新渠道支持列表中，仍展示一项以示状态。
  const modelOptions = useMemo(() => {
    const channelModels = selectedChannel?.models ?? [];
    if (channelModels.includes(model)) return channelModels;
    return [model, ...channelModels];
  }, [selectedChannel?.models, model]);
  const customModelOptions = useMemo(() => {
    const models = customProvider.models.filter((item) => item.trim().length > 0);
    if (customProvider.model && !models.includes(customProvider.model)) {
      return [customProvider.model, ...models];
    }
    return models;
  }, [customProvider.model, customProvider.models]);
  const activeModel = providerMode === "custom" ? customProvider.model : model;
  const savedProviderConfigured = Boolean(savedProvider);

  type CustomProviderSubmitPayload = {
    apiKey: string;
    baseUrl: string;
    label: string;
    model: string;
    models: string[];
    remember: boolean;
  };

  type CustomProviderSubmitResult = {
    error?: string;
    payload: CustomProviderSubmitPayload | null;
  };

  function getCustomProviderSubmitPayload(): CustomProviderSubmitResult {
    const apiKey = customProvider.apiKey.trim();
    const baseUrl = customProvider.baseUrl.trim();
    const label = customProvider.label.trim() || "我的 API";
    const customModel = customProvider.model.trim();

    if (!baseUrl) {
      return { error: "请输入第三方 Base URL", payload: null };
    }

    try {
      new URL(baseUrl);
    } catch {
      return { error: "请输入正确的第三方 Base URL", payload: null };
    }

    if (!customModel) {
      return { error: "请输入第三方模型名", payload: null };
    }

    if (!apiKey && !savedProviderConfigured) {
      return { error: "请输入第三方 API Key", payload: null };
    }

    if (!apiKey) {
      if (savedProvider?.baseUrl && baseUrl !== savedProvider.baseUrl) {
        return { error: "修改 Base URL 时请重新输入 API Key", payload: null };
      }
      return { payload: null };
    }

    return {
      payload: {
        apiKey,
        baseUrl,
        label,
        model: customModel,
        models: [...customProvider.models],
        remember: customProvider.remember,
      },
    };
  }

  async function handleProbeCustomProviderModels() {
    providerProbeRef.current?.controller.abort();
    const baseUrl = customProvider.baseUrl.trim();
    if (!baseUrl) {
      setCustomProviderProbeMessage("请先填写 Base URL");
      return;
    }

    const request = beginRequest();
    if (!request) return;
    providerProbeRef.current = request;
    setCustomProviderProbePending(true);
    setCustomProviderProbeMessage(null);
    try {
      const response = await fetch("/api/provider-models/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: customProvider.apiKey.trim() || undefined,
          baseUrl,
        }),
        signal: request.controller.signal,
      });
      if (!request.isCurrent()) return;
      const result = (await response.json()) as {
        data?: { models?: Array<{ id: string } | string> };
        error?: string;
      };
      if (!request.isCurrent()) return;

      if (!response.ok) {
        setCustomProviderProbeMessage(result.error || "模型拉取失败，请手动填写模型名");
        return;
      }

      const nextModels = (result.data?.models ?? [])
        .map((item) => (typeof item === "string" ? item : item.id))
        .filter((item) => item.trim().length > 0);

      if (nextModels.length === 0) {
        setCustomProviderProbeMessage("未拉取到模型，请手动填写模型名");
        return;
      }

      setCustomProvider((current) => ({
        ...current,
        model: current.model && nextModels.includes(current.model) ? current.model : nextModels[0],
        models: nextModels,
      }));
      setCustomProviderProbeMessage(`已拉取 ${nextModels.length} 个模型`);
    } catch (err) {
      if (request.isCurrent()) setCustomProviderProbeMessage(err instanceof Error ? err.message : "模型拉取失败，请手动填写模型名");
    } finally {
      if (request.isCurrent()) setCustomProviderProbePending(false);
      if (providerProbeRef.current === request) providerProbeRef.current = null;
      request.finish();
    }
  }

  function handleChangeCustomProvider(next: CustomProviderDraft) {
    providerProbeRef.current?.controller.abort();
    providerProbeRef.current = null;
    setCustomProviderProbePending(false);
    setCustomProvider(next);
  }

  function getActiveCustomProviderSubmitPayload(): CustomProviderSubmitResult {
    return providerMode === "custom"
      ? getCustomProviderSubmitPayload()
      : { payload: null };
  }

  function handleSizeSelect(value: string) {
    if (value === "custom") {
      setCustomSizeMode(true);
      const parsed = parseImageSize(size);
      const nextWidth = parsed ? String(parsed.width) : customWidth;
      const nextHeight = parsed ? String(parsed.height) : customHeight;
      if (parsed) {
        setCustomWidth(nextWidth);
        setCustomHeight(nextHeight);
      }
      setSize((normalizeGenerationSize(`${nextWidth}x${nextHeight}`) ?? "2048x2048") as GenerationSizeToken);
      setShowSettings(true);
      return;
    }
    setCustomSizeMode(false);
    setSize(value as GenerationSizeToken);
  }

  function updateCustomSize(width: string, height: string) {
    setCustomWidth(width);
    setCustomHeight(height);
    const normalized = normalizeGenerationSize(`${width}x${height}`);
    if (normalized && normalized !== "auto") {
      setSize(normalized);
    }
  }

  async function handleDownload(url: string) {
    const request = beginRequest();
    if (!request) return;
    let blobUrl: string | null = null;
    try {
      const proxyUrl = url.startsWith("blob:") ? url : `/api/proxy-image?url=${encodeURIComponent(url)}`;
      const response = await fetch(proxyUrl, { signal: request.controller.signal });
      if (!request.isCurrent()) return;
      if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) {
        throw new Error("图片下载失败");
      }
      const blob = await response.blob();
      if (!request.isCurrent()) return;
      blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const pathname = new URL(url, window.location.href).pathname;
      const nameFromUrl = pathname.split("/").filter(Boolean).pop();
      a.href = blobUrl;
      a.download = nameFromUrl && nameFromUrl.includes(".") ? nameFromUrl : "narra-image.png";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {
      if (request.isCurrent()) window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      request.finish();
    }
  }

  function handleZoomImage(
    url: string,
    meta?: { dimensionLabel?: string; ratioLabel?: string },
  ) {
    setZoomedImage(url);
    setZoomedImageMeta(meta ?? null);
  }

  type GenerateSnapshot = {
    challenge: { token: string | null; revision: number };
    needsTurnstile: boolean;
    count: number;
    customProvider: CustomProviderSubmitPayload | null;
    generationType: GenerationType;
    model: string;
    moderation: GenerationModeration;
    negativePrompt: string;
    outputCompression: number;
    outputFormat: GenerationOutputFormat;
    prompt: string;
    providerMode: ProviderSelectionMode;
    quality: GenerationQuality;
    referenceImages: Array<{ id: string; file: File | null; previewUrl: string; sourceUrl?: string }>;
    replaceGenerationId?: string | null;
    customProviderBaseUrl: string;
    customProviderLabel: string;
    customProviderModels: string[];
    customProviderRemember: boolean;
    selectedChannelId: string | null;
    size: GenerationSizeToken;
  };

  function isCurrentDraft(command: ChatCommand) {
    const draft = draftRef.current;
    return command.request.isCurrent() && command.origin.ownerId === ownerId
      && draft.epoch === command.origin.draftEpoch && draft.conversationId === command.conversationId;
  }

  function startChatCommand(snapshot: GenerateSnapshot, clearInput: boolean) {
    if (commandRef.current) return;
    const request = beginRequest();
    if (!request) return;
    const draft = draftRef.current;
    let ownsPreviews = clearInput;
    const command: ChatCommand = {
      origin: Object.freeze({ ownerId, conversationId: draft.conversationId, draftEpoch: draft.epoch }),
      conversationId: draft.conversationId,
      draftRevision: ++draft.revision,
      phase: "preparing",
      request,
      releasePreviews: () => {
        if (!ownsPreviews) return;
        ownsPreviews = false;
        snapshot.referenceImages.forEach((image) => URL.revokeObjectURL(image.previewUrl));
      },
    };
    commandRef.current = command;
    setIsPending(true);

    if (clearInput) {
      setPrompt("");
      setReferenceImages([]);
      if (snapshot.generationType === "image_to_image") setGenerationType("text_to_image");
    }

    const restoreSnapshot = (message: string) => {
      if (!isCurrentDraft(command) || draftRef.current.revision !== command.draftRevision) return;
      if (command.conversationId && !isSessionLive(command.conversationId)) return;
      setError(message);
      if (clearInput) {
        setPrompt(snapshot.prompt);
        setReferenceImages(snapshot.referenceImages);
        setGenerationType(snapshot.generationType);
        ownsPreviews = false;
      } else if (!prompt && referenceImages.length === 0) {
        setPrompt(snapshot.prompt);
      }
    };
    void handleGenerate(command, snapshot, restoreSnapshot);
  }

  function handleSubmit() {
    if (commandRef.current) return;
    if (!currentUser) {
      router.push("/login");
      return;
    }
    setError(null);
    if (needsTurnstile && !challengeRef.current.token) {
      setError("请先完成人机验证");
      return;
    }
    if (generationType === "image_to_image" && referenceImages.length === 0) {
      setError("请先上传参考图");
      return;
    }
    if (!prompt.trim() && referenceImages.length === 0) return;
    const customProviderResult = getActiveCustomProviderSubmitPayload();
    if (customProviderResult.error) {
      setShowSettings(true);
      setError(customProviderResult.error);
      return;
    }

    // 引用顺序、参数和本次验证凭据在任何异步准备之前捕获。
    const snapshot: GenerateSnapshot = {
      challenge: { ...challengeRef.current },
      needsTurnstile,
      count,
      customProvider: customProviderResult.payload,
      generationType,
      model: activeModel,
      moderation,
      negativePrompt,
      outputCompression,
      outputFormat,
      prompt,
      providerMode,
      quality,
      referenceImages: referenceImages.map((image) => ({ ...image })),
      customProviderBaseUrl: customProvider.baseUrl.trim(),
      customProviderLabel: customProvider.label.trim() || "我的 API",
      customProviderModels: [...customProvider.models],
      customProviderRemember: customProvider.remember,
      selectedChannelId,
      size,
    };

    startChatCommand(snapshot, true);
  }

  function attachConversationGeneration(conversationId: string, generation: GenerationItem, replaceGenerationId?: string | null) {
    if (!isSessionLive(conversationId) || !acceptGeneration(conversationId, generation, replaceGenerationId)) return;
    if (replaceGenerationId) {
      replaceGenerationInSession(conversationId, replaceGenerationId, generation.id);
    } else {
      appendGenerationToSession(conversationId, generation.id);
    }
    const session = sessions.find((item) => item.id === conversationId);
    if (session && (session.generationCount ?? session.generationIds.length) === 0 && session.title === "新对话") {
      void renameSession(conversationId, generation.prompt.slice(0, 30) || "新对话");
    }
  }

  async function handleGenerate(command: ChatCommand, snapshot: GenerateSnapshot, restoreSnapshot: (message: string) => void) {
    try {
      let conversationId = command.origin.conversationId;
      if (!conversationId) {
        const created = await createSession(snapshot.prompt.slice(0, 30) || "新对话", {
          signal: command.request.controller.signal,
          isCurrent: () => isCurrentDraft(command),
        });
        if (!isCurrentDraft(command)) return;
        if (!created) {
          // 会话创建失败必须中止：否则 generation 会以无归属的"孤儿"落库，
          // 无归属的图只会保留在作品页，不能在刷新后回填到新建或无关会话。
          restoreSnapshot("创建会话失败，请稍后再试");
          return;
        }
        conversationId = created.id;
        command.conversationId = conversationId;
        draftRef.current.conversationId = conversationId;
        registerConversation(created);
        setActiveSessionId(created.id);
        writeLastActive(created.id);
      }

      if (!command.request.isCurrent() || !isSessionLive(conversationId)) return;
      command.phase = "submitted";
      const response =
        snapshot.generationType === "image_to_image"
          ? await fetch("/api/generate", {
              method: "POST",
              signal: command.request.controller.signal,
              body: (() => {
                const formData = new FormData();
                formData.append("generationType", "image_to_image");
                formData.append("model", snapshot.model);
                formData.append("moderation", snapshot.moderation);
                if (snapshot.outputFormat !== "png") {
                  formData.append("outputCompression", String(snapshot.outputCompression));
                }
                formData.append("outputFormat", snapshot.outputFormat);
                formData.append("prompt", snapshot.prompt);
                formData.append("providerMode", snapshot.providerMode);
                formData.append("quality", snapshot.quality);
                formData.append("size", snapshot.size);
                if (snapshot.providerMode === "built_in" && snapshot.selectedChannelId) {
                  formData.append("channelId", snapshot.selectedChannelId);
                }
                if (snapshot.providerMode === "custom") {
                  formData.append("customBaseUrl", snapshot.customProviderBaseUrl);
                  formData.append("customModel", snapshot.model);
                  formData.append("customLabel", snapshot.customProviderLabel);
                  formData.append("rememberProvider", String(snapshot.customProviderRemember));
                  if (snapshot.customProvider) {
                    formData.append("customApiKey", snapshot.customProvider.apiKey);
                    formData.append("customModels", JSON.stringify(snapshot.customProviderModels));
                  }
                }
                if (conversationId) {
                  formData.append("conversationId", conversationId);
                }
                if (snapshot.replaceGenerationId) {
                  formData.append("replaceGenerationId", snapshot.replaceGenerationId);
                }
                snapshot.referenceImages.forEach((referenceImage) => {
                  if (referenceImage.sourceUrl) {
                    formData.append("referenceImageUrls", referenceImage.sourceUrl);
                  } else if (referenceImage.file) {
                    formData.append("referenceImages", referenceImage.file);
                  }
                });
                if (snapshot.challenge.token) {
                  formData.append("turnstileToken", snapshot.challenge.token);
                }
                return formData;
              })(),
            })
          : await fetch("/api/generate", {
              method: "POST",
              signal: command.request.controller.signal,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                channelId: snapshot.providerMode === "built_in" ? snapshot.selectedChannelId : undefined,
                conversationId,
                count: snapshot.count,
                customProvider: snapshot.customProvider,
                generationType: "text_to_image",
                moderation: snapshot.moderation,
                model: snapshot.model,
                negativePrompt: snapshot.negativePrompt || null,
                outputCompression: snapshot.outputFormat === "png" ? null : snapshot.outputCompression,
                outputFormat: snapshot.outputFormat,
                prompt: snapshot.prompt,
                providerMode: snapshot.providerMode,
                quality: snapshot.quality,
                replaceGenerationId: snapshot.replaceGenerationId || undefined,
                size: snapshot.size,
                turnstileToken: snapshot.challenge.token || undefined,
              }),
            });

      if (!command.request.isCurrent()) return;
      const result = (await response.json()) as {
        data?: { generation?: unknown };
        error?: unknown;
      } | null;
      if (!command.request.isCurrent()) return;

      if (!response.ok) {
        restoreSnapshot(typeof result?.error === "string" && result.error ? result.error : "生成失败，请稍后再试");
        return;
      }
      const generation = result?.data?.generation;
      if (!isGenerationItem(generation)
        || (generation.conversationId != null && generation.conversationId !== conversationId)) {
        restoreSnapshot("服务端返回的生成内容不正确，请稍后再试");
        return;
      }

      const canonical = registerConversationJob(conversationId, generation);
      registeredJobsRef.current.set(canonical.id, canonical);
      const deletion = deletingConversationsRef.current.get(conversationId);
      if (deletion) {
        deletion.accepted.set(canonical.id, { replaceGenerationId: snapshot.replaceGenerationId });
      } else {
        attachConversationGeneration(conversationId, canonical, snapshot.replaceGenerationId);
      }
      router.refresh();
    } catch {
      restoreSnapshot("生成失败，请稍后再试");
    } finally {
      // 只重置被本次请求消耗的验证凭据，不清掉等待期间新完成的验证。
      if (command.request.isCurrent() && command.phase === "submitted" && snapshot.needsTurnstile
        && challengeRef.current.revision === snapshot.challenge.revision) {
        clearChallenge();
        turnstileWidgetRef.current?.reset();
      }
      command.releasePreviews();
      if (commandRef.current === command) {
        commandRef.current = null;
        if (command.request.isCurrent()) setIsPending(false);
      }
      command.request.finish();
    }
  }

  function handleReferenceFiles(files: File[] | FileList | null) {
    const result = addFiles(files);
    if (result === "empty") return;
    draftRef.current.revision += 1;
    if (result === "exceeded") {
      setError("最多上传 16 张参考图");
    } else {
      setError(null);
    }
    // 接受了至少一张图时，切到图生图模式并把 count 锁回 1（后端固定单图返回）。
    setGenerationType("image_to_image");
    setCount(1);
  }

  function handleRemoveReference(id: string) {
    draftRef.current.revision += 1;
    removeImage(id);
    // 若移除后没有参考图且 prompt 为空，则回到文生图模式。
    if (referenceImages.length === 1 && prompt.trim() === "") {
      setGenerationType("text_to_image");
    }
  }

  function handleUseImageForEdit(url: string) {
    if (referenceImages.length >= MAX_REFERENCE_IMAGES) {
      setError("最多上传 16 张参考图");
      return;
    }

    draftRef.current.revision += 1;
    const image: ReferenceImage = {
      id: `${Date.now()}_url_${Math.random().toString(36).slice(2, 8)}`,
      file: null,
      previewUrl: url,
      sourceUrl: url,
    };
    setReferenceImages((current) => current.length >= MAX_REFERENCE_IMAGES ? current : [...current, image]);
    setGenerationType("image_to_image");
    setCount(1);
    setPrompt("");
    setError(null);
    setFocusRequest((current) => current + 1);
  }

  function handleReuseConfig(generation: GenerationItem) {
    draftRef.current.revision += 1;
    const config = toReusableGenerationConfig(
      generation,
      channels.map((channel) => channel.id),
    );
    const targetChannel = config.channelId
      ? channels.find((channel) => channel.id === config.channelId) ?? null
      : selectedChannel;
    const nextChannelId = targetChannel?.id ?? selectedChannelId ?? channels[0]?.id ?? null;
    const nextModels = targetChannel?.models ?? selectedChannel?.models ?? [];
    const nextModel = nextModels.length === 0 || nextModels.includes(config.model)
      ? config.model
      : targetChannel?.defaultModel ?? selectedChannel?.defaultModel ?? config.model;
    const parsedSize = parseImageSize(config.size);

    setPrompt(config.prompt);
    setNegativePrompt(config.negativePrompt);
    setGenerationType(config.sourceImageUrls.length > 0 ? "image_to_image" : config.generationType);
    setCount(config.sourceImageUrls.length > 0 || config.generationType === "image_to_image" ? 1 : config.count);
    setSize(config.size);
    setCustomSizeMode(getSizeSelectValue(config.size) === "custom");
    if (parsedSize) {
      setCustomWidth(String(parsedSize.width));
      setCustomHeight(String(parsedSize.height));
    }
    setQuality(config.quality);
    setOutputFormat(config.outputFormat);
    setOutputCompression(config.outputCompression);
    setModeration(config.moderation);
    setModel(nextModel);
    if (nextChannelId) {
      setSelectedChannelId(nextChannelId);
    }
    clearReferenceImages();
    setReferenceImages(() =>
      config.sourceImageUrls.map((url, index) => ({
        file: null,
        id: `${Date.now()}_reuse_${index}_${Math.random().toString(36).slice(2, 8)}`,
        previewUrl: url,
        sourceUrl: url,
      })),
    );
    setShowSettings(false);
    setError(null);
    setFocusRequest((current) => current + 1);
  }

  function handleChangePrompt(value: string) {
    draftRef.current.revision += 1;
    setPrompt(value);
  }

  function handleChangeGenerationType(value: GenerationType) {
    draftRef.current.revision += 1;
    setGenerationType(value);
  }

  function handleMoveReference(id: string, direction: -1 | 1) {
    draftRef.current.revision += 1;
    moveImage(id, direction);
  }

  function handleReorderReference(sourceId: string, targetId: string) {
    draftRef.current.revision += 1;
    reorderImage(sourceId, targetId);
  }

  function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          handleReferenceFiles([file]);
          e.preventDefault();
          break;
        }
      }
    }
  }

  // 取消仍在 pending/processing 的 generation：服务端标记失败并退还预扣积分。
  async function handleCancelGeneration(target: GenerationItem) {
    if (target.status !== "pending") return;
    const request = beginRequest();
    if (!request) return;
    const origin = { ...draftRef.current };
    const showError = (message: string) => {
      if (request.isCurrent() && draftRef.current.epoch === origin.epoch
        && draftRef.current.conversationId === origin.conversationId) setError(message);
    };
    try {
      const response = await fetch(`/api/me/generations/${target.id}`, {
        method: "DELETE",
        signal: request.controller.signal,
      });
      if (!request.isCurrent()) return;
      const result = (await response.json()) as {
        data?: { generation?: unknown };
        error?: unknown;
      } | null;
      if (!request.isCurrent()) return;

      if (!response.ok) {
        showError(typeof result?.error === "string" && result.error ? result.error : "取消生成失败，请稍后再试");
        return;
      }

      const updated = result?.data?.generation;
      if (!isGenerationItem(updated) || updated.id !== target.id) {
        showError("服务端返回的任务状态不正确，请稍后再试");
        return;
      }
      updateJob(updated);
      router.refresh();
    } catch {
      showError("取消生成失败，请稍后再试");
    } finally {
      request.finish();
    }
  }

  // 失败重试：使用原 generation 的 prompt + 当前选项重新触发，等价于用户手动重新填写一次。
  // 注意：不复用原 sourceImageUrls（图生图）——参考图在原文件已不可用，重试时退回文生图。
  function handleRetryGeneration(target: GenerationItem) {
    if (target.status === "pending" || commandRef.current) return;
    if (!currentUser) {
      router.push("/login");
      return;
    }
    setError(null);
    if (needsTurnstile && !challengeRef.current.token) {
      setError("请先完成人机验证");
      return;
    }
    const customProviderResult = getActiveCustomProviderSubmitPayload();
    if (customProviderResult.error) {
      setShowSettings(true);
      setError(customProviderResult.error);
      return;
    }
    const snapshot: GenerateSnapshot = {
      challenge: { ...challengeRef.current },
      needsTurnstile,
      count,
      customProvider: customProviderResult.payload,
      generationType: "text_to_image",
      model: activeModel,
      moderation,
      negativePrompt,
      outputCompression,
      outputFormat,
      prompt: target.prompt,
      providerMode,
      quality,
      // 重试不带原参考图：用户如想图生图重试，可用气泡内"加入编辑"再重发。
      referenceImages: [],
      replaceGenerationId: target.id,
      customProviderBaseUrl: customProvider.baseUrl.trim(),
      customProviderLabel: customProvider.label.trim() || "我的 API",
      customProviderModels: [...customProvider.models],
      customProviderRemember: customProvider.remember,
      selectedChannelId,
      size,
    };
    startChatCommand(snapshot, false);
  }

  function invalidateDraft() {
    draftRef.current.epoch += 1;
    draftRef.current.revision += 1;
    const command = commandRef.current;
    // 已开始的生成继续回到捕获的会话；尚未创建完成的旧草稿不能再提交。
    if (command?.phase === "preparing") {
      command.request.controller.abort();
      command.request.finish();
      command.releasePreviews();
      commandRef.current = null;
      setIsPending(false);
    }
  }

  function handleNewConversation() {
    invalidateDraft();
    draftRef.current.conversationId = null;
    // 暂不立即创建服务端会话，等首次发送 generation 时再 createSession，避免空会话堆积。
    setActiveSessionId(null);
    writeLastActive(null);
    setPrompt("");
    setNegativePrompt("");
    clearReferenceImages();
    setGenerationType("text_to_image");
    setError(null);
    setShowSettings(false);
  }

  function switchToSession(sessionId: string) {
    if (!isSessionLive(sessionId)) return;
    invalidateDraft();
    draftRef.current.conversationId = sessionId;
    setActiveSessionId(sessionId);
    writeLastActive(sessionId);
    setPrompt("");
    setNegativePrompt("");
    clearReferenceImages();
    setError(null);
    if (window.innerWidth < 768) setSidebarOpen(false);
  }

  function deleteSession(sessionId: string) {
    if (!isSessionLive(sessionId) || deletingConversationsRef.current.has(sessionId)) return;
    const request = beginRequest();
    if (!request) return;
    const deletion: PendingConversationDelete = { accepted: new Map() };
    deletingConversationsRef.current.set(sessionId, deletion);
    invalidateDraft();
    if (draftRef.current.conversationId === sessionId) {
      handleNewConversation();
    }
    void (async () => {
      try {
        const deleted = await deleteSessionRemote(sessionId);
        if (!request.isCurrent() || deletingConversationsRef.current.get(sessionId) !== deletion) return;
        deletingConversationsRef.current.delete(sessionId);
        if (deleted) {
          forgetConversation(sessionId);
          return;
        }
        // A failed Delete restores attachment from the retained canonical cache, never another POST.
        for (const [jobId, acceptance] of deletion.accepted) {
          const canonical = getJob(jobId);
          if (canonical) attachConversationGeneration(sessionId, canonical, acceptance.replaceGenerationId);
        }
        for (const [jobId, registered] of registeredJobsRef.current) {
          if (registered.conversationId !== sessionId) continue;
          const canonical = getJob(jobId);
          if (canonical) updateGeneration(canonical);
        }
        setError("删除会话失败，请稍后重试");
      } finally {
        if (deletingConversationsRef.current.get(sessionId) === deletion) deletingConversationsRef.current.delete(sessionId);
        request.finish();
      }
    })();
  }

  function handleChannelChange(newChannelId: string) {
    setSelectedChannelId(newChannelId);
    const ch = channels.find((c) => c.id === newChannelId);
    // 仅当用户当前选择的 model 不在新渠道支持列表中时，才回退到 defaultModel。
    if (ch && !ch.models.includes(model)) {
      setModel(ch.defaultModel);
    }
  }

  function openCustomProviderSettings() {
    setProviderMode("custom");
    setShowSettings(true);
    setFocusRequest((current) => current + 1);
  }

  function handleModeChange(next: StudioMode) {
    canvasViewer.close();
    changeMode(next);
  }

  function openCanvasProviderSettings(target: CanvasNodeTarget) {
    if (canvasReadOnly || canvasSnapshot.activeCanvasId !== target.canvasId) return;
    const node = canvasSnapshot.active?.scene.nodes.find((item) => item.id === target.nodeId);
    if (node?.kind === "generation") canvasRuntime.openProviderSettings(target, node.parameters);
  }

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[radial-gradient(circle_at_52%_18%,rgba(255,255,255,0.92),transparent_32%),linear-gradient(180deg,#faf6ef_0%,#f2e9dc_100%)]">
      {canvasEnabled && <StudioModeSwitch mode={mode} onChange={handleModeChange} />}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
      {mode === "canvas" ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {canvasViewer.error && <Alert onDismiss={canvasViewer.dismissError}>{canvasViewer.error}</Alert>}
        <CanvasLazyPane snapshot={canvasSnapshot} controller={canvasController} channels={channels} editor={canvasEditor} touchPresentation={touchPresentation}
          onViewImage={canvasViewer.open}
          onDownloadImage={(target) => { void canvasViewer.download(target, handleDownload); }}
          onOpenProviderSettings={openCanvasProviderSettings}
          onReturnToChat={() => handleModeChange("conversation")} />
        <ImageZoomModal src={canvasViewer.image?.src ?? null} meta={canvasViewer.image?.meta}
          onClose={canvasViewer.close} onDownload={() => { void canvasViewer.downloadCurrent(handleDownload); }} />
        {canvasRuntime.dialog && <CanvasRuntimeDialog key={canvasRuntime.dialog.id} {...canvasRuntime} dialog={canvasRuntime.dialog} />}
        </div>
      ) : <>
      <SessionSidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onNewConversation={handleNewConversation}
        onSwitchSession={switchToSession}
        onDeleteSession={deleteSession}
      />

      <div className="relative flex min-w-0 flex-1 flex-col border-[var(--line)]/80 bg-[linear-gradient(180deg,rgba(255,251,246,0.62)_0%,rgba(247,241,232,0.36)_100%)] md:border-l">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_72%_16%,rgba(217,100,58,0.08),transparent_28%),radial-gradient(circle_at_28%_86%,rgba(255,255,255,0.58),transparent_34%)]" />
        <div className="relative z-10 flex items-center justify-between border-b border-[var(--line)]/50 bg-[#fffaf2]/70 px-4 py-2.5 backdrop-blur-md md:hidden shrink-0">
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="打开对话导航"
              onClick={() => setSidebarOpen(true)}
              className="rounded-xl border border-[var(--line)] bg-white/80 p-2 text-[var(--ink-soft)] shadow-sm transition hover:bg-white hover:text-[var(--ink)] active:scale-95"
            >
              <PanelLeftOpen aria-hidden className="size-5" />
            </button>
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-wider text-[var(--ink-soft)]/70 font-semibold leading-tight">当前会话</span>
              <span className="text-sm font-bold text-[var(--ink)] line-clamp-1 max-w-[150px] leading-tight mt-0.5">
                {activeSessionId ? (sessions.find((s) => s.id === activeSessionId)?.title ?? "新对话") : "新对话"}
              </span>
            </div>
          </div>
          {currentUser && (
            <div className="flex items-center gap-1.5 rounded-full border border-amber-200/80 bg-amber-50/60 px-3 py-1.5 shadow-xs text-xs font-semibold text-amber-800">
              <span className="size-2 rounded-full bg-amber-500 animate-pulse" />
              <span>{currentUser.credits} 积分</span>
            </div>
          )}
        </div>

        <ChatPane
          focusRequest={focusRequest}
          history={{
            conversationId: activeSessionId,
            loading: loadingConversation,
            loadingOlder: loadingOlderGenerations,
            error: conversationLoadError,
            hasMore: hasOlderGenerations,
            onReload: reloadConversation,
            onLoadOlder: loadOlderGenerations,
          }}
          stream={{
            generations: sessionGenerations,
            onZoom: handleZoomImage,
            onDownload: handleDownload,
            onUseForEdit: handleUseImageForEdit,
            onReuseConfig: handleReuseConfig,
            onRetry: handleRetryGeneration,
            onCancel: handleCancelGeneration,
          }}
          composer={{
            prompt,
            onChangePrompt: handleChangePrompt,
            onPaste: handlePaste,
            onKeyDownEnter: handleSubmit,
            isPending,
            error,
            onDismissError: () => setError(null),
            generationType,
            onChangeGenerationType: handleChangeGenerationType,
            referenceImages,
            onPickFiles: handleReferenceFiles,
            onPickImageUrl: handleUseImageForEdit,
            onRemoveReference: handleRemoveReference,
            onMoveReference: handleMoveReference,
            onReorderReference: handleReorderReference,
            size,
            sizeSelectValue,
            onSizeSelect: handleSizeSelect,
            showSettings,
            onToggleSettings: () => setShowSettings((current) => !current),
            channels,
            selectedChannelId,
            onChangeChannel: handleChannelChange,
            modelOptions,
            model,
            onChangeModel: setModel,
            providerMode,
            activeModel,
            onOpenCustomProviderSettings: openCustomProviderSettings,
            onSubmit: handleSubmit,
            canSubmit: Boolean((prompt.trim() || referenceImages.length > 0) && (!needsTurnstile || turnstileToken)),
            onClickImageMode: () => handleChangeGenerationType("image_to_image"),
            turnstileSlot: needsTurnstile && turnstile?.siteKey ? (
              <TurnstileWidget
                ref={turnstileWidgetRef}
                siteKey={turnstile.siteKey}
                onVerify={updateChallenge}
                onExpire={clearChallenge}
                onError={clearChallenge}
              />
            ) : undefined,
          }}
        >
          <AdvancedSettings
            open={showSettings}
            showCustomSize={sizeSelectValue === "custom"}
            customWidth={customWidth}
            customHeight={customHeight}
            normalizedCustomSize={normalizedCustomSize}
            customSizeWarning={customSizeWarning}
            count={count}
            quality={quality}
            outputFormat={outputFormat}
            outputCompression={outputCompression}
            moderation={moderation}
            negativePrompt={negativePrompt}
            generationType={generationType}
            channels={channels}
            selectedChannelId={selectedChannelId}
            onChangeChannel={handleChannelChange}
            modelOptions={modelOptions}
            model={model}
            onChangeModel={setModel}
            providerMode={providerMode}
            onChangeProviderMode={setProviderMode}
            customProvider={customProvider}
            onChangeCustomProvider={handleChangeCustomProvider}
            customModelOptions={customModelOptions}
            savedProviderConfigured={savedProviderConfigured}
            onProbeCustomProviderModels={handleProbeCustomProviderModels}
            customProviderProbePending={customProviderProbePending}
            customProviderProbeMessage={customProviderProbeMessage}
            onChangeCustomSize={updateCustomSize}
            onChangeCount={setCount}
            onChangeQuality={setQuality}
            onChangeOutputFormat={setOutputFormat}
            onChangeOutputCompression={setOutputCompression}
            onChangeModeration={setModeration}
            onChangeNegativePrompt={setNegativePrompt}
          />
        </ChatPane>

        <ImageZoomModal
          src={zoomedImage}
          meta={zoomedImageMeta}
          onClose={() => {
            setZoomedImage(null);
            setZoomedImageMeta(null);
          }}
          onDownload={handleDownload}
          onUseForEdit={(url) => void handleUseImageForEdit(url)}
        />

        {/* Mobile Advanced Settings Bottom Sheet */}
        <AnimatePresence>
          {showSettings && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowSettings(false)}
                className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs md:hidden"
              />
              <motion.div
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={{ type: "spring", damping: 25, stiffness: 250 }}
                className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] rounded-t-[2rem] bg-[#fffaf2]/96 border-t border-[var(--line)] shadow-[0_-10px_35px_rgba(94,58,33,0.15)] overflow-y-auto pb-8 backdrop-blur-md md:hidden"
              >
                <div className="sticky top-0 bg-[#fffaf2]/96 backdrop-blur-md pt-3 pb-1 px-6 border-b border-[var(--line)]/50 z-10">
                  <div className="flex justify-center mb-2">
                    <div className="w-12 h-1.5 rounded-full bg-[var(--line)]" />
                  </div>
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold text-[var(--ink)]">高级设置</h3>
                    <button
                      type="button"
                      onClick={() => setShowSettings(false)}
                      className="rounded-full bg-white/60 p-1 px-3 text-xs font-semibold text-[var(--ink-soft)] hover:bg-white border border-[var(--line)] transition"
                    >
                      完成
                    </button>
                  </div>
                </div>

                <div className="p-4">
                  <AdvancedSettings
                    open={true}
                    showCustomSize={sizeSelectValue === "custom"}
                    customWidth={customWidth}
                    customHeight={customHeight}
                    normalizedCustomSize={normalizedCustomSize}
                    customSizeWarning={customSizeWarning}
                    count={count}
                    quality={quality}
                    outputFormat={outputFormat}
                    outputCompression={outputCompression}
                    moderation={moderation}
                    negativePrompt={negativePrompt}
                    generationType={generationType}
                    channels={channels}
                    selectedChannelId={selectedChannelId}
                    onChangeChannel={handleChannelChange}
                    modelOptions={modelOptions}
                    model={model}
                    onChangeModel={setModel}
                    providerMode={providerMode}
                    onChangeProviderMode={setProviderMode}
                    customProvider={customProvider}
                    onChangeCustomProvider={handleChangeCustomProvider}
                    customModelOptions={customModelOptions}
                    savedProviderConfigured={savedProviderConfigured}
                    onProbeCustomProviderModels={handleProbeCustomProviderModels}
                    customProviderProbePending={customProviderProbePending}
                    customProviderProbeMessage={customProviderProbeMessage}
                    onChangeCustomSize={updateCustomSize}
                    onChangeCount={setCount}
                    onChangeQuality={setQuality}
                    onChangeOutputFormat={setOutputFormat}
                    onChangeOutputCompression={setOutputCompression}
                    onChangeModeration={setModeration}
                    onChangeNegativePrompt={setNegativePrompt}
                  />
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
      </>}
      </div>
    </div>
  );
}
