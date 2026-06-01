"use client";

/* eslint-disable @next/next/no-img-element */
import { Film, ImagePlus, Send, Sparkles, Type, X } from "lucide-react";
import { forwardRef, useRef } from "react";

import { Alert } from "@/components/ui/alert";
import { GENERATION_PROMPT_MAX_LENGTH } from "@/lib/generation/limits";
import type { ViewerUser } from "@/components/create/types";

import { VIDEO_ASPECT_OPTIONS, VIDEO_DURATION_OPTIONS, VIDEO_RESOLUTION_OPTIONS } from "../constants";
import type { VideoAspectRatio, VideoChannelInfo, VideoReferenceImage, VideoResolution } from "../types";

type VideoComposerProps = {
  currentUser: ViewerUser;
  generationType: "text_to_video" | "image_to_video";
  onChangeGenerationType: (type: "text_to_video" | "image_to_video") => void;
  prompt: string;
  onChangePrompt: (value: string) => void;
  referenceImage: VideoReferenceImage | null;
  onPickReference: (file: File | null) => void;
  channels: VideoChannelInfo[];
  selectedChannelId: string | null;
  onChangeChannel: (channelId: string) => void;
  modelOptions: string[];
  model: string;
  onChangeModel: (model: string) => void;
  durationSeconds: number;
  onChangeDuration: (value: number) => void;
  aspectRatio: VideoAspectRatio;
  onChangeAspectRatio: (value: VideoAspectRatio) => void;
  resolution: VideoResolution;
  onChangeResolution: (value: VideoResolution) => void;
  videoCreditCost: number | null;
  isPending: boolean;
  error: string | null;
  onDismissError: () => void;
  canSubmit: boolean;
  onSubmit: () => void;
};

export const VideoComposer = forwardRef<HTMLTextAreaElement, VideoComposerProps>(
  function VideoComposer(props, ref) {
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const {
      generationType,
      onChangeGenerationType,
      prompt,
      onChangePrompt,
      referenceImage,
      onPickReference,
      channels,
      selectedChannelId,
      onChangeChannel,
      modelOptions,
      model,
      onChangeModel,
      durationSeconds,
      onChangeDuration,
      aspectRatio,
      onChangeAspectRatio,
      resolution,
      onChangeResolution,
      videoCreditCost,
      isPending,
      error,
      onDismissError,
      canSubmit,
      onSubmit,
    } = props;

    return (
      <aside className="flex h-full w-full max-w-sm shrink-0 flex-col overflow-y-auto border-r border-[var(--line)]/70 bg-[#fffaf2]/60 px-5 py-6 backdrop-blur-md">
        <h2 className="mb-4 text-base font-semibold text-[var(--ink)]">视频参数</h2>

        {/* 类型切换 */}
        <div role="group" aria-label="生成模式" className="mb-4 flex items-center rounded-xl border border-[var(--line)] bg-[#f7efe4]/78 p-1 shadow-sm">
          <button
            type="button"
            aria-pressed={generationType === "text_to_video"}
            onClick={() => onChangeGenerationType("text_to_video")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
              generationType === "text_to_video" ? "bg-white text-black shadow-sm" : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
            }`}
          >
            <Type className="size-3.5" /> 文生视频
          </button>
          <button
            type="button"
            aria-pressed={generationType === "image_to_video"}
            onClick={() => {
              onChangeGenerationType("image_to_video");
              if (!referenceImage) fileInputRef.current?.click();
            }}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
              generationType === "image_to_video" ? "bg-white text-black shadow-sm" : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
            }`}
          >
            <Film className="size-3.5" /> 图生视频
          </button>
        </div>

        {/* 首帧上传（图生视频） */}
        {generationType === "image_to_video" && (
          <div className="mb-4">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                onPickReference(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
            {referenceImage ? (
              <div className="group relative overflow-hidden rounded-xl border border-[var(--line)]">
                <img src={referenceImage.previewUrl} alt="首帧" className="h-32 w-full object-cover" />
                <button
                  type="button"
                  onClick={() => onPickReference(null)}
                  className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-white transition hover:bg-rose-500"
                >
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-32 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--line)] bg-[#f7efe4]/45 text-xs text-[var(--ink-soft)] transition hover:bg-[#f7efe4]/70"
              >
                <ImagePlus className="size-6" />
                上传首帧 / 参考图
              </button>
            )}
          </div>
        )}

        {/* 提示词 */}
        <label className="mb-1.5 block text-xs font-semibold text-[var(--ink-soft)]">提示词</label>
        <textarea
          ref={ref}
          value={prompt}
          maxLength={GENERATION_PROMPT_MAX_LENGTH}
          onChange={(e) => onChangePrompt(e.target.value)}
          placeholder="描述你想生成的视频画面、镜头与动态…"
          className="mb-4 min-h-[96px] w-full resize-none rounded-xl border border-[var(--line)] bg-white/70 px-3 py-2.5 text-sm leading-6 text-[var(--ink)] outline-none placeholder:text-[#8d7d6f]/70 focus:border-[var(--accent)]"
          rows={4}
        />

        {/* 时长 */}
        <ParamSelect
          label="时长"
          value={String(durationSeconds)}
          onChange={(v) => onChangeDuration(Number(v))}
          options={VIDEO_DURATION_OPTIONS.map((o) => ({ label: o.label, value: String(o.value) }))}
        />
        {/* 画面比例 */}
        <ParamSelect
          label="画面比例"
          value={aspectRatio}
          onChange={(v) => onChangeAspectRatio(v as VideoAspectRatio)}
          options={VIDEO_ASPECT_OPTIONS}
        />
        {/* 分辨率 */}
        <ParamSelect
          label="分辨率"
          value={resolution}
          onChange={(v) => onChangeResolution(v as VideoResolution)}
          options={VIDEO_RESOLUTION_OPTIONS}
        />

        {/* 渠道 + 模型 */}
        {channels.length > 1 && (
          <ParamSelect
            label="渠道"
            value={selectedChannelId ?? ""}
            onChange={onChangeChannel}
            options={channels.map((c) => ({ label: c.name, value: c.id }))}
          />
        )}
        <ParamSelect
          label="模型"
          value={model}
          onChange={onChangeModel}
          options={modelOptions.map((m) => ({ label: m, value: m }))}
        />

        {error && (
          <div className="mt-3">
            <Alert variant="error" onDismiss={onDismissError}>{error}</Alert>
          </div>
        )}

        <div className="mt-auto pt-5">
          <button
            type="button"
            onClick={onSubmit}
            disabled={isPending || !canSubmit}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#5a4a3b] px-4 py-3 text-sm font-semibold text-white shadow-[0_14px_28px_rgba(84,52,29,0.22)] transition hover:-translate-y-0.5 hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? <Sparkles className="size-4 animate-spin" /> : <Send className="size-4" />}
            生成视频{videoCreditCost != null ? `（${videoCreditCost} 积分）` : ""}
          </button>
        </div>
      </aside>
    );
  },
);

function ParamSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
}) {
  return (
    <label className="mb-3 block">
      <span className="mb-1.5 block text-xs font-semibold text-[var(--ink-soft)]">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full cursor-pointer rounded-xl border border-[var(--line)] bg-white/70 px-3 py-2 text-sm font-medium text-[var(--ink)] shadow-sm outline-none focus:border-[var(--accent)]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}
