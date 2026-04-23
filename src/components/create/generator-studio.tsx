/* eslint-disable @next/next/no-img-element */

"use client";

import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import { Sparkles, WandSparkles } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type ViewerUser = {
  credits: number;
  role: "user" | "admin";
} | null;

type GenerationItem = {
  count: number;
  createdAt: string;
  creditsSpent: number;
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
  status: "pending" | "succeeded" | "failed";
};

type SavedProvider = {
  baseUrl: string;
  label?: string | null;
  model: string;
} | null;

type GeneratorStudioProps = {
  compact?: boolean;
  currentUser: ViewerUser;
  initialGenerations?: GenerationItem[];
  initialSavedProvider?: SavedProvider;
};

const stylePresets = [
  "电影级海报",
  "杂志封面",
  "霓虹街拍",
  "手作拼贴",
  "柔光人像",
  "未来建筑",
];

export function GeneratorStudio({
  compact = false,
  currentUser,
  initialGenerations = [],
  initialSavedProvider = null,
}: GeneratorStudioProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isFetchingModels, startFetchingModels] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [modelProbeError, setModelProbeError] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [model, setModel] = useState(initialSavedProvider?.model || "gpt-image-1");
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
  const [generations, setGenerations] = useState(initialGenerations);
  const [credits, setCredits] = useState(currentUser?.credits ?? 0);

  const latestGeneration = generations[0] ?? null;
  const gallery = latestGeneration?.images ?? [];

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

    const response = await fetch("/api/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
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

    setGenerations((current) => [generation, ...current]);
    if (generation.providerMode === "built_in") {
      setCredits((current) => Math.max(0, current - generation.creditsSpent));
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

  function applyPreset(preset: string) {
    setPrompt((current) => (current ? `${current}，${preset}` : preset));
  }

  return (
    <section
      className={`grid gap-6 ${compact ? "xl:grid-cols-[1.2fr_0.8fr]" : "xl:grid-cols-[1fr_0.9fr]"}`}
    >
      <div className="studio-card noise-overlay relative flex flex-col overflow-hidden rounded-[2rem] p-6 md:p-8">
        <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent opacity-50" />
        
        <div className="mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-[var(--accent)]/10 text-[var(--accent)]">
              <WandSparkles className="size-5" />
            </div>
            <h2 className="text-xl font-semibold tracking-tight">
              提示词工作室
            </h2>
          </div>
          <div className="flex items-center gap-3 rounded-full border border-[var(--line)] bg-[var(--surface-strong)]/50 px-4 py-2 text-sm">
            <span className="text-[var(--ink-soft)]">剩余积分</span>
            <span className="font-semibold text-[var(--accent)]">{currentUser ? credits : "--"}</span>
          </div>
        </div>

        <div className="flex flex-col gap-5">
          <div className="relative group">
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="描述你想要生成的画面。例如：一位穿银色风衣的亚洲模特站在雨后的城市巷口，胶片颗粒感，杂志封面光影。"
              className="min-h-[140px] w-full resize-none rounded-[1.25rem] border border-[var(--line)] bg-[var(--surface-strong)]/50 px-5 py-4 text-base placeholder:text-[var(--ink-soft)]/50 outline-none transition-all focus:border-[var(--accent)] focus:bg-[var(--surface-strong)] focus:ring-4 focus:ring-[var(--accent)]/10"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {stylePresets.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => applyPreset(preset)}
                className="rounded-full border border-[var(--line)] bg-[var(--surface-strong)]/30 px-4 py-1.5 text-sm text-[var(--ink-soft)] transition-all hover:border-[var(--accent)]/50 hover:bg-[var(--accent)]/10 hover:text-[var(--ink)] active:scale-95"
              >
                {preset}
              </button>
            ))}
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink-soft)]">生成模型</span>
              <div className="flex gap-2">
                <input
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  className="flex-1 rounded-xl border border-[var(--line)] bg-[var(--surface-strong)]/50 px-4 py-2.5 text-sm outline-none transition-all focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/10"
                />
                {providerMode === "custom" && (
                  <button
                    type="button"
                    onClick={() => startFetchingModels(handleProbeModels)}
                    disabled={isFetchingModels || !customBaseUrl}
                    className="shrink-0 rounded-xl border border-[var(--line)] bg-[var(--surface-strong)]/50 px-4 py-2.5 text-sm transition-all hover:bg-[var(--line)] disabled:opacity-50"
                  >
                    {isFetchingModels ? "拉取中..." : "拉取模型"}
                  </button>
                )}
              </div>
              {availableModels.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {availableModels.slice(0, 5).map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setModel(item)}
                      className={`rounded-md px-2 py-1 text-xs transition-colors ${
                        model === item
                          ? "bg-[var(--ink)] text-[var(--surface)]"
                          : "bg-[var(--surface-strong)] text-[var(--ink-soft)] hover:bg-[var(--line)] hover:text-[var(--ink)]"
                      }`}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink-soft)]">生成张数</span>
              <select
                value={count}
                onChange={(event) => setCount(Number(event.target.value))}
                className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-strong)]/50 px-4 py-2.5 text-sm outline-none transition-all focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/10"
              >
                {[1, 2, 3, 4].map((value) => (
                  <option key={value} value={value} className="bg-[var(--surface-strong)]">
                    {value} 张
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink-soft)]">图片比例</span>
              <div className="flex rounded-xl border border-[var(--line)] bg-[var(--surface-strong)]/30 p-1">
                {sizeOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setSize(option.value as typeof size)}
                    className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                      size === option.value
                        ? "bg-[var(--card)] text-[var(--ink)] shadow-sm border border-[var(--line)]"
                        : "text-[var(--ink-soft)] hover:text-[var(--ink)] border border-transparent"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-sm font-medium text-[var(--ink-soft)]">通道选择</span>
              <div className="flex rounded-xl border border-[var(--line)] bg-[var(--surface-strong)]/30 p-1">
                <button
                  type="button"
                  onClick={() => setProviderMode("built_in")}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                    providerMode === "built_in"
                      ? "bg-[var(--card)] text-[var(--ink)] shadow-sm border border-[var(--line)]"
                      : "text-[var(--ink-soft)] hover:text-[var(--ink)] border border-transparent"
                  }`}
                >
                  内置渠道
                </button>
                <button
                  type="button"
                  onClick={() => setProviderMode("custom")}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                    providerMode === "custom"
                      ? "bg-[var(--card)] text-[var(--ink)] shadow-sm border border-[var(--line)]"
                      : "text-[var(--ink-soft)] hover:text-[var(--ink)] border border-transparent"
                  }`}
                >
                  自填渠道
                </button>
              </div>
            </div>
          </div>

          <details className="group rounded-xl border border-[var(--line)] bg-[var(--surface-strong)]/20 transition-all open:bg-[var(--surface-strong)]/40">
            <summary className="flex cursor-pointer items-center justify-between px-5 py-3.5 text-sm font-medium text-[var(--ink)] outline-none">
              高级选项
              <span className="text-[var(--ink-soft)] transition-transform group-open:rotate-180">↓</span>
            </summary>
            <div className="border-t border-[var(--line)] p-5 grid gap-4">
              <div className="space-y-2">
                <span className="text-sm text-[var(--ink-soft)]">负向提示词</span>
                <textarea
                  value={negativePrompt}
                  onChange={(event) => setNegativePrompt(event.target.value)}
                  placeholder="比如：低清晰度、畸形手部、过曝"
                  className="min-h-[80px] w-full resize-none rounded-xl border border-[var(--line)] bg-[var(--surface-strong)]/50 px-4 py-3 text-sm outline-none transition-all focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/10"
                />
              </div>

              {providerMode === "custom" ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2 md:col-span-2">
                    <span className="text-sm text-[var(--ink-soft)]">Base URL</span>
                    <input
                      value={customBaseUrl}
                      onChange={(event) => setCustomBaseUrl(event.target.value)}
                      placeholder="https://your-gateway.example.com/v1"
                      className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-strong)]/50 px-4 py-2.5 text-sm outline-none transition-all focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/10"
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <span className="text-sm text-[var(--ink-soft)]">API Key</span>
                    <input
                      value={customApiKey}
                      onChange={(event) => setCustomApiKey(event.target.value)}
                      placeholder="sk-..."
                      className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-strong)]/50 px-4 py-2.5 text-sm outline-none transition-all focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/10"
                    />
                  </div>
                  <label className="flex items-center gap-3 text-sm text-[var(--ink-soft)] md:col-span-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={rememberProvider}
                      onChange={(event) => setRememberProvider(event.target.checked)}
                      className="rounded border-[var(--line)] bg-[var(--surface-strong)] text-[var(--accent)] focus:ring-[var(--accent)]/20"
                    />
                    记住我的自填渠道配置
                  </label>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--surface-strong)]/30 px-4 py-3 text-sm text-[var(--ink-soft)]">
                  当前使用站点内置渠道，每次成功生成默认扣除 5 积分。
                </div>
              )}
            </div>
          </details>

          {error && (
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={() => startTransition(handleGenerate)}
            disabled={isPending || !prompt.trim()}
            className="group relative mt-2 flex w-full items-center justify-center gap-2 overflow-hidden rounded-[1.25rem] bg-[var(--ink)] px-6 py-4 text-base font-semibold text-[var(--surface)] shadow-lg transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-[var(--accent)] to-[var(--accent-soft)] opacity-0 transition-opacity group-hover:opacity-100" />
            <div className="relative z-10 flex items-center gap-2">
              {isPending ? (
                <Sparkles className="size-5 animate-spin" />
              ) : (
                <WandSparkles className="size-5 transition-transform group-hover:rotate-12" />
              )}
              {currentUser ? "立即生成" : "登录后生成"}
            </div>
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        <div className="studio-card flex flex-col overflow-hidden rounded-[2rem] p-5">
          <div className="mb-4 flex items-center justify-between px-1">
            <h3 className="text-lg font-semibold tracking-tight">生成结果</h3>
            {latestGeneration && (
              <div className="flex gap-2 text-xs text-[var(--ink-soft)]">
                <span className="rounded-full bg-[var(--surface-strong)] px-2 py-1">{latestGeneration.model}</span>
                <span className="rounded-full bg-[var(--surface-strong)] px-2 py-1">{latestGeneration.size}</span>
              </div>
            )}
          </div>

          <div className="flex-1">
            {gallery.length > 0 ? (
              <div className={`grid gap-4 h-full ${gallery.length > 1 ? "sm:grid-cols-2" : ""}`}>
                {gallery.map((image) => (
                  <div
                    key={image.id}
                    className="group relative overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)]/50"
                  >
                    <img
                      src={image.url}
                      alt="生成结果"
                      className="aspect-[4/5] h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-full min-h-[300px] flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface-strong)]/20 px-6 py-12 text-center">
                <div className="mb-3 rounded-full bg-[var(--surface-strong)] p-4 text-[var(--ink-soft)]">
                  <Sparkles className="size-6 opacity-50" />
                </div>
                <p className="text-sm text-[var(--ink-soft)]">
                  你的创意将在这里呈现。<br />输入提示词，点击生成即可开始。
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="studio-card flex-1 rounded-[2rem] p-5">
          <h3 className="mb-4 px-1 text-lg font-semibold tracking-tight">历史记录</h3>

          <div className="grid gap-3">
            {generations.length > 0 ? (
              generations.slice(0, compact ? 3 : 6).map((generation) => (
                <div
                  key={generation.id}
                  className="group relative overflow-hidden rounded-[1.25rem] border border-[var(--line)] bg-[var(--surface-strong)]/30 p-4 transition-colors hover:bg-[var(--surface-strong)]/60"
                >
                  <div className="mb-2 flex items-center justify-between gap-3 text-xs text-[var(--ink-soft)]">
                    <span className="flex items-center gap-1.5 font-medium">
                      <div className={`size-1.5 rounded-full ${generation.providerMode === "built_in" ? "bg-[var(--accent)]" : "bg-teal-400"}`} />
                      {generation.providerMode === "built_in" ? "内置渠道" : "自填渠道"}
                    </span>
                    <span>
                      {formatDistanceToNow(new Date(generation.createdAt), {
                        addSuffix: true,
                        locale: zhCN,
                      })}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-sm text-[var(--ink)]/90">{generation.prompt}</p>
                  <div className="mt-3 flex items-center justify-between text-xs text-[var(--ink-soft)]">
                    <span className="rounded-md bg-[var(--line)] px-2 py-0.5">{generation.model}</span>
                    <span className="font-medium text-[var(--accent-soft)]">-{generation.creditsSpent} 积分</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[1.25rem] border border-dashed border-[var(--line)] bg-[var(--surface-strong)]/20 px-4 py-8 text-center text-sm text-[var(--ink-soft)]">
                还没有生成记录。
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
