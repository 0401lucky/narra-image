"use client";

/* eslint-disable @next/next/no-img-element */

// 底部输入悬浮区（Composer）：参考图、错误提示、文本框、模式与尺寸切换、发送、高级设置入口。
import { Paperclip, Send, Settings2, Sparkles, X } from "lucide-react";
import { forwardRef, useRef, type ReactNode } from "react";

import { Alert } from "@/components/ui/alert";
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

  return (
    <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-[#f5efe6] via-[#f5efe6]/92 to-transparent px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-8 sm:px-4 sm:pb-5 md:px-10 md:pt-10">
      <div className="mx-auto max-w-5xl">
        <div className="composer-silk relative flex max-h-[min(86dvh,42rem)] flex-col overflow-hidden rounded-[1.35rem] border border-white/70 shadow-[0_22px_60px_rgba(84,52,29,0.14)] ring-1 ring-[#d8c7b2]/50 backdrop-blur-2xl transition-all duration-300 sm:rounded-[1.55rem]">

          {referenceImages.length > 0 && (
            <div className="relative z-10 flex max-h-28 flex-wrap items-start gap-2 overflow-y-auto px-4 pb-1 pt-4 sm:max-h-none sm:px-6 sm:pt-5">
              {referenceImages.map((referenceImage, index) => (
                <div key={referenceImage.id} className="group relative overflow-hidden rounded-xl border border-[var(--line)]">
                  <img src={referenceImage.previewUrl} alt="Reference" className="h-16 w-auto object-cover sm:h-20" />
                  <button
                    type="button"
                    onClick={() => onRemoveReference(referenceImage.id)}
                    className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition-opacity hover:bg-rose-500 group-hover:opacity-100"
                  >
                    <X className="size-3.5" />
                  </button>
                  <div className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-center text-[10px] text-white">
                    参考图 {index + 1}
                  </div>
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

          <div className="relative z-10 flex items-end gap-2 px-4 pb-3 pt-4 sm:gap-3 sm:px-6 sm:pb-4 sm:pt-5">
            <div className="flex-1 min-w-0">
              <textarea
                ref={ref}
                value={prompt}
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
                className="max-h-28 w-full resize-none bg-transparent py-1 text-base leading-7 text-[var(--ink)] outline-none placeholder:text-[#8d7d6f]/70 sm:max-h-[132px]"
                style={{ minHeight: "54px" }}
                rows={1}
              />
            </div>

            <div className="mb-1.5 flex shrink-0 items-center gap-2">
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
                className="rounded-full p-2.5 text-[#6f6257] transition hover:bg-white/60 hover:text-[var(--ink)]"
                title="上传参考图"
              >
                <Paperclip className="size-5" />
              </button>
              <button
                type="button"
                onClick={onSubmit}
                aria-label="发送"
                disabled={isPending || !canSubmit}
                className="group relative flex size-12 cursor-pointer items-center justify-center overflow-hidden rounded-full bg-[#5a4a3b] text-white shadow-[0_14px_28px_rgba(84,52,29,0.22)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_18px_34px_rgba(84,52,29,0.26)] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-md"
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

          <div className="relative z-10 flex flex-col gap-2 border-t border-[#dfd0bf]/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
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

              <label className="flex min-w-0 max-w-full items-center gap-2 rounded-xl border border-[var(--line)] bg-[#f7efe4]/72 px-3 py-2 text-xs text-[var(--ink-soft)] shadow-sm">
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
                className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
                  showSettings ? "bg-[var(--accent)]/10 text-[var(--accent)]" : "text-[var(--ink-soft)] hover:bg-[#fffaf2]/78"
                }`}
              >
                <Settings2 className="size-3.5" />
                高级设置
              </button>
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
          {props.children}
        </div>
      </div>
    </div>
  );
});
