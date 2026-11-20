"use client";

// 创作台容器组件：三栏生图工作台（左生成记录 · 中参数工作台 · 右生成结果）+ 画布模式共存。
// 仅负责状态编排、请求生命周期与子组件接线；UI 区块与状态逻辑拆分在同目录 hooks / parts / utils / size-controls 下。
import { History, Image as ImageIcon, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";

import {
  type GenerationModeration,
  type GenerationOutputFormat,
  type GenerationQuality,
  type GenerationType,
} from "@/lib/types";
import { calculateGenerationCost } from "@/lib/credits";
import { isImageAvailable } from "@/lib/storage/image-availability";
import {
  TurnstileWidget,
  type TurnstileWidgetHandle,
} from "@/components/auth/turnstile-widget";
import { Alert } from "@/components/ui/alert";
import { canvasGenerationParametersSchema } from "@/lib/validators";
import { cn } from "@/lib/utils";

import { MAX_REFERENCE_IMAGES } from "./constants";
import { isGenerationItem } from "./generation-item";
import { useCanvasDocuments } from "./hooks/use-canvas-documents";
import { useCanvasEditor } from "./hooks/use-canvas-editor";
import { useCanvasImageViewer } from "./hooks/use-canvas-image-viewer";
import { useCanvasRuntimeLease } from "./hooks/use-canvas-runtime-lease";
import { useReferenceImages } from "./hooks/use-reference-images";
import { useStudioJobs } from "./hooks/use-studio-jobs";
import { useStudioMode, type StudioMode } from "./hooks/use-studio-mode";
import { useWorkbenchRecords } from "./hooks/use-workbench-records";
import { CanvasLazyPane } from "./parts/canvas-lazy-pane";
import { CanvasRuntimeDialog } from "./parts/canvas-runtime-dialog";
import type { CanvasNodeTarget } from "./parts/canvas-stage";
import { StudioModeSwitch } from "./parts/studio-mode-switch";
import { WorkbenchComposer } from "./parts/workbench-composer";
import { WorkbenchHistoryRail } from "./parts/workbench-history-rail";
import { WorkbenchResultStage } from "./parts/workbench-result-stage";
import {
  DEFAULT_SIZE_CONTROL_STATE,
  applyDimensionAlignment,
  deriveSizeControlState,
  selectAspectRatio,
  selectResolutionTier,
  swapDimensions,
  toggleAlignMultiple16,
  updateDimensionInputs,
  type AspectRatioPreset,
  type ResolutionOptionValue,
  type SizeControlState,
} from "./size-controls";
import type {
  ChannelInfo,
  CustomProviderDraft,
  GenerationItem,
  ProviderSelectionMode,
  ReferenceImage,
  SavedProviderInfo,
  StudioTurnstile,
  ViewerUser,
} from "./types";
import { getGenerationSourceImageUrls, toReusableGenerationConfig } from "./utils";

const ImageZoomModal = dynamic(
  () => import("./parts/image-zoom-modal").then((mod) => mod.ImageZoomModal),
  { ssr: false },
);
const PromptPickerModal = dynamic(
  () => import("./parts/prompt-picker-modal").then((mod) => mod.PromptPickerModal),
  { ssr: false },
);
const WorksPickerModal = dynamic(
  () => import("./parts/works-picker-modal").then((mod) => mod.WorksPickerModal),
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
  initialHasMore?: boolean;
  initialNextCursor?: string | null;
  initialPrompt?: string;
  channels?: ChannelInfo[];
  savedProvider?: SavedProviderInfo | null;
  turnstile?: StudioTurnstile | null;
};

const EMPTY_GENERATIONS: GenerationItem[] = [];
const EMPTY_CHANNELS: ChannelInfo[] = [];

type StudioRequest = {
  controller: AbortController;
  isCurrent: () => boolean;
  finish: () => void;
};

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

type GenerateSnapshot = {
  challenge: { token: string | null; revision: number };
  needsTurnstile: boolean;
  count: number;
  customProvider: CustomProviderSubmitPayload | null;
  generationType: Extract<GenerationType, "text_to_image" | "image_to_image">;
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
  size: string;
};

type ZoomState = {
  url: string;
  meta?: { dimensionLabel?: string; ratioLabel?: string };
  recordId?: string;
  imageId?: string;
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
  initialHasMore = false,
  initialNextCursor = null,
  initialPrompt = "",
  channels = EMPTY_CHANNELS,
  savedProvider = null,
  turnstile = null,
}: GeneratorStudioProps) {
  const router = useRouter();
  const { mode, canvasReadOnly, touchPresentation, changeMode } = useStudioMode(ownerId, canvasEnabled);

  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clipboardNotice, setClipboardNotice] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [promptPickerOpen, setPromptPickerOpen] = useState(false);
  const [worksPickerOpen, setWorksPickerOpen] = useState(false);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<"workbench" | "result">("workbench");
  const [zoomState, setZoomState] = useState<ZoomState | null>(null);

  const promptTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const runtimeRef = useRef({ active: false, epoch: 0, requests: new Set<AbortController>() });
  const submitPendingRef = useRef(false);
  const providerProbeRef = useRef<StudioRequest | null>(null);
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
      submitPendingRef.current = false;
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

  // 工作台参数草稿
  const [prompt, setPrompt] = useState(initialPrompt);
  const [negativePrompt, setNegativePrompt] = useState("");
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(channels[0]?.id ?? null);
  const selectedChannel = useMemo(
    () => channels.find((item) => item.id === selectedChannelId) ?? channels[0] ?? null,
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
  const [sizeState, setSizeState] = useState<SizeControlState>(DEFAULT_SIZE_CONTROL_STATE);
  const [quality, setQuality] = useState<GenerationQuality>("auto");
  const [outputFormat, setOutputFormat] = useState<GenerationOutputFormat>("png");
  const [outputCompression, setOutputCompression] = useState(100);
  const [moderation, setModeration] = useState<GenerationModeration>("auto");
  const [count, setCount] = useState(1);

  const {
    referenceImages,
    addFiles,
    removeImage,
    moveImage,
    reorderImage,
    clear: clearReferenceImages,
    setImages: setReferenceImages,
  } = useReferenceImages();

  // 扁平生成记录
  const {
    records,
    selectedId,
    selectedRecord,
    checkedIds,
    allChecked,
    hasMore,
    loadingMore,
    loadError,
    hiding,
    notice: historyNotice,
    dismissNotice: dismissHistoryNotice,
    selectRecord,
    toggleCheck,
    toggleSelectAll,
    prependRecord,
    updateRecord,
    loadMore,
    hideRecords,
  } = useWorkbenchRecords({
    ownerId,
    initialGenerations,
    initialHasMore,
    initialNextCursor,
  });

  // 根任务轮询器与权威可用性缓存（工作台与画布共用）
  const knownStatusesRef = useRef(new Map<string, GenerationItem["status"]>());
  const registeredJobsRef = useRef(new Map<string, GenerationItem>());
  const handleWorkbenchJobUpdate = useCallback((updated: GenerationItem) => {
    const previous = knownStatusesRef.current.get(updated.id);
    knownStatusesRef.current.set(updated.id, updated.status);
    updateRecord(updated);
    if (previous === "pending" && updated.status !== "pending") {
      router.refresh();
    }
  }, [router, updateRecord]);

  const { registerWorkbench, getJob, updateJob, canvasJobs } = useStudioJobs({
    ownerId,
    onWorkbenchUpdate: handleWorkbenchJobUpdate,
  });

  // Canvas 模式 hooks（完整保留既有画布契约与独立运行）
  const defaultCanvasParameters = useMemo(() => canvasGenerationParametersSchema.parse({
    model: channels[0]?.defaultModel || "gpt-image-2",
    channelId: channels[0]?.id ?? null,
  }), [channels]);
  const canvasRuntime = useCanvasRuntimeLease({
    ownerId,
    enabled: canvasEnabled,
    readOnly: canvasReadOnly,
    savedProvider,
    turnstile,
  });
  const { controller: canvasController, snapshot: canvasSnapshot } = useCanvasDocuments({
    ownerId,
    enabled: canvasEnabled,
    readOnly: canvasReadOnly,
    defaultParameters: defaultCanvasParameters,
    jobs: canvasJobs,
    acquireTransientLease: canvasRuntime.acquireTransientLease,
  });
  const canvasEditor = useCanvasEditor(canvasSnapshot, canvasController);
  const canvasViewer = useCanvasImageViewer(canvasController, getJob);

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
      queueMicrotask(() => {
        refreshQueued = false;
        if (live) router.refresh();
      });
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [canvasJobs, ownerId, router]);

  // 把可见工作台任务注册到根 poller，并在 canonical 变化时单向收敛写回。
  useEffect(() => {
    for (const record of records) {
      if (registeredJobsRef.current.get(record.id) === record) continue;
      if (!knownStatusesRef.current.has(record.id)) {
        knownStatusesRef.current.set(record.id, record.status);
      }
      const canonical = registerWorkbench(record);
      registeredJobsRef.current.set(record.id, canonical);
      if (canonical !== record) updateRecord(canonical);
    }
  }, [records, registerWorkbench, updateRecord]);

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
  const unitCreditCost = selectedChannel?.creditCost ?? null;
  const totalCreditCost = calculateGenerationCost({
    providerMode,
    builtInCreditCost: unitCreditCost ?? 0,
    count,
  });

  // 实时解析放大查看器的权威地址与可用性（遵循 state-management.md §5.4）
  const activeZoom = useMemo(() => {
    if (!zoomState) return null;
    if (zoomState.recordId && zoomState.imageId) {
      const record = records.find((item) => item.id === zoomState.recordId) ?? getJob(zoomState.recordId);
      const image = record?.images.find((item) => item.id === zoomState.imageId);
      if (image) {
        if (!isImageAvailable(image.availability)) return null;
        return { src: image.url, meta: zoomState.meta };
      }
    }
    return { src: zoomState.url, meta: zoomState.meta };
  }, [getJob, records, zoomState]);

  function getCustomProviderSubmitPayload(): CustomProviderSubmitResult {
    const apiKey = customProvider.apiKey.trim();
    const baseUrl = customProvider.baseUrl.trim();
    const label = customProvider.label.trim() || "我的 API";
    const customModel = customProvider.model.trim();

    if (!baseUrl) return { error: "请输入第三方 Base URL", payload: null };
    try {
      new URL(baseUrl);
    } catch {
      return { error: "请输入正确的第三方 Base URL", payload: null };
    }
    if (!customModel) return { error: "请输入第三方模型名", payload: null };
    if (!apiKey && !savedProviderConfigured) return { error: "请输入第三方 API Key", payload: null };
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
      if (request.isCurrent()) {
        setCustomProviderProbeMessage(err instanceof Error ? err.message : "模型拉取失败，请手动填写模型名");
      }
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

  function handleChannelChange(newChannelId: string) {
    setSelectedChannelId(newChannelId);
    const ch = channels.find((item) => item.id === newChannelId);
    if (ch && !ch.models.includes(model)) {
      setModel(ch.defaultModel);
    }
  }

  function handleReferenceFiles(files: File[] | FileList | null) {
    const result = addFiles(files);
    if (result === "empty") return;
    setClipboardNotice(null);
    if (result === "exceeded") {
      setError(`最多上传 ${MAX_REFERENCE_IMAGES} 张参考图`);
    } else {
      setError(null);
    }
  }

  function handleAddToReference(url: string) {
    if (referenceImages.length >= MAX_REFERENCE_IMAGES) {
      setError(`最多上传 ${MAX_REFERENCE_IMAGES} 张参考图`);
      return;
    }
    const image: ReferenceImage = {
      id: `${Date.now()}_url_${Math.random().toString(36).slice(2, 8)}`,
      file: null,
      previewUrl: url,
      sourceUrl: url,
    };
    setReferenceImages((current) => (current.length >= MAX_REFERENCE_IMAGES ? current : [...current, image]));
    setError(null);
    setClipboardNotice(null);
  }

  function handlePaste(event: ClipboardEvent) {
    const items = event.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (let index = 0; index < items.length; index += 1) {
      if (items[index].type.startsWith("image/")) {
        const file = items[index].getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      handleReferenceFiles(files);
      event.preventDefault();
    }
  }

  async function handleReadClipboard() {
    setClipboardNotice(null);
    if (typeof navigator === "undefined" || !navigator.clipboard || typeof navigator.clipboard.read !== "function") {
      setClipboardNotice("当前浏览器不支持一键读取剪贴板，请直接按 Ctrl+V 粘贴图片");
      return;
    }
    try {
      const clipboardItems = await navigator.clipboard.read();
      const imageFiles: File[] = [];
      for (const item of clipboardItems) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        const ext = imageType.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "png";
        imageFiles.push(new File([blob], `clipboard-${Date.now()}.${ext}`, { type: imageType }));
      }
      if (imageFiles.length === 0) {
        setClipboardNotice("剪贴板中未检测到图片，可复制图片后重试或直接拖入");
        return;
      }
      handleReferenceFiles(imageFiles);
    } catch {
      setClipboardNotice("浏览器未授权读取剪贴板，请直接按 Ctrl+V 粘贴图片");
    }
  }

  async function submitSnapshot(snapshot: GenerateSnapshot) {
    if (submitPendingRef.current) return;
    const request = beginRequest();
    if (!request) return;

    submitPendingRef.current = true;
    setIsPending(true);
    setError(null);

    let submitted = false;
    try {
      submitted = true;
      const response = snapshot.generationType === "image_to_image"
        ? await fetch("/api/generate", {
            method: "POST",
            signal: request.controller.signal,
            body: (() => {
              const formData = new FormData();
              formData.append("generationType", "image_to_image");
              formData.append("count", String(snapshot.count));
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
              snapshot.referenceImages.forEach((refImage) => {
                if (refImage.sourceUrl) {
                  formData.append("referenceImageUrls", refImage.sourceUrl);
                } else if (refImage.file) {
                  formData.append("referenceImages", refImage.file);
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
            signal: request.controller.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              channelId: snapshot.providerMode === "built_in" ? snapshot.selectedChannelId : undefined,
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
              turnstileToken: snapshot.challenge.token || undefined,
            }),
          });

      if (!request.isCurrent()) return;
      const result = (await response.json().catch(() => null)) as {
        data?: { generation?: unknown };
        error?: unknown;
      } | null;
      if (!request.isCurrent()) return;

      if (!response.ok) {
        setError(typeof result?.error === "string" && result.error ? result.error : "生成失败，请稍后再试");
        return;
      }
      const generation = result?.data?.generation;
      if (!isGenerationItem(generation)) {
        setError("服务端返回的生成内容不正确，请稍后再试");
        return;
      }

      knownStatusesRef.current.set(generation.id, generation.status);
      const canonical = registerWorkbench(generation);
      registeredJobsRef.current.set(canonical.id, canonical);
      prependRecord(canonical);
      setMobileTab("result");
      router.refresh();
    } catch {
      if (request.isCurrent()) setError("生成失败，请稍后再试");
    } finally {
      if (
        request.isCurrent()
        && submitted
        && snapshot.needsTurnstile
        && challengeRef.current.revision === snapshot.challenge.revision
      ) {
        clearChallenge();
        turnstileWidgetRef.current?.reset();
      }
      submitPendingRef.current = false;
      if (request.isCurrent()) setIsPending(false);
      request.finish();
    }
  }

  function handleSubmit() {
    if (submitPendingRef.current) return;
    if (!currentUser) {
      router.push("/login");
      return;
    }
    setError(null);
    if (needsTurnstile && !challengeRef.current.token) {
      setError("请先完成人机验证");
      return;
    }
    if (prompt.trim().length < 2) {
      setError("提示词至少 2 个字符");
      return;
    }
    const customResult = providerMode === "custom"
      ? getCustomProviderSubmitPayload()
      : { payload: null };
    if (customResult.error) {
      setError(customResult.error);
      return;
    }

    const alignedSize = sizeState.alignMultiple16 ? applyDimensionAlignment(sizeState) : sizeState;
    if (alignedSize !== sizeState) setSizeState(alignedSize);

    const autoGenerationType = referenceImages.length > 0 ? "image_to_image" : "text_to_image";
    const snapshot: GenerateSnapshot = {
      challenge: { ...challengeRef.current },
      needsTurnstile,
      count,
      customProvider: customResult.payload,
      generationType: autoGenerationType,
      model: activeModel,
      moderation,
      negativePrompt,
      outputCompression,
      outputFormat,
      prompt: prompt.trim(),
      providerMode,
      quality,
      referenceImages: referenceImages.map((image) => ({ ...image })),
      customProviderBaseUrl: customProvider.baseUrl.trim(),
      customProviderLabel: customProvider.label.trim() || "我的 API",
      customProviderModels: [...customProvider.models],
      customProviderRemember: customProvider.remember,
      selectedChannelId,
      size: alignedSize.size,
    };

    void submitSnapshot(snapshot);
  }

  function handleRetryGeneration(target: GenerationItem) {
    if (target.status === "pending" || submitPendingRef.current) return;
    if (!currentUser) {
      router.push("/login");
      return;
    }
    setError(null);
    if (needsTurnstile && !challengeRef.current.token) {
      setError("请先完成人机验证");
      return;
    }
    const customResult = providerMode === "custom"
      ? getCustomProviderSubmitPayload()
      : { payload: null };
    if (customResult.error) {
      setError(customResult.error);
      return;
    }

    const config = toReusableGenerationConfig(target, channels.map((ch) => ch.id));
    const availableSources = getGenerationSourceImageUrls(target);
    const retryGenerationType = availableSources.length > 0 ? "image_to_image" : "text_to_image";
    const retryChannelId = config.channelId ?? selectedChannelId;
    const retryChannel = channels.find((ch) => ch.id === retryChannelId) ?? selectedChannel;
    const retryModel = providerMode === "custom"
      ? customProvider.model
      : retryChannel && retryChannel.models.includes(config.model)
        ? config.model
        : activeModel;

    const snapshot: GenerateSnapshot = {
      challenge: { ...challengeRef.current },
      needsTurnstile,
      count: config.count,
      customProvider: customResult.payload,
      generationType: retryGenerationType,
      model: retryModel,
      moderation: config.moderation,
      negativePrompt: config.negativePrompt,
      outputCompression: config.outputCompression,
      outputFormat: config.outputFormat,
      prompt: config.prompt,
      providerMode,
      quality: config.quality,
      referenceImages: availableSources.map((url, index) => ({
        id: `retry_${index}_${url}`,
        file: null,
        previewUrl: url,
        sourceUrl: url,
      })),
      customProviderBaseUrl: customProvider.baseUrl.trim(),
      customProviderLabel: customProvider.label.trim() || "我的 API",
      customProviderModels: [...customProvider.models],
      customProviderRemember: customProvider.remember,
      selectedChannelId: retryChannelId,
      size: config.size,
    };

    void submitSnapshot(snapshot);
  }

  async function handleCancelGeneration(target: GenerationItem) {
    if (target.status !== "pending") return;
    const request = beginRequest();
    if (!request) return;
    try {
      const response = await fetch(`/api/me/generations/${target.id}`, {
        method: "DELETE",
        signal: request.controller.signal,
      });
      if (!request.isCurrent()) return;
      const result = (await response.json().catch(() => null)) as {
        data?: { generation?: unknown };
        error?: unknown;
      } | null;
      if (!request.isCurrent()) return;
      if (!response.ok) {
        setError(typeof result?.error === "string" && result.error ? result.error : "取消生成失败，请稍后再试");
        return;
      }
      const updated = result?.data?.generation;
      if (!isGenerationItem(updated) || updated.id !== target.id) {
        setError("服务端返回的任务状态不正确，请稍后再试");
        return;
      }
      updateJob(updated);
      router.refresh();
    } catch {
      if (request.isCurrent()) setError("取消生成失败，请稍后再试");
    } finally {
      request.finish();
    }
  }

  function handleReuseConfig(generation: GenerationItem) {
    const config = toReusableGenerationConfig(generation, channels.map((ch) => ch.id));
    const targetChannel = config.channelId
      ? channels.find((ch) => ch.id === config.channelId) ?? null
      : selectedChannel;
    const nextChannelId = targetChannel?.id ?? selectedChannelId ?? channels[0]?.id ?? null;
    const nextModels = targetChannel?.models ?? selectedChannel?.models ?? [];
    const nextModel = nextModels.length === 0 || nextModels.includes(config.model)
      ? config.model
      : targetChannel?.defaultModel ?? selectedChannel?.defaultModel ?? config.model;

    setPrompt(config.prompt);
    setNegativePrompt(config.negativePrompt);
    setCount(config.count);
    setSizeState(deriveSizeControlState(config.size, sizeState.alignMultiple16));
    setQuality(config.quality);
    setOutputFormat(config.outputFormat);
    setOutputCompression(config.outputCompression);
    setModeration(config.moderation);
    setModel(nextModel);
    if (nextChannelId) setSelectedChannelId(nextChannelId);
    clearReferenceImages();
    setReferenceImages(() =>
      config.sourceImageUrls.map((url, index) => ({
        file: null,
        id: `${Date.now()}_reuse_${index}_${Math.random().toString(36).slice(2, 8)}`,
        previewUrl: url,
        sourceUrl: url,
      })),
    );
    setError(null);
    if (generation.generationType === "image_to_image" && config.sourceImageUrls.length === 0) {
      setClipboardNotice("原记录的参考图已清理或不可用，已为你回填提示词与其余参数");
    } else {
      setClipboardNotice(null);
    }
    setMobileTab("workbench");
    requestAnimationFrame(() => promptTextareaRef.current?.focus());
  }

  function handleNewDraft() {
    setPrompt("");
    setNegativePrompt("");
    clearReferenceImages();
    setError(null);
    setClipboardNotice(null);
    setHistoryDrawerOpen(false);
    setMobileTab("workbench");
    requestAnimationFrame(() => promptTextareaRef.current?.focus());
  }

  function handleSelectRecord(id: string) {
    selectRecord(id);
    setHistoryDrawerOpen(false);
    setMobileTab("result");
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
      const anchor = document.createElement("a");
      const pathname = new URL(url, window.location.href).pathname;
      const nameFromUrl = pathname.split("/").filter(Boolean).pop();
      anchor.href = blobUrl;
      anchor.download = nameFromUrl && nameFromUrl.includes(".") ? nameFromUrl : "narra-image.png";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
    } catch {
      if (request.isCurrent()) window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      request.finish();
    }
  }

  function handleZoomImage(
    url: string,
    meta?: { dimensionLabel?: string; ratioLabel?: string; recordId?: string; imageId?: string },
  ) {
    setZoomState({
      url,
      meta: meta ? { dimensionLabel: meta.dimensionLabel, ratioLabel: meta.ratioLabel } : undefined,
      recordId: meta?.recordId,
      imageId: meta?.imageId,
    });
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

  const pendingCount = records.filter((item) => item.status === "pending").length;

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[linear-gradient(180deg,#faf6ef_0%,#f2e9dc_100%)]">
      {canvasEnabled && <StudioModeSwitch mode={mode} onChange={handleModeChange} />}

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {mode === "canvas" ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {canvasViewer.error && <Alert onDismiss={canvasViewer.dismissError}>{canvasViewer.error}</Alert>}
            <CanvasLazyPane
              snapshot={canvasSnapshot}
              controller={canvasController}
              channels={channels}
              editor={canvasEditor}
              touchPresentation={touchPresentation}
              onViewImage={canvasViewer.open}
              onDownloadImage={(target) => { void canvasViewer.download(target, handleDownload); }}
              onOpenProviderSettings={openCanvasProviderSettings}
              onReturnToChat={() => handleModeChange("conversation")}
            />
            <ImageZoomModal
              src={canvasViewer.image?.src ?? null}
              meta={canvasViewer.image?.meta}
              onClose={canvasViewer.close}
              onDownload={() => { void canvasViewer.downloadCurrent(handleDownload); }}
            />
            {canvasRuntime.dialog && (
              <CanvasRuntimeDialog
                key={canvasRuntime.dialog.id}
                {...canvasRuntime}
                dialog={canvasRuntime.dialog}
              />
            )}
          </div>
        ) : (
          <div className="flex h-full min-h-0 w-full flex-col overflow-hidden lg:flex-row">
            {/* 平板/手机顶部切换栏 */}
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--line)]/80 bg-[#fffaf2]/90 px-3 py-2 backdrop-blur-md lg:hidden">
              <button
                type="button"
                aria-label="打开生成记录"
                onClick={() => setHistoryDrawerOpen(true)}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-[var(--line)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[var(--ink)] shadow-2xs"
              >
                <History aria-hidden className="size-3.5 text-[var(--accent)]" />
                记录 ({records.length})
              </button>

              <div role="tablist" aria-label="工作台视图" className="inline-flex rounded-xl border border-[var(--line)] bg-[#f4ebde] p-0.5">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mobileTab === "workbench"}
                  onClick={() => setMobileTab("workbench")}
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-1 rounded-lg px-3 py-1 text-xs font-semibold transition",
                    mobileTab === "workbench" ? "bg-white text-[var(--ink)] shadow-2xs" : "text-[var(--ink-soft)]",
                  )}
                >
                  <SlidersHorizontal aria-hidden className="size-3.5" />
                  工作台
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mobileTab === "result"}
                  onClick={() => setMobileTab("result")}
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-1 rounded-lg px-3 py-1 text-xs font-semibold transition",
                    mobileTab === "result" ? "bg-white text-[var(--ink)] shadow-2xs" : "text-[var(--ink-soft)]",
                  )}
                >
                  <ImageIcon aria-hidden className="size-3.5" />
                  结果
                  {pendingCount > 0 && (
                    <span className="size-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
                  )}
                </button>
              </div>
            </div>

            {/* 左栏：生成记录 */}
            <WorkbenchHistoryRail
              records={records}
              selectedId={selectedId}
              checkedIds={checkedIds}
              allChecked={allChecked}
              hasMore={hasMore}
              loadingMore={loadingMore}
              loadError={loadError}
              hiding={hiding}
              notice={historyNotice}
              open={historyDrawerOpen}
              onClose={() => setHistoryDrawerOpen(false)}
              onNewDraft={handleNewDraft}
              onSelectRecord={handleSelectRecord}
              onToggleCheck={toggleCheck}
              onToggleSelectAll={toggleSelectAll}
              onDeleteSelected={() => { void hideRecords([...checkedIds]); }}
              onDeleteSingle={(id) => { void hideRecords([id]); }}
              onLoadMore={() => { void loadMore(); }}
              onDismissNotice={dismissHistoryNotice}
            />

            {/* 中栏：生图工作台 */}
            <WorkbenchComposer
              ref={promptTextareaRef}
              className={cn(mobileTab === "workbench" ? "flex" : "hidden lg:flex")}
              prompt={prompt}
              onChangePrompt={setPrompt}
              onPaste={handlePaste}
              onKeyDownSubmit={handleSubmit}
              referenceImages={referenceImages}
              onPickFiles={handleReferenceFiles}
              onPickImageUrl={handleAddToReference}
              onReadClipboard={() => { void handleReadClipboard(); }}
              clipboardNotice={clipboardNotice}
              onDismissClipboardNotice={() => setClipboardNotice(null)}
              onRemoveReference={removeImage}
              onMoveReference={moveImage}
              onReorderReference={reorderImage}
              onClearReferences={clearReferenceImages}
              onOpenPromptLibrary={() => setPromptPickerOpen(true)}
              onOpenMyWorks={() => setWorksPickerOpen(true)}
              providerMode={providerMode}
              onChangeProviderMode={setProviderMode}
              channels={channels}
              selectedChannelId={selectedChannelId}
              onChangeChannel={handleChannelChange}
              modelOptions={modelOptions}
              model={model}
              onChangeModel={setModel}
              customProvider={customProvider}
              onChangeCustomProvider={handleChangeCustomProvider}
              customModelOptions={customModelOptions}
              savedProviderConfigured={savedProviderConfigured}
              onProbeCustomProviderModels={() => { void handleProbeCustomProviderModels(); }}
              customProviderProbePending={customProviderProbePending}
              customProviderProbeMessage={customProviderProbeMessage}
              quality={quality}
              onChangeQuality={setQuality}
              sizeState={sizeState}
              onChangeResolution={(tier: ResolutionOptionValue) => setSizeState((current) => selectResolutionTier(current, tier))}
              onChangeAspectRatio={(ratio: AspectRatioPreset) => setSizeState((current) => selectAspectRatio(current, ratio))}
              onChangeDimensions={(w, h) => setSizeState((current) => updateDimensionInputs(current, w, h))}
              onBlurDimensions={() => setSizeState((current) => applyDimensionAlignment(current))}
              onSwapDimensions={() => setSizeState((current) => swapDimensions(current))}
              onToggleAlignMultiple16={(enabled) => setSizeState((current) => toggleAlignMultiple16(current, enabled))}
              count={count}
              onChangeCount={setCount}
              unitCreditCost={unitCreditCost}
              totalCreditCost={totalCreditCost}
              outputFormat={outputFormat}
              onChangeOutputFormat={setOutputFormat}
              outputCompression={outputCompression}
              onChangeOutputCompression={setOutputCompression}
              moderation={moderation}
              onChangeModeration={setModeration}
              negativePrompt={negativePrompt}
              onChangeNegativePrompt={setNegativePrompt}
              isPending={isPending}
              canSubmit={Boolean(prompt.trim() && (!needsTurnstile || turnstileToken))}
              error={error}
              onDismissError={() => setError(null)}
              onSubmit={handleSubmit}
              turnstileSlot={
                needsTurnstile && turnstile?.siteKey ? (
                  <TurnstileWidget
                    ref={turnstileWidgetRef}
                    siteKey={turnstile.siteKey}
                    onVerify={updateChallenge}
                    onExpire={clearChallenge}
                    onError={clearChallenge}
                  />
                ) : undefined
              }
            />

            {/* 右栏：生成结果 */}
            <WorkbenchResultStage
              className={cn(mobileTab === "result" ? "flex" : "hidden lg:flex")}
              record={selectedRecord}
              onZoom={handleZoomImage}
              onDownload={(url) => { void handleDownload(url); }}
              onAddToReference={handleAddToReference}
              onReuseConfig={handleReuseConfig}
              onRetry={handleRetryGeneration}
              onCancel={(target) => { void handleCancelGeneration(target); }}
            />

            <ImageZoomModal
              src={activeZoom?.src ?? null}
              meta={activeZoom?.meta}
              onClose={() => setZoomState(null)}
              onDownload={(url) => { void handleDownload(url); }}
              onUseForEdit={handleAddToReference}
            />

            <PromptPickerModal
              open={promptPickerOpen}
              onClose={() => setPromptPickerOpen(false)}
              onPickPrompt={(text) => {
                setPrompt(text);
                requestAnimationFrame(() => promptTextareaRef.current?.focus());
              }}
            />

            <WorksPickerModal
              open={worksPickerOpen}
              onClose={() => setWorksPickerOpen(false)}
              onAddReference={handleAddToReference}
              onPickPrompt={(text) => {
                setPrompt(text);
                requestAnimationFrame(() => promptTextareaRef.current?.focus());
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
