"use client";

/* eslint-disable @next/next/no-img-element */

// 底部输入悬浮区（Composer）：参考图、错误提示、文本框、模式与尺寸切换、发送、高级设置入口。
import Link from "next/link";
import { ArrowLeft, ArrowRight, Code2, GripVertical, Paperclip, Send, Settings2, Sparkles, X } from "lucide-react";
import { forwardRef, useRef, useState, type DragEvent, type ReactNode, type Ref } from "react";

import { Alert } from "@/components/ui/alert";
import { GENERATION_PROMPT_MAX_LENGTH } from "@/lib/generation/limits";
import type { GenerationSizeToken, GenerationType } from "@/lib/types";

import { SIZE_OPTIONS } from "../constants";
import type { ChannelInfo, ReferenceImage } from "../types";

type ComposerProps = {
  prompt: string;
  onChangePrompt: (value: string) => void;
  onPaste: (e: React.ClipboardEvent) => void;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  onKeyDownEnter: () => void;
  isComposing: () => boolean;

  isPending: boolean;
  error: string | null;
  onDismissError: () => void;

  generationType: GenerationType;
  onChangeGenerationType: (type: GenerationType) => void;

  referenceImages: ReferenceImage[];
  onPickFiles: (files: File[] | FileList | null) => void;
  onRemoveReference: (id: string) => void;
  onMoveReference: (id: string, direction: -1 | 1) => void;
  onReorderReference: (sourceId: string, targetId: string) => void;

  size: GenerationSizeToken | string;
  sizeSelectValue: string;
  onSizeSelect: (value: string) => void;

  showSettings: boolean;
  onToggleSettings: () => void;

  channels: ChannelInfo[];
  selectedChannelId: string | null;
  onChangeChannel: (channelId: string) => void;
  modelOptions: string[];
  model: string;
  onChangeModel: (model: string) => void;

  onSubmit: () => void;

  // 父级根据完整状态判断"可发送"，因此暴露布尔值。
  canSubmit: boolean;

  // 切换到图生图模式时父级可借此触发文件选择。
  onClickImageMode: () => void;

  // 高级设置面板由父组件渲染并通过 children 注入，避免反向耦合。
  children?: ReactNode;

  // 外层悬浮区域 ref 交给父级测量高度，用于同步对话流底部留白。
  shellRef?: Ref<HTMLDivElement>;
};

export const Composer = forwardRef<HTMLTextAreaElement, ComposerProps>(function Composer(props, ref) {
  const {
    prompt,
    onChangePrompt,
    onPaste,
    onCompositionStart,
    onCompositionEnd,
    onKeyDownEnter,
    isComposing,
    isPending,
    error,
    onDismissError,
    generationType,
    onChangeGenerationType,
    referenceImages,
    onPickFiles,
    onRemoveReference,
    onMoveReference,
    onReorderReference,
    sizeSelectValue,
    onSizeSelect,
    showSettings,
    onToggleSettings,
    channels,
    selectedChannelId,
    onChangeChannel,
    modelOptions,
    model,
    onChangeModel,
    onSubmit,
    canSubmit,
    onClickImageMode,
  } = props;

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const draggedReferenceIdRef = useRef<string | null>(null);
  const dragDepthRef = useRef(0);
  const [dragActive, setDragActive] = useState(false);

  function hasDraggedFiles(event: DragEvent) {
    return Array.from(event.dataTransfer.types).includes("Files");
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDragActive(true);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragActive(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setDragActive(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
    onPickFiles(event.dataTransfer.files);
  }

  return (
    <div
      ref={props.shellRef}
      className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-[#f5efe6] via-[#f5efe6]/92 to-transparent px-2.5 pb-[calc(0.4rem+env(safe-area-inset-bottom))] pt-3 sm:px-4 sm:pb-4 sm:pt-5 md:px-10 md:pt-6"
    >
      <div className="pointer-events-auto mx-auto max-w-5xl">
        <div
          className={`composer-silk relative flex max-h-[min(78dvh,34rem)] flex-col overflow-hidden rounded-[1.35rem] border shadow-[0_22px_60px_rgba(84,52,29,0.14)] ring-1 ring-[#d8c7b2]/50 transition duration-200 sm:rounded-[1.55rem] ${
            dragActive
              ? "border-[var(--accent)] bg-[#fffaf2]/95 shadow-[0_24px_70px_rgba(217,100,58,0.18)]"
              : "border-white/70"
          }`}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {dragActive && (
            <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-[1.1rem] border border-dashed border-[var(--accent)] bg-[#fffaf2]/80 text-sm font-semibold text-[var(--accent)] shadow-inner backdrop-blur-sm">
              松开图片即可加入参考图
            </div>
          )}

          {referenceImages.length > 0 && (
            <div className="premium-scrollbar relative z-10 flex max-h-24 items-start gap-2 overflow-x-auto overflow-y-hidden px-4 pb-1 pt-3 sm:px-6 sm:pt-4">
              {referenceImages.map((referenceImage, index) => (
                <div
                  key={referenceImage.id}
                  className="group relative size-16 shrink-0 overflow-hidden rounded-xl border border-[var(--line)] bg-[#fffaf2] shadow-sm sm:size-20"
                  draggable
                  onDragStart={(event) => {
                    draggedReferenceIdRef.current = referenceImage.id;
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", referenceImage.id);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const sourceId = event.dataTransfer.getData("text/plain") || draggedReferenceIdRef.current;
                    draggedReferenceIdRef.current = null;
                    if (sourceId) {
                      onReorderReference(sourceId, referenceImage.id);
                    }
                  }}
                  onDragEnd={() => {
                    draggedReferenceIdRef.current = null;
                  }}
                >
                  <img src={referenceImage.previewUrl} alt="Reference" className="size-full object-cover" />
                  <div className="absolute left-1 top-1 flex items-center gap-0.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] text-white">
                    <GripVertical className="size-3" />
                    {index + 1}
                  </div>
                  <div className="absolute inset-x-1 bottom-1 flex justify-between opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => onMoveReference(referenceImage.id, -1)}
                      disabled={index === 0}
                      className="rounded-full bg-black/60 p-1 text-white transition hover:bg-[var(--accent)] disabled:opacity-30 sm:pointer-events-none sm:group-hover:pointer-events-auto"
                      aria-label={`参考图 ${index + 1} 前移`}
                      title="前移"
                    >
                      <ArrowLeft className="size-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onMoveReference(referenceImage.id, 1)}
                      disabled={index === referenceImages.length - 1}
                      className="rounded-full bg-black/60 p-1 text-white transition hover:bg-[var(--accent)] disabled:opacity-30 sm:pointer-events-none sm:group-hover:pointer-events-auto"
                      aria-label={`参考图 ${index + 1} 后移`}
                      title="后移"
                    >
                      <ArrowRight className="size-3" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemoveReference(referenceImage.id)}
                    className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-100 transition-opacity hover:bg-rose-500 sm:pointer-events-none sm:opacity-0 sm:group-hover:pointer-events-auto sm:group-hover:opacity-100"
                    aria-label={`移除参考图 ${index + 1}`}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="relative z-10 mx-3 mt-3 sm:mx-5 sm:mt-4">
              <Alert variant="error" onDismiss={onDismissError}>
                {error}
              </Alert>
            </div>
          )}

          <div className="relative z-10 flex items-end gap-2 px-3.5 pb-2 pt-2.5 sm:gap-3 sm:px-5 sm:pb-3 sm:pt-3">
            <div className="flex-1 min-w-0">
              <textarea
                ref={ref}
                value={prompt}
                maxLength={GENERATION_PROMPT_MAX_LENGTH}
                onChange={(event) => onChangePrompt(event.target.value)}
                onPaste={onPaste}
                onCompositionStart={onCompositionStart}
                onCompositionEnd={onCompositionEnd}
                onKeyDown={(e) => {
                  // 中文/日文/韩文输入法合成期间按 Enter 仅用于选词，不应触发发送。
                  // e.nativeEvent.isComposing 在大多数浏览器可用，ref 兜底避免兼容性差异。
                  const composing = isComposing() || e.nativeEvent.isComposing;
                  if (e.key === "Enter" && !e.shiftKey && !composing) {
                    e.preventDefault();
                    if (canSubmit) onKeyDownEnter();
                  }
                }}
                placeholder={
                  generationType === "image_to_image" || referenceImages.length > 0
                    ? "描述你希望如何修改这些参考图..."
                    : "输入提示词生成图片，或直接粘贴图片进入图生图..."
                }
                className="max-h-24 w-full resize-none bg-transparent py-1 text-base leading-6 text-[var(--ink)] outline-none placeholder:text-[#8d7d6f]/70 sm:max-h-28"
                style={{ minHeight: "36px" }}
                rows={1}
              />
            </div>

            <div className="mb-0.5 flex shrink-0 items-center gap-1.5 sm:gap-2">
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
                onClick={() => fileInputRef.current?.click()}
                className="rounded-full p-2 text-[#6f6257] transition hover:bg-white/60 hover:text-[var(--ink)]"
                title="上传或拖入参考图"
              >
                <Paperclip className="size-5" />
              </button>
              <button
                type="button"
                onClick={onSubmit}
                aria-label="发送"
                disabled={isPending || !canSubmit}
                className="group relative flex size-10 cursor-pointer items-center justify-center overflow-hidden rounded-full bg-[#5a4a3b] text-white shadow-[0_10px_22px_rgba(84,52,29,0.2)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_14px_28px_rgba(84,52,29,0.24)] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-md sm:size-11"
              >
                <div className="absolute inset-0 bg-gradient-to-tr from-[#d9643a] to-[#9b6b3f] opacity-0 transition-opacity group-hover:opacity-100" />
                {isPending ? (
                  <Sparkles className="relative z-10 size-4 animate-spin" />
                ) : (
                  <Send className="relative z-10 size-5 -ml-0.5 mt-0.5" />
                )}
              </button>
            </div>
          </div>

          <div className="relative z-10 flex flex-col gap-1.5 border-t border-[#dfd0bf]/60 px-3.5 py-2 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <div role="group" aria-label="生成模式" className="flex items-center rounded-xl border border-[var(--line)] bg-[#f7efe4]/78 p-1 shadow-sm">
                <button
                  type="button"
                  aria-pressed={generationType === "text_to_image"}
                  onClick={() => onChangeGenerationType("text_to_image")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors sm:px-4 ${
                    generationType === "text_to_image" ? "bg-white text-black shadow-sm" : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
                  }`}
                >
                  文生图
                </button>
                <button
                  type="button"
                  aria-pressed={generationType === "image_to_image"}
                  onClick={() => {
                    onChangeGenerationType("image_to_image");
                    if (referenceImages.length === 0) {
                      onClickImageMode();
                      fileInputRef.current?.click();
                    }
                  }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors sm:px-4 ${
                    generationType === "image_to_image" ? "bg-white text-black shadow-sm" : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
                  }`}
                >
                  图生图
                </button>
              </div>

              <label className="flex min-w-0 max-w-full items-center gap-2 rounded-xl border border-[var(--line)] bg-[#f7efe4]/72 px-3 py-1.5 text-xs text-[var(--ink-soft)] shadow-sm sm:py-2">
                <span className="shrink-0">尺寸</span>
                <select
                  aria-label="尺寸"
                  value={sizeSelectValue}
                  onChange={(event) => onSizeSelect(event.target.value)}
                  className="min-w-0 max-w-[9.5rem] bg-transparent text-xs font-medium text-[var(--ink)] outline-none sm:max-w-none"
                >
                  {SIZE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.detail ? `${option.label} · ${option.detail}` : option.label}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                onClick={onToggleSettings}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors sm:py-2 ${
                  showSettings ? "bg-[var(--accent)]/10 text-[var(--accent)]" : "text-[var(--ink-soft)] hover:bg-[#fffaf2]/78"
                }`}
              >
                <Settings2 className="size-3.5" />
                高级设置
              </button>
              <Link
                href="/api-keys"
                className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-[var(--ink-soft)] transition-colors hover:bg-[#fffaf2]/78 hover:text-[var(--ink)] sm:py-2"
                title="查看 OpenAI 兼容 API 接入方式"
              >
                <Code2 className="size-3.5" />
                API 接入
              </Link>
            </div>

            <div className="hidden items-center gap-3 md:flex">
              {channels.length > 1 && (
                <select
                  value={selectedChannelId ?? ""}
                  onChange={(e) => onChangeChannel(e.target.value)}
                  className="cursor-pointer rounded-xl border border-[var(--line)] bg-[#f7efe4]/72 px-3 py-2 text-xs font-semibold text-[var(--ink)] shadow-sm outline-none"
                >
                  {channels.map((ch) => (
                    <option key={ch.id} value={ch.id}>{ch.name}</option>
                  ))}
                </select>
              )}
              <select
                value={model}
                onChange={(e) => onChangeModel(e.target.value)}
                className="cursor-pointer rounded-xl border border-[var(--line)] bg-[#fffaf2]/72 px-4 py-2 text-sm font-medium text-[var(--ink)] shadow-sm outline-none"
              >
                {modelOptions.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>

          {/* 高级设置面板由父组件渲染并传入，避免在此处反向耦合所有设置字段。 */}
          <div className="hidden md:block w-full">
            {props.children}
          </div>
        </div>
      </div>
    </div>
  );
});
