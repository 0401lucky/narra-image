"use client";

// 高级设置面板（折叠展开），承担所有"次要参数"输入：
// 自定义尺寸、张数、质量、格式、压缩、审核、负向提示词，以及移动端的渠道/模型选择。
import { AnimatePresence, motion } from "motion/react";
import { useId } from "react";

import { imageSizeLimits } from "@/lib/generation/sizes";
import type {
  GenerationModeration,
  GenerationOutputFormat,
  GenerationQuality,
  GenerationType,
} from "@/lib/types";

import { MODERATION_OPTIONS, OUTPUT_FORMAT_OPTIONS, QUALITY_OPTIONS } from "../constants";
import type {
  ChannelInfo,
  CustomProviderDraft,
  ProviderSelectionMode,
} from "../types";

type AdvancedSettingsProps = {
  open: boolean;
  showCustomSize: boolean;
  customWidth: string;
  customHeight: string;
  normalizedCustomSize: string | null;
  customSizeWarning: string | null;
  count: number;
  quality: GenerationQuality;
  outputFormat: GenerationOutputFormat;
  outputCompression: number;
  moderation: GenerationModeration;
  negativePrompt: string;
  generationType: GenerationType;
  // 移动端从 Composer 搬过来的渠道/模型选择；桌面端这两个仍在 Composer 底部栏，避免重复。
  channels: ChannelInfo[];
  selectedChannelId: string | null;
  onChangeChannel: (channelId: string) => void;
  modelOptions: string[];
  model: string;
  onChangeModel: (model: string) => void;
  providerMode: ProviderSelectionMode;
  onChangeProviderMode: (mode: ProviderSelectionMode) => void;
  customProvider: CustomProviderDraft;
  onChangeCustomProvider: (provider: CustomProviderDraft) => void;
  customModelOptions: string[];
  savedProviderConfigured: boolean;
  onProbeCustomProviderModels: () => void;
  customProviderProbePending: boolean;
  customProviderProbeMessage: string | null;
  onChangeCustomSize: (width: string, height: string) => void;
  onChangeCount: (count: number) => void;
  onChangeQuality: (quality: GenerationQuality) => void;
  onChangeOutputFormat: (format: GenerationOutputFormat) => void;
  onChangeOutputCompression: (value: number) => void;
  onChangeModeration: (value: GenerationModeration) => void;
  onChangeNegativePrompt: (value: string) => void;
};

export function AdvancedSettings({
  open,
  showCustomSize,
  customWidth,
  customHeight,
  normalizedCustomSize,
  customSizeWarning,
  count,
  quality,
  outputFormat,
  outputCompression,
  moderation,
  negativePrompt,
  generationType,
  channels,
  selectedChannelId,
  onChangeChannel,
  modelOptions,
  model,
  onChangeModel,
  providerMode,
  onChangeProviderMode,
  customProvider,
  onChangeCustomProvider,
  customModelOptions,
  savedProviderConfigured,
  onProbeCustomProviderModels,
  customProviderProbePending,
  customProviderProbeMessage,
  onChangeCustomSize,
  onChangeCount,
  onChangeQuality,
  onChangeOutputFormat,
  onChangeOutputCompression,
  onChangeModeration,
  onChangeNegativePrompt,
}: AdvancedSettingsProps) {
  const customModelDatalistId = useId();

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="advanced-settings"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="max-h-[42vh] overflow-y-auto md:max-h-[42vh] max-md:max-h-none max-md:overflow-visible rounded-b-[1.25rem] border-t border-[var(--line)]/50 bg-[var(--surface)]/50 p-3 sm:max-h-[52vh] sm:rounded-b-[2rem] sm:p-5"
        >
          <section className="mb-4 rounded-2xl border border-[var(--line)]/70 bg-[#fffaf2]/58 p-3 shadow-sm sm:p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <span className="block text-xs font-medium text-[var(--ink-soft)]">渠道来源</span>
                <div
                  role="group"
                  aria-label="渠道来源"
                  className="mt-2 flex w-full rounded-xl border border-[var(--line)] bg-[#f7efe4]/72 p-1 sm:w-auto"
                >
                  <button
                    type="button"
                    aria-pressed={providerMode === "built_in"}
                    onClick={() => onChangeProviderMode("built_in")}
                    className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors sm:flex-none sm:px-4 ${
                      providerMode === "built_in"
                        ? "bg-white text-black shadow-sm"
                        : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
                    }`}
                  >
                    平台渠道
                  </button>
                  <button
                    type="button"
                    aria-pressed={providerMode === "custom"}
                    onClick={() => onChangeProviderMode("custom")}
                    className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors sm:flex-none sm:px-4 ${
                      providerMode === "custom"
                        ? "bg-white text-black shadow-sm"
                        : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
                    }`}
                  >
                    自填 API
                  </button>
                </div>
              </div>
              <p className="max-w-md text-[11px] leading-relaxed text-[var(--ink-soft)]">
                自填 API 会使用你自己的第三方 OpenAI 兼容渠道；本站不收取生成积分，第三方费用由该 API 方结算。
              </p>
            </div>

            {providerMode === "custom" && (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label>
                  <span className="mb-1.5 block text-xs font-medium text-[var(--ink-soft)]">Base URL</span>
                  <input
                    aria-label="第三方 Base URL"
                    value={customProvider.baseUrl}
                    onChange={(event) => onChangeCustomProvider({
                      ...customProvider,
                      baseUrl: event.target.value,
                    })}
                    placeholder="https://api.example.com/v1"
                    className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-strong)]/55 px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                  />
                </label>

                <label>
                  <span className="mb-1.5 block text-xs font-medium text-[var(--ink-soft)]">API Key</span>
                  <input
                    aria-label="第三方 API Key"
                    type="password"
                    autoComplete="off"
                    value={customProvider.apiKey}
                    onChange={(event) => onChangeCustomProvider({
                      ...customProvider,
                      apiKey: event.target.value,
                    })}
                    placeholder={savedProviderConfigured ? "已保存，可留空继续使用" : "sk-..."}
                    className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-strong)]/55 px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                  />
                </label>

                <label>
                  <span className="mb-1.5 block text-xs font-medium text-[var(--ink-soft)]">模型</span>
                  <input
                    aria-label="第三方模型"
                    list={customModelOptions.length > 0 ? customModelDatalistId : undefined}
                    value={customProvider.model}
                    onChange={(event) => onChangeCustomProvider({
                      ...customProvider,
                      model: event.target.value,
                    })}
                    placeholder="gpt-image-1"
                    className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-strong)]/55 px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
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
                  <span className="mb-1.5 block text-xs font-medium text-[var(--ink-soft)]">配置名称</span>
                  <input
                    aria-label="第三方配置名称"
                    value={customProvider.label}
                    onChange={(event) => onChangeCustomProvider({
                      ...customProvider,
                      label: event.target.value,
                    })}
                    placeholder="我的 API"
                    className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-strong)]/55 px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                  />
                </label>

                <div className="flex flex-col gap-2 md:col-span-2 min-[520px]:flex-row min-[520px]:items-center min-[520px]:justify-between">
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-[var(--ink-soft)]">
                    <input
                      aria-label="记住第三方 API 配置"
                      type="checkbox"
                      checked={customProvider.remember}
                      onChange={(event) => onChangeCustomProvider({
                        ...customProvider,
                        remember: event.target.checked,
                      })}
                      className="size-4 rounded border-[var(--line)] accent-[var(--accent)]"
                    />
                    记住配置，下次可留空 Key 使用
                  </label>

                  <div className="flex flex-col items-stretch gap-2 min-[520px]:items-end">
                    <button
                      type="button"
                      onClick={onProbeCustomProviderModels}
                      disabled={customProviderProbePending}
                      className="rounded-xl border border-[var(--line)] bg-white/70 px-3 py-2 text-xs font-semibold text-[var(--ink)] shadow-sm transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {customProviderProbePending ? "拉取中..." : "拉取模型"}
                    </button>
                    {customProviderProbeMessage && (
                      <p className="text-[11px] leading-relaxed text-[var(--ink-soft)]" role="status">
                        {customProviderProbeMessage}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>

          <div className="grid gap-4 md:grid-cols-2 md:gap-6">
            <div className="space-y-3 sm:space-y-4">
              {showCustomSize && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[var(--ink-soft)]">自定义尺寸</label>
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                    <input
                      aria-label="自定义宽度"
                      inputMode="numeric"
                      value={customWidth}
                      onChange={(event) => onChangeCustomSize(event.target.value, customHeight)}
                      className="min-w-0 rounded-xl border border-[var(--line)] bg-[var(--surface-strong)]/50 px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                    />
                    <span className="text-xs text-[var(--ink-soft)]">x</span>
                    <input
                      aria-label="自定义高度"
                      inputMode="numeric"
                      value={customHeight}
                      onChange={(event) => onChangeCustomSize(customWidth, event.target.value)}
                      className="min-w-0 rounded-xl border border-[var(--line)] bg-[var(--surface-strong)]/50 px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                    />
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-[var(--ink-soft)]">
                    将使用 {normalizedCustomSize ?? "有效尺寸"}，宽高会规整到 {imageSizeLimits.multiple}px 倍数，最大边 {imageSizeLimits.maxEdge}px。
                  </p>
                  {customSizeWarning && (
                    <p
                      className="mt-1 text-[11px] leading-relaxed text-amber-600 dark:text-amber-300"
                      role="alert"
                    >
                      {customSizeWarning}
                    </p>
                  )}
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--ink-soft)]">生成张数</label>
                {generationType === "image_to_image" ? (
                  <p className="rounded-lg border border-[var(--line)] bg-[var(--surface-strong)]/40 px-3 py-2 text-xs text-[var(--ink-soft)]">
                    图生图当前固定每次生成 1 张
                  </p>
                ) : (
                  <div className="flex gap-2">
                    {[1, 2, 3, 4].map((num) => (
                      <button
                        key={num}
                        onClick={() => onChangeCount(num)}
                        className={`flex-1 rounded-lg border py-1.5 text-sm transition-colors ${
                          count === num ? "border-[var(--accent)] bg-[var(--accent)]/5 text-[var(--accent)] font-medium" : "border-[var(--line)] bg-[var(--surface-strong)] text-[var(--ink-soft)] hover:border-[var(--ink-soft)]"
                        }`}
                      >
                        {num}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-3 sm:space-y-4">
              <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
                <label>
                  <span className="mb-1.5 block text-xs font-medium text-[var(--ink-soft)]">质量</span>
                  <select
                    aria-label="质量"
                    value={quality}
                    onChange={(event) => onChangeQuality(event.target.value as GenerationQuality)}
                    className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-strong)]/50 px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                  >
                    {QUALITY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="mb-1.5 block text-xs font-medium text-[var(--ink-soft)]">格式</span>
                  <select
                    aria-label="格式"
                    value={outputFormat}
                    onChange={(event) => onChangeOutputFormat(event.target.value as GenerationOutputFormat)}
                    className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-strong)]/50 px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                  >
                    {OUTPUT_FORMAT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
              </div>

              {outputFormat !== "png" && (
                <label>
                  <span className="mb-1.5 block text-xs font-medium text-[var(--ink-soft)]">压缩质量 {outputCompression}%</span>
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

              <label>
                <span className="mb-1.5 block text-xs font-medium text-[var(--ink-soft)]">审核策略</span>
                <select
                  aria-label="审核策略"
                  value={moderation}
                  onChange={(event) => onChangeModeration(event.target.value as GenerationModeration)}
                  className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-strong)]/50 px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                >
                  {MODERATION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>

              {generationType === "text_to_image" && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[var(--ink-soft)]">负向提示词</label>
                  <textarea
                    value={negativePrompt}
                    onChange={(e) => onChangeNegativePrompt(e.target.value)}
                    placeholder="例如：畸形、低画质"
                    className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-strong)]/50 px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                    rows={2}
                  />
                </div>
              )}
            </div>
          </div>
          <p className="mt-5 text-[11px] leading-relaxed text-[var(--ink-soft)]">
            2K/4K 属于高分辨率请求，真实生效情况由当前渠道和模型决定；超大尺寸会更慢，失败时可切回 1K 或自动。
          </p>

          {/* 移动端：渠道/模型选择（桌面端在 Composer 底部栏，故只在 md 以下显示） */}
          {providerMode === "built_in" && (
            <div className="mt-4 grid grid-cols-1 gap-3 border-t border-[var(--line)]/50 pt-4 min-[420px]:grid-cols-2 md:hidden">
              {channels.length > 1 && (
                <label>
                  <span className="mb-1.5 block text-xs font-medium text-[var(--ink-soft)]">渠道</span>
                  <select
                    aria-label="渠道"
                    value={selectedChannelId ?? ""}
                    onChange={(e) => onChangeChannel(e.target.value)}
                    className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-strong)]/50 px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                  >
                    {channels.map((ch) => (
                      <option key={ch.id} value={ch.id}>{ch.name}</option>
                    ))}
                  </select>
                </label>
              )}
              <label className={channels.length > 1 ? "" : "min-[420px]:col-span-2"}>
                <span className="mb-1.5 block text-xs font-medium text-[var(--ink-soft)]">模型</span>
                <select
                  aria-label="模型"
                  value={model}
                  onChange={(e) => onChangeModel(e.target.value)}
                  className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-strong)]/50 px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                >
                  {modelOptions.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
