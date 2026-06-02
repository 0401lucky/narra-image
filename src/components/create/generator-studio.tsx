"use client";

// 创作台容器组件。仅负责状态编排与子组件接线，
// 各子组件、hooks 与工具函数已拆分到同目录的 hooks / parts / utils / constants / types 下。
import { PanelLeftOpen } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
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

import { useImagePoller } from "./hooks/use-image-poller";
import { useReferenceImages } from "./hooks/use-reference-images";
import { useSessions } from "./hooks/use-sessions";
import { MAX_REFERENCE_IMAGES } from "./constants";
import { ChatStream } from "./parts/chat-stream";
import { Composer } from "./parts/composer";
import { HistoryRail } from "./parts/history-rail";
import { SessionSidebar } from "./parts/session-sidebar";
import { getSizeSelectValue, toReusableGenerationConfig } from "./utils";
import type {
  ChannelInfo,
  CustomProviderDraft,
  GenerationItem,
  ProviderSelectionMode,
  ReferenceImage,
  SavedProviderInfo,
  SessionInfo,
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
  compact?: boolean;
  checkInSummary: {
    checkInReward: number;
    checkedInToday: boolean;
  };
  currentUser: ViewerUser;
  initialGenerations?: GenerationItem[];
  initialConversations?: SessionInfo[];
  channels?: ChannelInfo[];
  savedProvider?: SavedProviderInfo | null;
};

// 模块级稳定空数组，避免组件每次 render 时 default 表达式创建新引用，
// 进而让 useEffect 的依赖项每次都"变化"导致死循环重跑。
const EMPTY_GENERATIONS: GenerationItem[] = [];
const EMPTY_CONVERSATIONS: SessionInfo[] = [];
const EMPTY_CHANNELS: ChannelInfo[] = [];

export function GeneratorStudio({
  currentUser,
  initialGenerations = EMPTY_GENERATIONS,
  initialConversations = EMPTY_CONVERSATIONS,
  channels = EMPTY_CHANNELS,
  savedProvider = null,
}: GeneratorStudioProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [generationType, setGenerationType] = useState<GenerationType>("text_to_image");
  const [prompt, setPrompt] = useState("");
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
    refresh: refreshSessions,
    createSession,
    renameSession,
    appendGeneration: appendGenerationToSession,
    deleteSession: deleteSessionRemote,
    readLastActive,
    writeLastActive,
  } = useSessions(initialConversations);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionGenerations, setSessionGenerations] = useState<GenerationItem[]>([]);

  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const composerShellRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isComposingRef = useRef(false);
  const [composerBottomInset, setComposerBottomInset] = useState(0);
  // 缓存"看到过"的所有 generation，用于跨会话切换时还原本次会话期间产生的新数据。
  const allGenerationsRef = useRef<Map<string, GenerationItem>>(new Map());

  // 初始化：选择上次活跃会话或最新一条；若用户的 generation 还没有归属任何 conversation，
  // 先把孤儿 generation 展示出来保证视觉连续性。
  // 这里不主动调用 createSession API（避免在初始渲染就发起网络请求与潜在的测试副作用）；
  // 用户首次发送 generation 时会在 handleGenerate 中按需 createSession，归属落地由后端绑定。
  useEffect(() => {
    const lastId = readLastActive();
    const stored = initialConversations;

    const knownIds = new Set(stored.flatMap((session) => session.generationIds));
    const orphans = initialGenerations.filter((generation) => !knownIds.has(generation.id));
    if (stored.length === 0 && orphans.length > 0) {
      // 把孤儿 generation 直接显示出来；activeSessionId 维持 null，下一次 handleGenerate 自动建会话。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSessionGenerations(
        orphans.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
      );
      return;
    }

    const target = stored.find((s) => s.id === lastId) ?? stored[0] ?? null;
    if (target) {
      setActiveSessionId(target.id);
      writeLastActive(target.id);
      const gens = target.generationIds
        .map((id) => initialGenerations.find((g) => g.id === id))
        .filter((g): g is GenerationItem => g !== undefined)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      setSessionGenerations(gens);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialGenerations, initialConversations]);

  // 累积所有看到过的 generation 到 ref，避免切换会话时丢失本会话产生的新数据。
  useEffect(() => {
    for (const generation of initialGenerations) {
      allGenerationsRef.current.set(generation.id, generation);
    }
    for (const generation of sessionGenerations) {
      allGenerationsRef.current.set(generation.id, generation);
    }
  }, [initialGenerations, sessionGenerations]);

  // 仅当用户视图已经接近底部（80px 内）时才强制滚动，避免用户向上回看时被打断。
  useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el || typeof el.scrollTo !== "function") return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 80) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [sessionGenerations, isPending]);

  // 文本框自适应高度。
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 144)}px`;
    }
  }, [prompt]);

  // Composer 是底部悬浮覆盖层；对话流底部留白需要跟随它的实际高度，
  // 否则参考图、错误提示或桌面高级设置展开后会遮住最后一条消息。
  useEffect(() => {
    const shell = composerShellRef.current;
    if (!shell) return;

    const updateBottomInset = () => {
      const nextInset = Math.ceil(shell.getBoundingClientRect().height);
      setComposerBottomInset((current) => (current === nextInset ? current : nextInset));
    };

    updateBottomInset();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateBottomInset);
      return () => window.removeEventListener("resize", updateBottomInset);
    }

    const observer = new ResizeObserver(updateBottomInset);
    observer.observe(shell);
    window.addEventListener("resize", updateBottomInset);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateBottomInset);
    };
  }, []);

  // 单图轮询：拆为独立 hook，外部传入更新回调。
  const handlePollerUpdate = useCallback((updated: GenerationItem) => {
    setSessionGenerations((current) =>
      current.map((generation) => (generation.id === updated.id ? updated : generation)),
    );
  }, []);
  useImagePoller({ generations: sessionGenerations, onUpdate: handlePollerUpdate });

  // 历史图片栏数据：合并初始历史 + 当前会话新生成图，按 id 去重，按 generation 时间倒序。
  const historyImages = useMemo(() => {
    const seen = new Set<string>();
    const merged: Array<{ id: string; url: string; createdAt: string; generation: GenerationItem }> = [];
    for (const generation of [...initialGenerations, ...sessionGenerations]) {
      if (generation.status !== "succeeded") continue;
      for (const image of generation.images) {
        if (seen.has(image.id)) continue;
        seen.add(image.id);
        merged.push({
          createdAt: generation.createdAt,
          generation,
          id: image.id,
          url: image.url,
        });
      }
    }
    merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return merged;
  }, [initialGenerations, sessionGenerations]);

  const sortedGenerations = sessionGenerations;
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
        models: customProvider.models,
        remember: customProvider.remember,
      },
    };
  }

  async function handleProbeCustomProviderModels() {
    const baseUrl = customProvider.baseUrl.trim();
    if (!baseUrl) {
      setCustomProviderProbeMessage("请先填写 Base URL");
      return;
    }

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
      });
      const result = (await response.json()) as {
        data?: { models?: Array<{ id: string } | string> };
        error?: string;
      };

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
      setCustomProviderProbeMessage(err instanceof Error ? err.message : "模型拉取失败，请手动填写模型名");
    } finally {
      setCustomProviderProbePending(false);
    }
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

  function handleZoomImage(
    url: string,
    meta?: { dimensionLabel?: string; ratioLabel?: string },
  ) {
    setZoomedImage(url);
    setZoomedImageMeta(meta ?? null);
  }

  type GenerateSnapshot = {
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
    customProviderBaseUrl: string;
    customProviderLabel: string;
    customProviderModels: string[];
    customProviderRemember: boolean;
    selectedChannelId: string | null;
    size: GenerationSizeToken;
  };

  function handleSubmit() {
    if (!currentUser) {
      router.push("/login");
      return;
    }
    setError(null);
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

    // 快照本次发送的内容并立即清空输入区。
    // 必须在 startTransition 之外执行：transition 内的 setState 是低优先级，会被推迟到 await 完成后才提交。
    const snapshot: GenerateSnapshot = {
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
      referenceImages: referenceImages.slice(),
      customProviderBaseUrl: customProvider.baseUrl.trim(),
      customProviderLabel: customProvider.label.trim() || "我的 API",
      customProviderModels: customProvider.models,
      customProviderRemember: customProvider.remember,
      selectedChannelId,
      size,
    };

    setPrompt("");
    setReferenceImages([]);
    if (snapshot.generationType === "image_to_image") {
      setGenerationType("text_to_image");
    }

    startTransition(() => {
      void handleGenerate(snapshot);
    });
  }

  async function handleGenerate(snapshot: GenerateSnapshot) {
    function restoreSnapshot(message: string) {
      setError(message);
      setPrompt((current) => (current ? current : snapshot.prompt));
      setReferenceImages((current) => {
        if (current.length > 0) {
          // 已有新参考图，丢弃旧的预览以避免内存泄漏。
          snapshot.referenceImages.forEach((image) => URL.revokeObjectURL(image.previewUrl));
          return current;
        }
        return snapshot.referenceImages;
      });
      if (snapshot.generationType === "image_to_image") {
        setGenerationType("image_to_image");
      }
    }

    try {
      // 若当前没有活跃会话，先在服务端创建一个；保证 generation 一定挂在某个 conversation 下。
      let conversationId = activeSessionId;
      if (!conversationId) {
        const created = await createSession(snapshot.prompt.slice(0, 30) || "新对话");
        if (created) {
          conversationId = created.id;
          setActiveSessionId(created.id);
          writeLastActive(created.id);
        }
      }

      const response =
        snapshot.generationType === "image_to_image"
          ? await fetch("/api/generate", {
              method: "POST",
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
                snapshot.referenceImages.forEach((referenceImage) => {
                  if (referenceImage.sourceUrl) {
                    formData.append("referenceImageUrls", referenceImage.sourceUrl);
                  } else if (referenceImage.file) {
                    formData.append("referenceImages", referenceImage.file);
                  }
                });
                return formData;
              })(),
            })
          : await fetch("/api/generate", {
              method: "POST",
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
                size: snapshot.size,
              }),
            });

      const result = (await response.json()) as {
        data?: { generation: GenerationItem };
        error?: string;
      };

      if (!response.ok) {
        restoreSnapshot(result.error || "生成失败，请稍后再试");
        return;
      }
      const generation = result.data?.generation;
      if (!generation) {
        restoreSnapshot("服务端没有返回图片");
        return;
      }

      // 成功后释放快照中的参考图预览 URL。
      snapshot.referenceImages.forEach((image) => URL.revokeObjectURL(image.previewUrl));

      setSessionGenerations((current) => [...current, generation]);
      // 把 generation 写入会话本地状态；服务端在 /api/generate 已自动绑定 conversationId 与刷新 title。
      const targetConversationId = generation.conversationId ?? activeSessionId;
      if (targetConversationId) {
        appendGenerationToSession(targetConversationId, generation.id);
        // 若是会话内首条 generation 且 title 还是默认的"新对话"，本地同步一份 title。
        const session = sessions.find((s) => s.id === targetConversationId);
        if (session && session.generationIds.length === 0 && session.title === "新对话") {
          void renameSession(targetConversationId, generation.prompt.slice(0, 30) || "新对话");
        }
      } else {
        // 兜底：服务端没返回 conversationId（理论上不应发生），刷新一次会话列表。
        void refreshSessions();
      }
    } catch (err) {
      restoreSnapshot(err instanceof Error ? err.message : "生成失败，请稍后再试");
    }
  }

  function handleReferenceFiles(files: File[] | FileList | null) {
    const result = addFiles(files);
    if (result === "empty") return;
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
    requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true });
    });
  }

  function handleReuseConfig(generation: GenerationItem) {
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
    requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true });
    });
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

  // 取消一个仍在 pending 的 generation：仅停止前端轮询并把 UI 标记为 failed/已取消。
  // 后端 after() 仍可能继续生成，但结果不再回灌（用户可在历史接口里按 jobId 找到）。
  // 如未来要做"真取消"，需要在 /api/me/generations/[id] 增加 PATCH/DELETE 端点退还积分。
  function handleCancelGeneration(target: GenerationItem) {
    setSessionGenerations((current) =>
      current.map((g) =>
        g.id === target.id && g.status === "pending"
          ? { ...g, errorMessage: "已被用户取消", status: "failed" as const }
          : g,
      ),
    );
  }

  // 失败重试：使用原 generation 的 prompt + 当前选项重新触发，等价于用户手动重新填写一次。
  // 注意：不复用原 sourceImageUrls（图生图）——参考图在原文件已不可用，重试时退回文生图。
  function handleRetryGeneration(target: GenerationItem) {
    if (target.status === "pending") return;
    if (!currentUser) {
      router.push("/login");
      return;
    }
    setError(null);
    const customProviderResult = getActiveCustomProviderSubmitPayload();
    if (customProviderResult.error) {
      setShowSettings(true);
      setError(customProviderResult.error);
      return;
    }
    const snapshot: GenerateSnapshot = {
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
      customProviderBaseUrl: customProvider.baseUrl.trim(),
      customProviderLabel: customProvider.label.trim() || "我的 API",
      customProviderModels: customProvider.models,
      customProviderRemember: customProvider.remember,
      selectedChannelId,
      size,
    };
    startTransition(() => {
      void handleGenerate(snapshot);
    });
  }

  function handleNewConversation() {
    // 暂不立即创建服务端会话，等首次发送 generation 时再 createSession，避免空会话堆积。
    setActiveSessionId(null);
    writeLastActive(null);
    setSessionGenerations([]);
    setPrompt("");
    setNegativePrompt("");
    clearReferenceImages();
    setGenerationType("text_to_image");
    setError(null);
    setShowSettings(false);
  }

  function switchToSession(sessionId: string) {
    setActiveSessionId(sessionId);
    writeLastActive(sessionId);
    const session = sessions.find((s) => s.id === sessionId);
    if (session) {
      // 优先从 ref 缓存中读，命中不到再回退 initialGenerations，
      // 这样能包含"当前会话生成、未刷入 SSR 数据"的 generation。
      const gens = session.generationIds
        .map((id) => allGenerationsRef.current.get(id) ?? initialGenerations.find((g) => g.id === id))
        .filter((g): g is GenerationItem => g !== undefined)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      setSessionGenerations(gens);
    }
    setPrompt("");
    setNegativePrompt("");
    clearReferenceImages();
    setError(null);
    if (window.innerWidth < 768) setSidebarOpen(false);
  }

  function deleteSession(sessionId: string) {
    void deleteSessionRemote(sessionId);
    if (activeSessionId === sessionId) {
      handleNewConversation();
    }
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
    requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true });
    });
  }

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-[radial-gradient(circle_at_52%_18%,rgba(255,255,255,0.92),transparent_32%),linear-gradient(180deg,#faf6ef_0%,#f2e9dc_100%)]">
      <SessionSidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onNewConversation={handleNewConversation}
        onSwitchSession={switchToSession}
        onDeleteSession={deleteSession}
        historyImages={historyImages}
        onPickImage={(url) => {
          setZoomedImage(url);
          setSidebarOpen(false);
        }}
      />

      <div className="relative flex min-w-0 flex-1 flex-col border-x border-[var(--line)]/80 bg-[linear-gradient(180deg,rgba(255,251,246,0.62)_0%,rgba(247,241,232,0.36)_100%)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_72%_16%,rgba(217,100,58,0.08),transparent_28%),radial-gradient(circle_at_28%_86%,rgba(255,255,255,0.58),transparent_34%)]" />
        <div className="relative z-10 flex items-center justify-between border-b border-[var(--line)]/50 bg-[#fffaf2]/70 px-4 py-2.5 backdrop-blur-md md:hidden shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="rounded-xl border border-[var(--line)] bg-white/80 p-2 text-[var(--ink-soft)] shadow-sm transition hover:bg-white hover:text-[var(--ink)] active:scale-95"
            >
              <PanelLeftOpen className="size-5" />
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

        <ChatStream
          ref={scrollAreaRef}
          generations={sortedGenerations}
          onZoom={handleZoomImage}
          onDownload={handleDownload}
          onUseForEdit={(url) => void handleUseImageForEdit(url)}
          bottomInset={composerBottomInset}
          onReuseConfig={handleReuseConfig}
          onRetry={handleRetryGeneration}
          onCancel={handleCancelGeneration}
        />

        <Composer
          ref={textareaRef}
          shellRef={composerShellRef}
          prompt={prompt}
          onChangePrompt={setPrompt}
          onPaste={handlePaste}
          onCompositionStart={() => { isComposingRef.current = true; }}
          onCompositionEnd={() => { isComposingRef.current = false; }}
          onKeyDownEnter={handleSubmit}
          isComposing={() => isComposingRef.current}
          isPending={isPending}
          error={error}
          onDismissError={() => setError(null)}
          generationType={generationType}
          onChangeGenerationType={setGenerationType}
          referenceImages={referenceImages}
          onPickFiles={handleReferenceFiles}
          onPickImageUrl={handleUseImageForEdit}
          onRemoveReference={handleRemoveReference}
          onMoveReference={moveImage}
          onReorderReference={reorderImage}
          size={size}
          sizeSelectValue={sizeSelectValue}
          onSizeSelect={handleSizeSelect}
          showSettings={showSettings}
          onToggleSettings={() => setShowSettings((s) => !s)}
          channels={channels}
          selectedChannelId={selectedChannelId}
          onChangeChannel={handleChannelChange}
          modelOptions={modelOptions}
          model={model}
          onChangeModel={setModel}
          providerMode={providerMode}
          activeModel={activeModel}
          onOpenCustomProviderSettings={openCustomProviderSettings}
          onSubmit={handleSubmit}
          canSubmit={Boolean(prompt.trim() || referenceImages.length > 0)}
          onClickImageMode={() => setGenerationType("image_to_image")}
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
            onChangeCustomProvider={setCustomProvider}
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
        </Composer>

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
                    onChangeCustomProvider={setCustomProvider}
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

      <HistoryRail
        images={historyImages}
        onPickImage={(url) => setZoomedImage(url)}
        onUseForEdit={handleUseImageForEdit}
        onReuseConfig={handleReuseConfig}
      />
    </div>
  );
}
