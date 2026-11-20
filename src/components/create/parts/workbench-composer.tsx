"use client";

/* eslint-disable @next/next/no-img-element */

// 中栏「生图工作台」参数面板：常驻提示词、参考图拖放/剪切板、模型与渠道、质量、尺寸/分辨率/比例、张数与更多设置。
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronDown,
  ClipboardPaste,
  GripVertical,
  ImagePlus,
  Images,
  SlidersHorizontal,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import {
  forwardRef,
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type ReactNode,
} from "react";

import { Alert } from "@/components/ui/alert";
import { GENERATION_PROMPT_MAX_LENGTH } from "@/lib/generation/limits";
import type {
  GenerationModeration,
  GenerationOutputFormat,
  GenerationQuality,
} from "@/lib/types";
import { cn } from "@/lib/utils";

import {
  HISTORY_IMAGE_DRAG_MIME,
  MAX_REFERENCE_IMAGES,
  MODERATION_OPTIONS,
  OUTPUT_FORMAT_OPTIONS,
  QUALITY_OPTIONS,
} from "../constants";
import type {
  AspectRatioPreset,
  ResolutionOptionValue,
  SizeControlState,
} from "../size-controls";
import type {
  ChannelInfo,
  CustomProviderDraft,
  ProviderSelectionMode,
  ReferenceImage,
} from "../types";
import { WorkbenchSizePanel } from "./workbench-size-panel";

type WorkbenchComposerProps = {
  prompt: string;
  onChangePrompt: (value: string) => void;
  onPaste: (event: ClipboardEvent) => void;
  onKeyDownSubmit: () => void;

  referenceImages: ReferenceImage[];
  onPickFiles: (files: File[] | FileList | null) => void;
  onPickImageUrl: (url: string) => void;
  onReadClipboard: () => void;
  clipboardNotice: string | null;
  onDismissClipboardNotice: () => void;
  onRemoveReference: (id: string) => void;
  onMoveReference: (id: string, direction: -1 | 1) => void;
  onReorderReference: (sourceId: string, targetId: string) => void;
  onClearReferences: () => void;

  onOpenPromptLibrary: () => void;
  onOpenMyWorks: () => void;

  providerMode: ProviderSelectionMode;
  onChangeProviderMode: (mode: ProviderSelectionMode) => void;
  channels: ChannelInfo[];
  selectedChannelId: string | null;
  onChangeChannel: (channelId: string) => void;
  modelOptions: string[];
  model: string;
  onChangeModel: (model: string) => void;
  customProvider: CustomProviderDraft;
  onChangeCustomProvider: (provider: CustomProviderDraft) => void;
  customModelOptions: string[];
  savedProviderConfigured: boolean;
  onProbeCustomProviderModels: () => void;
  customProviderProbePending: boolean;
  customProviderProbeMessage: string | null;

  quality: GenerationQuality;
  onChangeQuality: (quality: GenerationQuality) => void;

  sizeState: SizeControlState;
  onChangeResolution: (tier: ResolutionOptionValue) => void;
  onChangeAspectRatio: (ratio: AspectRatioPreset) => void;
  onChangeDimensions: (width: string, height: string) => void;
  onBlurDimensions: () => void;
  onSwapDimensions: () => void;
  onToggleAlignMultiple16: (enabled: boolean) => void;

  count: number;
  onChangeCount: (count: number) => void;
  unitCreditCost: number | null;
  totalCreditCost: number;

  outputFormat: GenerationOutputFormat;
  onChangeOutputFormat: (format: GenerationOutputFormat) => void;
  outputCompression: number;
  onChangeOutputCompression: (value: number) => void;
  moderation: GenerationModeration;
  onChangeModeration: (value: GenerationModeration) => void;
  negativePrompt: string;
  onChangeNegativePrompt: (value: string) => void;

  isPending: boolean;
  canSubmit: boolean;
  error: string | null;
  onDismissError: () => void;
  onSubmit: () => void;
  turnstileSlot?: ReactNode;
  className?: string;
};

const COUNT_OPTIONS = [1, 2, 3, 4] as const;

export const WorkbenchComposer = forwardRef<HTMLTextAreaElement, WorkbenchComposerProps>(
  function WorkbenchComposer(props, ref) {
    const {
      prompt,
      onChangePrompt,
      onPaste,
      onKeyDownSubmit,
      referenceImages,
      onPickFiles,
      onPickImageUrl,
      onReadClipboard,
      clipboardNotice,
      onDismissClipboardNotice,
      onRemoveReference,
      onMoveReference,
      onReorderReference,
      onClearReferences,
      onOpenPromptLibrary,
      onOpenMyWorks,
      providerMode,
      onChangeProviderMode,
      channels,
      selectedChannelId,
      onChangeChannel,
      modelOptions,
      model,
      onChangeModel,
      customProvider,
      onChangeCustomProvider,
      customModelOptions,
      savedProviderConfigured,
      onProbeCustomProviderModels,
      customProviderProbePending,
      customProviderProbeMessage,
      quality,
      onChangeQuality,
      sizeState,
      onChangeResolution,
      onChangeAspectRatio,
      onChangeDimensions,
      onBlurDimensions,
      onSwapDimensions,
      onToggleAlignMultiple16,
      count,
      onChangeCount,
      unitCreditCost,
      totalCreditCost,
      outputFormat,
      onChangeOutputFormat,
      outputCompression,
      onChangeOutputCompression,
      moderation,
      onChangeModeration,
      negativePrompt,
      onChangeNegativePrompt,
      isPending,
      canSubmit,
      error,
      onDismissError,
      onSubmit,
      turnstileSlot,
      className,
    } = props;

    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const draggedRefId = useRef<string | null>(null);
    const dragDepthRef = useRef(0);
    const isComposingRef = useRef(false);
    const [dragActive, setDragActive] = useState(false);
    const [moreOpen, setMoreOpen] = useState(false);
    const customModelDatalistId = useId();
    const isImageToImage = referenceImages.length > 0;

    function hasDraggedFiles(event: DragEvent) {
      return Array.from(event.dataTransfer.types).includes("Files");
    }

    function hasDraggedImageUrl(event: DragEvent) {
      const types = Array.from(event.dataTransfer.types);
      return types.includes(HISTORY_IMAGE_DRAG_MIME) || types.includes("text/uri-list");
    }

    function getDraggedImageUrl(event: DragEvent) {
      const internalUrl = event.dataTransfer.getData(HISTORY_IMAGE_DRAG_MIME).trim();
      if (internalUrl) return internalUrl;
      const uriList = event.dataTransfer.getData("text/uri-list");
      return uriList
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line && !line.startsWith("#")) ?? "";
    }

    function canAcceptDrop(event: DragEvent) {
      return hasDraggedFiles(event) || hasDraggedImageUrl(event);
    }

    function handleDragEnter(event: DragEvent<HTMLDivElement>) {
      if (!canAcceptDrop(event)) return;
      event.preventDefault();
      dragDepthRef.current += 1;
      setDragActive(true);
    }

    function handleDragOver(event: DragEvent<HTMLDivElement>) {
      if (!canAcceptDrop(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setDragActive(true);
    }

    function handleDragLeave(event: DragEvent<HTMLDivElement>) {
      if (!canAcceptDrop(event)) return;
      event.preventDefault();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setDragActive(false);
    }

    function handleDrop(event: DragEvent<HTMLDivElement>) {
      if (!canAcceptDrop(event)) return;
      event.preventDefault();
      dragDepthRef.current = 0;
      setDragActive(false);
      if (hasDraggedFiles(event)) {
        onPickFiles(event.dataTransfer.files);
        return;
      }
      const imageUrl = getDraggedImageUrl(event);
      if (imageUrl) onPickImageUrl(imageUrl);
    }

    return (
      <section
        aria-label="生图工作台"
        onPaste={onPaste}
        className={cn(
          "flex min-h-0 w-full flex-1 flex-col bg-[#fffcf7]/84 lg:h-full lg:w-[376px] lg:flex-none lg:shrink-0 lg:border-r lg:border-[var(--line)] xl:w-[416px]",
          className,
        )}
      >
        {/* 顶栏 */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--line)]/70 px-4 py-3">
          <h1 className="text-base font-semibold tracking-tight text-[var(--ink)]">生图工作台</h1>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
              isImageToImage
                ? "border-[#e4a685] bg-[#fff2e6] text-[#b54722]"
                : "border-[var(--line)] bg-[#f5ede0] text-[var(--ink-soft)]",
            )}
          >
            {isImageToImage ? `图生图 · ${referenceImages.length} 张参考图` : "文生图"}
          </span>
        </div>

        {/* 滚动参数体 */}
        <div className="premium-scrollbar flex-1 space-y-5 overflow-y-auto px-4 py-4">
          {/* 1. 提示词 */}
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label htmlFor="workbench-prompt-input" className="text-xs font-semibold text-[var(--ink)]">
                提示词
              </label>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onOpenPromptLibrary}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-[var(--line)] bg-[#fffaf2] px-2 py-1 text-[11px] font-medium text-[var(--ink-soft)] transition hover:border-[var(--accent)] hover:bg-white hover:text-[var(--accent)]"
                >
                  <BookOpen aria-hidden className="size-3" />
                  提示词库
                </button>
                <button
                  type="button"
                  onClick={onOpenMyWorks}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-[var(--line)] bg-[#fffaf2] px-2 py-1 text-[11px] font-medium text-[var(--ink-soft)] transition hover:border-[var(--accent)] hover:bg-white hover:text-[var(--accent)]"
                >
                  <Images aria-hidden className="size-3" />
                  我的作品
                </button>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white/90 shadow-2xs transition focus-within:border-[var(--accent)] focus-within:ring-2 focus-within:ring-[var(--accent)]/12">
              <textarea
                id="workbench-prompt-input"
                ref={ref}
                value={prompt}
                maxLength={GENERATION_PROMPT_MAX_LENGTH}
                onChange={(event) => onChangePrompt(event.target.value)}
                onCompositionStart={() => { isComposingRef.current = true; }}
                onCompositionEnd={() => { isComposingRef.current = false; }}
                onKeyDown={(event) => {
                  const composing = isComposingRef.current || event.nativeEvent.isComposing;
                  if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !composing) {
                    event.preventDefault();
                    if (canSubmit && !isPending) onKeyDownSubmit();
                  }
                }}
                placeholder={
                  isImageToImage
                    ? "描述你希望如何基于参考图编辑或融合画面…"
                    : "描述你想生成的画面主体、光影、材质、构图与氛围…"
                }
                rows={4}
                className="premium-scrollbar block min-h-[104px] max-h-[210px] w-full resize-y bg-transparent px-3.5 py-2.5 text-sm leading-6 text-[var(--ink)] outline-none placeholder:text-[var(--ink-soft)]/60"
              />
              <div className="flex items-center justify-between border-t border-[var(--line)]/50 bg-[#fbf6ee]/60 px-3 py-1.5 text-[11px] text-[var(--ink-soft)]/80">
                <span>Ctrl + Enter 快速生成</span>
                <span className="tabular-nums">
                  {prompt.length} / {GENERATION_PROMPT_MAX_LENGTH}
                </span>
              </div>
            </div>
          </div>

          {/* 2. 参考图 */}
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-[var(--ink)]">参考图</span>
                <span className="text-[11px] tabular-nums text-[var(--ink-soft)]">
                  {referenceImages.length}/{MAX_REFERENCE_IMAGES}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    onPickFiles(event.target.files);
                    event.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={onReadClipboard}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-[var(--line)] bg-[#fffaf2] px-2 py-1 text-[11px] font-medium text-[var(--ink-soft)] transition hover:border-[var(--accent)] hover:bg-white hover:text-[var(--accent)]"
                >
                  <ClipboardPaste aria-hidden className="size-3" />
                  剪切板
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-[var(--line)] bg-[#fffaf2] px-2 py-1 text-[11px] font-medium text-[var(--ink-soft)] transition hover:border-[var(--accent)] hover:bg-white hover:text-[var(--accent)]"
                >
                  <Upload aria-hidden className="size-3" />
                  上传
                </button>
                {referenceImages.length > 0 && (
                  <button
                    type="button"
                    onClick={onClearReferences}
                    className="inline-flex cursor-pointer items-center rounded-lg border border-[var(--line)] bg-white/70 px-2 py-1 text-[11px] font-medium text-[var(--ink-soft)] transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600"
                  >
                    清空
                  </button>
                )}
              </div>
            </div>

            {clipboardNotice && (
              <div className="mb-2">
                <Alert variant="info" onDismiss={onDismissClipboardNotice} className="px-3 py-2 text-xs">
                  {clipboardNotice}
                </Alert>
              </div>
            )}

            <div
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              className={cn(
                "relative rounded-2xl border border-dashed p-3 transition",
                dragActive
                  ? "border-[var(--accent)] bg-[#fff3e7] ring-2 ring-[var(--accent)]/15"
                  : "border-[var(--line)] bg-[#faf3e8]/65",
              )}
            >
              {dragActive && (
                <div className="pointer-events-none absolute inset-1.5 z-20 flex items-center justify-center rounded-xl bg-[#fffaf2]/90 text-xs font-semibold text-[var(--accent)] backdrop-blur-xs">
                  松开图片即可加入参考图
                </div>
              )}

              {referenceImages.length === 0 ? (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex w-full cursor-pointer flex-col items-center justify-center gap-1.5 py-4 text-center text-xs text-[var(--ink-soft)] transition hover:text-[var(--ink)]"
                >
                  <ImagePlus aria-hidden className="size-5 text-[var(--ink-soft)]/55" />
                  <span>暂无参考图，可拖拽、粘贴或点击上传</span>
                  <span className="text-[11px] text-[var(--ink-soft)]/70">
                    放入参考图后将自动以图生图方式生成
                  </span>
                </button>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {referenceImages.map((referenceImage, index) => (
                    <div
                      key={referenceImage.id}
                      draggable
                      onDragStart={(event) => {
                        draggedRefId.current = referenceImage.id;
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", referenceImage.id);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        const sourceId = event.dataTransfer.getData("text/plain") || draggedRefId.current;
                        draggedRefId.current = null;
                        if (sourceId) onReorderReference(sourceId, referenceImage.id);
                      }}
                      onDragEnd={() => { draggedRefId.current = null; }}
                      className="group relative aspect-square overflow-hidden rounded-xl border border-[var(--line)] bg-white shadow-2xs"
                    >
                      <img
                        src={referenceImage.previewUrl}
                        alt={`参考图 ${index + 1}`}
                        className="size-full object-cover"
                      />
                      <span className="absolute left-1 top-1 inline-flex items-center gap-0.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                        <GripVertical aria-hidden className="size-2.5" />
                        {index + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => onRemoveReference(referenceImage.id)}
                        aria-label={`移除参考图 ${index + 1}`}
                        className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white transition hover:bg-rose-500"
                      >
                        <X aria-hidden className="size-3" />
                      </button>
                      <div className="absolute inset-x-1 bottom-1 flex justify-between opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() => onMoveReference(referenceImage.id, -1)}
                          aria-label={`参考图 ${index + 1} 前移`}
                          className="rounded-full bg-black/60 p-0.5 text-white transition hover:bg-[var(--accent)] disabled:opacity-30"
                        >
                          <ArrowLeft aria-hidden className="size-3" />
                        </button>
                        <button
                          type="button"
                          disabled={index === referenceImages.length - 1}
                          onClick={() => onMoveReference(referenceImage.id, 1)}
                          aria-label={`参考图 ${index + 1} 后移`}
                          className="rounded-full bg-black/60 p-0.5 text-white transition hover:bg-[var(--accent)] disabled:opacity-30"
                        >
                          <ArrowRight aria-hidden className="size-3" />
                        </button>
                      </div>
                    </div>
                  ))}

                  {referenceImages.length < MAX_REFERENCE_IMAGES && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      aria-label="继续添加参考图"
                      className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-[var(--line)] bg-white/60 text-[11px] font-medium text-[var(--ink-soft)] transition hover:border-[var(--accent)] hover:bg-white hover:text-[var(--accent)]"
                    >
                      <ImagePlus aria-hidden className="size-4" />
                      添加
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 3. 模型与渠道 */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[var(--ink)]">模型与渠道</span>
              <div
                role="group"
                aria-label="渠道来源"
                className="inline-flex rounded-xl border border-[var(--line)] bg-[#f4ebde] p-0.5"
              >
                <button
                  type="button"
                  aria-pressed={providerMode === "built_in"}
                  onClick={() => onChangeProviderMode("built_in")}
                  className={cn(
                    "cursor-pointer rounded-lg px-2.5 py-1 text-[11px] font-semibold transition",
                    providerMode === "built_in"
                      ? "bg-white text-[var(--ink)] shadow-2xs"
                      : "text-[var(--ink-soft)] hover:text-[var(--ink)]",
                  )}
                >
                  平台渠道
                </button>
                <button
                  type="button"
                  aria-pressed={providerMode === "custom"}
                  onClick={() => onChangeProviderMode("custom")}
                  className={cn(
                    "cursor-pointer rounded-lg px-2.5 py-1 text-[11px] font-semibold transition",
                    providerMode === "custom"
                      ? "bg-white text-[var(--ink)] shadow-2xs"
                      : "text-[var(--ink-soft)] hover:text-[var(--ink)]",
                  )}
                >
                  自填 API
                </button>
              </div>
            </div>

            {providerMode === "built_in" ? (
              <div className={cn("grid gap-2", channels.length > 1 ? "grid-cols-[minmax(0,2fr)_minmax(0,3fr)]" : "grid-cols-1")}>
                {channels.length > 1 && (
                  <select
                    aria-label="渠道"
                    value={selectedChannelId ?? ""}
                    onChange={(event) => onChangeChannel(event.target.value)}
                    className="w-full cursor-pointer rounded-xl border border-[var(--line)] bg-white/85 px-3 py-2 text-xs font-semibold text-[var(--ink)] shadow-2xs outline-none focus:border-[var(--accent)]"
                  >
                    {channels.map((ch) => (
                      <option key={ch.id} value={ch.id}>{ch.name}</option>
                    ))}
                  </select>
                )}
                <select
                  aria-label="模型"
                  value={model}
                  onChange={(event) => onChangeModel(event.target.value)}
                  className="w-full cursor-pointer rounded-xl border border-[var(--line)] bg-white/85 px-3 py-2 text-sm font-medium text-[var(--ink)] shadow-2xs outline-none focus:border-[var(--accent)]"
                >
                  {modelOptions.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="space-y-2.5 rounded-2xl border border-[var(--line)] bg-[#faf4ea]/75 p-3">
                <p className="text-[11px] leading-relaxed text-[var(--ink-soft)]">
                  使用你自己的第三方 OpenAI 兼容渠道；本站不扣生成积分。
                </p>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <label className="sm:col-span-2">
                    <span className="mb-1 block text-[11px] font-medium text-[var(--ink-soft)]">Base URL</span>
                    <input
                      aria-label="第三方 Base URL"
                      value={customProvider.baseUrl}
                      onChange={(event) => onChangeCustomProvider({ ...customProvider, baseUrl: event.target.value })}
                      placeholder="https://api.example.com/v1"
                      className="w-full rounded-xl border border-[var(--line)] bg-white/90 px-3 py-2 text-xs text-[var(--ink)] outline-none focus:border-[var(--accent)]"
                    />
                  </label>
                  <label className="sm:col-span-2">
                    <span className="mb-1 block text-[11px] font-medium text-[var(--ink-soft)]">API Key</span>
                    <input
                      aria-label="第三方 API Key"
                      type="password"
                      autoComplete="off"
                      value={customProvider.apiKey}
                      onChange={(event) => onChangeCustomProvider({ ...customProvider, apiKey: event.target.value })}
                      placeholder={savedProviderConfigured ? "已保存，可留空继续使用" : "sk-..."}
                      className="w-full rounded-xl border border-[var(--line)] bg-white/90 px-3 py-2 text-xs text-[var(--ink)] outline-none focus:border-[var(--accent)]"
                    />
                  </label>
                  <label>
                    <span className="mb-1 block text-[11px] font-medium text-[var(--ink-soft)]">模型</span>
                    <input
                      aria-label="第三方模型"
                      list={customModelOptions.length > 0 ? customModelDatalistId : undefined}
                      value={customProvider.model}
                      onChange={(event) => onChangeCustomProvider({ ...customProvider, model: event.target.value })}
                      placeholder="gpt-image-1"
                      className="w-full rounded-xl border border-[var(--line)] bg-white/90 px-3 py-2 text-xs text-[var(--ink)] outline-none focus:border-[var(--accent)]"
                    />
                    {customModelOptions.length > 0 && (
                      <datalist id={customModelDatalistId}>
                        {customModelOptions.map((item) => (
                          <option key={item} value={item} />
                        ))}
                      </datalist>
                    )}
                  </label>
                  <label>
                    <span className="mb-1 block text-[11px] font-medium text-[var(--ink-soft)]">配置名称</span>
                    <input
                      aria-label="第三方配置名称"
                      value={customProvider.label}
                      onChange={(event) => onChangeCustomProvider({ ...customProvider, label: event.target.value })}
                      placeholder="我的 API"
                      className="w-full rounded-xl border border-[var(--line)] bg-white/90 px-3 py-2 text-xs text-[var(--ink)] outline-none focus:border-[var(--accent)]"
                    />
                  </label>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-[var(--ink-soft)]">
                    <input
                      aria-label="记住第三方 API 配置"
                      type="checkbox"
                      checked={customProvider.remember}
                      onChange={(event) => onChangeCustomProvider({ ...customProvider, remember: event.target.checked })}
                      className="size-3.5 rounded border-[var(--line)] accent-[var(--accent)]"
                    />
                    记住配置
                  </label>
                  <button
                    type="button"
                    disabled={customProviderProbePending}
                    onClick={onProbeCustomProviderModels}
                    className="cursor-pointer rounded-lg border border-[var(--line)] bg-white px-2.5 py-1 text-[11px] font-semibold text-[var(--ink)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
                  >
                    {customProviderProbePending ? "拉取中..." : "拉取模型"}
                  </button>
                </div>

                {customProviderProbeMessage && (
                  <p role="status" className="text-[11px] text-[var(--ink-soft)]">
                    {customProviderProbeMessage}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* 4. 质量 */}
          <div>
            <span className="mb-1.5 block text-xs font-semibold text-[var(--ink)]">质量</span>
            <div role="group" aria-label="质量" className="grid grid-cols-4 gap-1.5">
              {QUALITY_OPTIONS.map((option) => {
                const active = quality === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onChangeQuality(option.value)}
                    className={cn(
                      "cursor-pointer rounded-xl border px-2 py-1.5 text-xs font-semibold transition",
                      active
                        ? "border-[var(--accent)] bg-[#fff4e8] text-[var(--accent)] shadow-2xs ring-1 ring-[var(--accent)]/15"
                        : "border-[var(--line)] bg-white/75 text-[var(--ink-soft)] hover:border-[#cfa27a] hover:bg-white hover:text-[var(--ink)]",
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 5. 尺寸 · 分辨率 · 宽高比 */}
          <WorkbenchSizePanel
            value={sizeState}
            onChangeResolution={onChangeResolution}
            onChangeAspectRatio={onChangeAspectRatio}
            onChangeDimensions={onChangeDimensions}
            onBlurDimensions={onBlurDimensions}
            onSwapDimensions={onSwapDimensions}
            onToggleAlignMultiple16={onToggleAlignMultiple16}
          />

          {/* 6. 生成张数 */}
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[var(--ink)]">生成张数</span>
              <span className="text-[11px] text-[var(--ink-soft)]">
                {providerMode === "custom"
                  ? "自填 API 免积分"
                  : unitCreditCost != null
                    ? `按张计费 · ${unitCreditCost} 积分/张`
                    : "文生图与图生图均支持 1–4 张"}
              </span>
            </div>
            <div role="group" aria-label="生成张数" className="grid grid-cols-4 gap-1.5">
              {COUNT_OPTIONS.map((num) => {
                const active = count === num;
                return (
                  <button
                    key={num}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onChangeCount(num)}
                    className={cn(
                      "cursor-pointer rounded-xl border px-2 py-1.5 text-xs font-semibold transition",
                      active
                        ? "border-[var(--accent)] bg-[#fff4e8] text-[var(--accent)] shadow-2xs ring-1 ring-[var(--accent)]/15"
                        : "border-[var(--line)] bg-white/75 text-[var(--ink-soft)] hover:border-[#cfa27a] hover:bg-white hover:text-[var(--ink)]",
                    )}
                  >
                    {num} 张
                  </button>
                );
              })}
            </div>
          </div>

          {/* 7. 更多设置（折叠） */}
          <div className="rounded-2xl border border-[var(--line)]/80 bg-[#faf4ea]/65">
            <button
              type="button"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((current) => !current)}
              className="flex w-full cursor-pointer items-center justify-between px-3.5 py-2.5 text-xs font-semibold text-[var(--ink)] transition hover:text-[var(--accent)]"
            >
              <span className="inline-flex items-center gap-1.5">
                <SlidersHorizontal aria-hidden className="size-3.5 text-[var(--ink-soft)]" />
                更多设置
                <span className="font-normal text-[var(--ink-soft)]">
                  · {outputFormat.toUpperCase()} / 审核{moderation === "low" ? "低限制" : "自动"}
                </span>
              </span>
              <ChevronDown
                aria-hidden
                className={cn("size-4 text-[var(--ink-soft)] transition-transform", moreOpen && "rotate-180")}
              />
            </button>

            {moreOpen && (
              <div className="space-y-3.5 border-t border-[var(--line)]/60 px-3.5 pb-3.5 pt-3">
                <div>
                  <span className="mb-1.5 block text-[11px] font-semibold text-[var(--ink-soft)]">输出格式</span>
                  <div role="group" aria-label="输出格式" className="grid grid-cols-3 gap-1.5">
                    {OUTPUT_FORMAT_OPTIONS.map((option) => {
                      const active = outputFormat === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={active}
                          onClick={() => onChangeOutputFormat(option.value)}
                          className={cn(
                            "cursor-pointer rounded-xl border px-2 py-1.5 text-xs font-semibold transition",
                            active
                              ? "border-[var(--accent)] bg-white text-[var(--accent)]"
                              : "border-[var(--line)] bg-white/60 text-[var(--ink-soft)] hover:text-[var(--ink)]",
                          )}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {outputFormat !== "png" && (
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-semibold text-[var(--ink-soft)]">
                      压缩质量 {outputCompression}%
                    </span>
                    <input
                      aria-label="压缩质量"
                      type="range"
                      min={0}
                      max={100}
                      value={outputCompression}
                      onChange={(event) => onChangeOutputCompression(Number(event.target.value))}
                      className="w-full accent-[var(--accent)]"
                    />
                  </label>
                )}

                <div>
                  <span className="mb-1.5 block text-[11px] font-semibold text-[var(--ink-soft)]">审核策略</span>
                  <div role="group" aria-label="审核策略" className="grid grid-cols-2 gap-1.5">
                    {MODERATION_OPTIONS.map((option) => {
                      const active = moderation === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={active}
                          onClick={() => onChangeModeration(option.value)}
                          className={cn(
                            "cursor-pointer rounded-xl border px-2 py-1.5 text-xs font-semibold transition",
                            active
                              ? "border-[var(--accent)] bg-white text-[var(--accent)]"
                              : "border-[var(--line)] bg-white/60 text-[var(--ink-soft)] hover:text-[var(--ink)]",
                          )}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label htmlFor="workbench-negative-prompt" className="mb-1 block text-[11px] font-semibold text-[var(--ink-soft)]">
                    负向提示词
                  </label>
                  <textarea
                    id="workbench-negative-prompt"
                    value={negativePrompt}
                    onChange={(event) => onChangeNegativePrompt(event.target.value)}
                    placeholder="例如：畸形、低画质、多余手指"
                    rows={2}
                    className="w-full resize-none rounded-xl border border-[var(--line)] bg-white/90 px-3 py-2 text-xs text-[var(--ink)] outline-none focus:border-[var(--accent)]"
                  />
                  {isImageToImage && (
                    <p className="mt-1 text-[11px] text-[var(--ink-soft)]">
                      当前为图生图模式，负向提示词仅在无参考图（文生图）时提交。
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 吸底操作区 */}
        <div className="shrink-0 space-y-2.5 border-t border-[var(--line)]/80 bg-[#fffaf2]/96 px-4 py-3 backdrop-blur-md">
          {turnstileSlot && <div>{turnstileSlot}</div>}
          {error && (
            <Alert variant="error" onDismiss={onDismissError} className="px-3 py-2 text-xs">
              {error}
            </Alert>
          )}
          <button
            type="button"
            onClick={onSubmit}
            disabled={isPending || !canSubmit}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-[#24170f] px-4 py-3 text-sm font-semibold text-white shadow-[0_14px_28px_rgba(36,23,15,0.2)] transition hover:-translate-y-0.5 hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:bg-[#24170f]"
          >
            <Sparkles aria-hidden className={cn("size-4", isPending && "animate-spin")} />
            <span>{isPending ? "正在提交任务..." : "开始生成"}</span>
            <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-medium">
              {providerMode === "custom" ? "免积分" : `${totalCreditCost} 积分`}
            </span>
          </button>
        </div>
      </section>
    );
  },
);
