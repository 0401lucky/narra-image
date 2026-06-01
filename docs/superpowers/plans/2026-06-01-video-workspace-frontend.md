# 视频工作区 · `/video` 前端 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建独立页面 `/video`（左参数面板 · 中预览舞台 · 底部历史时间线），复用现有 `/api/generate` 提交链路与轮询，让用户在专属界面文生/图生视频，并实时看进度、播放、下载。

**Architecture:** 仿 `/create` 的「服务端 page 加载 + 客户端工作区」结构，但布局改为三区、无会话侧栏。轮询直接复用 `create` 的 `useImagePoller`（它只看 `generation.status`，与媒体类型无关）。提交沿用 `/api/generate`：文生视频走 JSON、图生视频走 FormData（带首帧）。

**Tech Stack:** Next 16 App Router（服务端 `page.tsx` + `"use client"` 工作区）、`motion/react`、`lucide-react`、Tailwind（复用 `--line`/`--ink`/`--ink-soft`/`--accent` token 与现有 `composer-silk`/暖米色风格）。

**依赖：** 计划一（数据模型 + 提交 API 视频分支 + Worker + `me/generations` 读取端点 `include videos`）必须先完成并通过。

**前端 Task 粒度声明：** 本仓库无组件测试（`src/tests/unit/` 全是逻辑单测，虽装了 `@testing-library/react` 但未用于业务组件）。因此前端验证 = `pnpm exec tsc --noEmit` + `pnpm lint` + 本地 `pnpm dev` 手动跑通。每个组件给出**完整 props 接口 + 可运行实现（含复用的 className token）**；纯视觉细节（精确阴影/间距）按现有设计系统在执行时微调，不算占位符。提交逻辑、状态编排、轮询接线为逻辑核心，完整给出。

---

## 文件结构

**创建：**
- `src/app/video/page.tsx` — 服务端页面：加载用户、视频历史任务、活跃渠道
- `src/components/video/types.ts` — 前端类型（渠道、首帧、表单态）
- `src/components/video/constants.ts` — 时长/比例/分辨率选项与 `resolveVideoSize`
- `src/components/video/video-studio.tsx` — 客户端容器：状态、提交、轮询、组装
- `src/components/video/parts/video-composer.tsx` — 左侧参数面板
- `src/components/video/parts/video-stage.tsx` — 中间预览舞台（播放器 + 状态 + 操作）
- `src/components/video/parts/video-history-rail.tsx` — 底部历史时间线

**修改：**
- `src/components/create/types.ts` — `GenerationItem` 加 `videos`/`durationSeconds`/`aspectRatio`，新增 `GenerationVideo` 类型（视频工作区复用此类型，故就地扩展）
- `src/components/marketing/site-header.tsx` — `links` 加 `/video` 入口

---

## Task 1: 共享类型扩展与视频常量

**Files:**
- Modify: `src/components/create/types.ts`
- Create: `src/components/video/types.ts`
- Create: `src/components/video/constants.ts`

- [ ] **Step 1: `GenerationItem` 加视频字段**

`src/components/create/types.ts`，在 `GenerationImage` 类型之后加 `GenerationVideo`；并在 `GenerationItem` 内 `images: GenerationImage[];` 之后、相关位置加三个可选字段：

```ts
export type GenerationVideo = {
  id: string;
  url: string;
  posterUrl?: string | null;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
};
```

在 `GenerationItem` 内（`images: GenerationImage[];` 一行下方）加：

```ts
  images: GenerationImage[];
  videos?: GenerationVideo[];
  aspectRatio?: string | null;
  durationSeconds?: number | null;
```

> 与计划一 `SerializedGeneration` 的 `videos`/`aspectRatio`/`durationSeconds` 字段对应；`useImagePoller` 拉取 `/api/me/generations/{id}` 的结果即此形状。

- [ ] **Step 2: 新建 `video/types.ts`**

```ts
// 视频工作区前端类型。
export type VideoChannelInfo = {
  id: string;
  name: string;
  defaultModel: string;
  models: string[];
  videoCreditCost: number;
};

export type VideoReferenceImage = {
  file: File;
  previewUrl: string;
};

export type VideoAspectRatio = "16:9" | "9:16" | "1:1";
export type VideoResolution = "720p" | "1080p";
```

- [ ] **Step 3: 新建 `video/constants.ts`**

```ts
import type { VideoAspectRatio, VideoResolution } from "./types";

export const VIDEO_DURATION_OPTIONS: Array<{ label: string; value: number }> = [
  { label: "4 秒", value: 4 },
  { label: "8 秒", value: 8 },
  { label: "12 秒", value: 12 },
];

export const VIDEO_ASPECT_OPTIONS: Array<{ label: string; value: VideoAspectRatio }> = [
  { label: "横屏 16:9", value: "16:9" },
  { label: "竖屏 9:16", value: "9:16" },
  { label: "方形 1:1", value: "1:1" },
];

export const VIDEO_RESOLUTION_OPTIONS: Array<{ label: string; value: VideoResolution }> = [
  { label: "720p", value: "720p" },
  { label: "1080p", value: "1080p" },
];

// 比例 + 清晰度 → 渠道接受的像素 size 字符串。
const VIDEO_SIZE_MAP: Record<VideoAspectRatio, Record<VideoResolution, string>> = {
  "16:9": { "720p": "1280x720", "1080p": "1920x1080" },
  "9:16": { "720p": "720x1280", "1080p": "1080x1920" },
  "1:1": { "720p": "720x720", "1080p": "1080x1080" },
};

export function resolveVideoSize(aspectRatio: VideoAspectRatio, resolution: VideoResolution): string {
  return VIDEO_SIZE_MAP[aspectRatio]?.[resolution] ?? "1280x720";
}
```

- [ ] **Step 4: 类型自检**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 5: Commit**

```bash
git add src/components/create/types.ts src/components/video/types.ts src/components/video/constants.ts
git commit -m "feat(video): 前端共享类型扩展与视频参数常量"
```

---

## Task 2: `/video` 服务端页面

**Files:**
- Create: `src/app/video/page.tsx`

- [ ] **Step 1: 写页面**

仿 `src/app/create/page.tsx`：加载用户、视频历史任务（`include videos`）、活跃渠道（带 `videoCreditCost`）。`src/app/video/page.tsx`：

```tsx
import { redirect } from "next/navigation";
import { GenerationType } from "@prisma/client";

import { db } from "@/lib/db";
import { serializeGeneration, serializeUser } from "@/lib/prisma-mappers";
import { getCurrentUserRecord } from "@/lib/server/current-user";
import { SiteHeader } from "@/components/marketing/site-header";
import { VideoStudio } from "@/components/video/video-studio";
import { getActiveChannels } from "@/lib/providers/built-in-provider";
import { failStalePendingGenerationJobs } from "@/lib/generation/job-refund";

export const dynamic = "force-dynamic";

export default async function VideoPage() {
  const user = await getCurrentUserRecord();
  if (!user) {
    redirect("/login");
  }

  await failStalePendingGenerationJobs({ userId: user.id });

  const [jobs, channels] = await Promise.all([
    db.generationJob.findMany({
      where: {
        userId: user.id,
        generationType: { in: [GenerationType.TEXT_TO_VIDEO, GenerationType.IMAGE_TO_VIDEO] },
      },
      include: {
        images: { orderBy: { createdAt: "asc" } },
        videos: { orderBy: { createdAt: "asc" } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    getActiveChannels(),
  ]);

  const currentUser = serializeUser(user);
  const serializedChannels = channels.map((ch) => ({
    defaultModel: ch.defaultModel,
    id: ch.id,
    models: ch.models,
    name: ch.name,
    videoCreditCost: ch.videoCreditCost,
  }));

  return (
    <main className="flex h-[100dvh] flex-col overflow-hidden bg-[#f5efe6]">
      <SiteHeader currentUser={currentUser} showCheckIn={false} activeHref="/video" />

      <section className="relative flex flex-1 flex-col overflow-hidden">
        <VideoStudio
          currentUser={currentUser}
          initialGenerations={jobs.map(serializeGeneration)}
          channels={serializedChannels}
        />
      </section>
    </main>
  );
}
```

- [ ] **Step 2: 类型自检（此时 `VideoStudio` 尚未创建，预期报错）**

Run: `pnpm exec tsc --noEmit`
Expected: FAIL — `Cannot find module '@/components/video/video-studio'`。Task 3 创建后转通过。

- [ ] **Step 3: Commit**

```bash
git add src/app/video/page.tsx
git commit -m "feat(video): 新增 /video 服务端页面加载视频历史与渠道"
```

---

## Task 3: `VideoStudio` 容器 — 状态、提交、轮询

**Files:**
- Create: `src/components/video/video-studio.tsx`

- [ ] **Step 1: 写容器组件**

`src/components/video/video-studio.tsx`。状态编排 + 提交（文生/图生分支）+ 复用 `useImagePoller` + 三区组装：

```tsx
"use client";

// 视频工作区容器：左参数面板 · 中预览舞台 · 底部历史时间线。
// 复用 create 的 useImagePoller（仅看 status，媒体类型无关）；提交沿用 /api/generate。
import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { useImagePoller } from "@/components/create/hooks/use-image-poller";
import type { GenerationItem, ViewerUser } from "@/components/create/types";
import type { GenerationType } from "@/lib/types";

import { resolveVideoSize } from "./constants";
import type { VideoAspectRatio, VideoChannelInfo, VideoReferenceImage, VideoResolution } from "./types";
import { VideoComposer } from "./parts/video-composer";
import { VideoStage } from "./parts/video-stage";
import { VideoHistoryRail } from "./parts/video-history-rail";

type VideoStudioProps = {
  currentUser: ViewerUser;
  initialGenerations?: GenerationItem[];
  channels?: VideoChannelInfo[];
};

const EMPTY_GENERATIONS: GenerationItem[] = [];
const EMPTY_CHANNELS: VideoChannelInfo[] = [];

type VideoSnapshot = {
  prompt: string;
  generationType: Extract<GenerationType, "text_to_video" | "image_to_video">;
  referenceImage: VideoReferenceImage | null;
};

export function VideoStudio({
  currentUser,
  initialGenerations = EMPTY_GENERATIONS,
  channels = EMPTY_CHANNELS,
}: VideoStudioProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [generationType, setGenerationType] = useState<VideoSnapshot["generationType"]>("text_to_video");
  const [prompt, setPrompt] = useState("");
  const [referenceImage, setReferenceImage] = useState<VideoReferenceImage | null>(null);

  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(channels[0]?.id ?? null);
  const selectedChannel = useMemo(
    () => channels.find((c) => c.id === selectedChannelId) ?? channels[0] ?? null,
    [channels, selectedChannelId],
  );
  const [model, setModel] = useState(selectedChannel?.defaultModel || "sora-2");
  const [durationSeconds, setDurationSeconds] = useState(8);
  const [aspectRatio, setAspectRatio] = useState<VideoAspectRatio>("16:9");
  const [resolution, setResolution] = useState<VideoResolution>("720p");

  const [generations, setGenerations] = useState<GenerationItem[]>(initialGenerations);
  const [selectedId, setSelectedId] = useState<string | null>(initialGenerations[0]?.id ?? null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // 轮询：pending 任务持续拉取 /api/me/generations/{id}，命中终态写回。
  const handlePollerUpdate = useCallback((updated: GenerationItem) => {
    setGenerations((current) => current.map((g) => (g.id === updated.id ? updated : g)));
  }, []);
  useImagePoller({ generations, onUpdate: handlePollerUpdate });

  const selectedGeneration = useMemo(
    () => generations.find((g) => g.id === selectedId) ?? generations[0] ?? null,
    [generations, selectedId],
  );

  const modelOptions = useMemo(() => {
    const channelModels = selectedChannel?.models ?? [];
    if (channelModels.includes(model)) return channelModels;
    return [model, ...channelModels];
  }, [selectedChannel?.models, model]);

  const canSubmit = Boolean(prompt.trim()) && (generationType === "text_to_video" || referenceImage !== null);

  function handleChannelChange(newChannelId: string) {
    setSelectedChannelId(newChannelId);
    const ch = channels.find((c) => c.id === newChannelId);
    if (ch && !ch.models.includes(model)) setModel(ch.defaultModel);
  }

  function handlePickReference(file: File | null) {
    if (referenceImage) URL.revokeObjectURL(referenceImage.previewUrl);
    if (!file) {
      setReferenceImage(null);
      return;
    }
    setReferenceImage({ file, previewUrl: URL.createObjectURL(file) });
    setGenerationType("image_to_video");
  }

  function handleSubmit() {
    if (!currentUser) {
      router.push("/login");
      return;
    }
    setError(null);
    if (generationType === "image_to_video" && !referenceImage) {
      setError("图生视频请先上传首帧");
      return;
    }
    if (!prompt.trim()) return;

    const snapshot: VideoSnapshot = { prompt, generationType, referenceImage };
    setPrompt("");
    startTransition(() => {
      void handleGenerate(snapshot);
    });
  }

  async function handleGenerate(snapshot: VideoSnapshot) {
    function restore(message: string) {
      setError(message);
      setPrompt((current) => current || snapshot.prompt);
    }

    try {
      const size = resolveVideoSize(aspectRatio, resolution);
      let response: Response;

      if (snapshot.generationType === "image_to_video" && snapshot.referenceImage) {
        const formData = new FormData();
        formData.append("generationType", "image_to_video");
        formData.append("model", model);
        formData.append("prompt", snapshot.prompt);
        formData.append("providerMode", "built_in");
        formData.append("size", size);
        formData.append("durationSeconds", String(durationSeconds));
        formData.append("aspectRatio", aspectRatio);
        if (selectedChannelId) formData.append("channelId", selectedChannelId);
        formData.append("image", snapshot.referenceImage.file);
        response = await fetch("/api/generate", { method: "POST", body: formData });
      } else {
        response = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            aspectRatio,
            channelId: selectedChannelId,
            customProvider: null,
            durationSeconds,
            generationType: "text_to_video",
            model,
            prompt: snapshot.prompt,
            providerMode: "built_in",
            size,
          }),
        });
      }

      const result = (await response.json()) as {
        data?: { generation: GenerationItem };
        error?: string;
      };

      if (!response.ok) {
        restore(result.error || "生成失败，请稍后再试");
        return;
      }
      const generation = result.data?.generation;
      if (!generation) {
        restore("服务端没有返回任务");
        return;
      }

      if (snapshot.referenceImage) {
        URL.revokeObjectURL(snapshot.referenceImage.previewUrl);
        setReferenceImage(null);
        setGenerationType("text_to_video");
      }
      setGenerations((current) => [generation, ...current]);
      setSelectedId(generation.id);
    } catch (err) {
      restore(err instanceof Error ? err.message : "生成失败，请稍后再试");
    }
  }

  async function handleDownload(url: string) {
    try {
      const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(url)}`;
      const response = await fetch(proxyUrl);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = "narra-video.mp4";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[linear-gradient(180deg,#faf6ef_0%,#f2e9dc_100%)]">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <VideoComposer
          ref={textareaRef}
          currentUser={currentUser}
          generationType={generationType}
          onChangeGenerationType={setGenerationType}
          prompt={prompt}
          onChangePrompt={setPrompt}
          referenceImage={referenceImage}
          onPickReference={handlePickReference}
          channels={channels}
          selectedChannelId={selectedChannelId}
          onChangeChannel={handleChannelChange}
          modelOptions={modelOptions}
          model={model}
          onChangeModel={setModel}
          durationSeconds={durationSeconds}
          onChangeDuration={setDurationSeconds}
          aspectRatio={aspectRatio}
          onChangeAspectRatio={setAspectRatio}
          resolution={resolution}
          onChangeResolution={setResolution}
          videoCreditCost={selectedChannel?.videoCreditCost ?? null}
          isPending={isPending}
          error={error}
          onDismissError={() => setError(null)}
          canSubmit={canSubmit}
          onSubmit={handleSubmit}
        />

        <VideoStage
          generation={selectedGeneration}
          onDownload={handleDownload}
          onRetry={() => handleSubmit()}
        />
      </div>

      <VideoHistoryRail
        generations={generations}
        selectedId={selectedGeneration?.id ?? null}
        onSelect={setSelectedId}
      />
    </div>
  );
}
```

- [ ] **Step 2: 类型自检（VideoComposer/Stage/HistoryRail 未建，预期报错）**

Run: `pnpm exec tsc --noEmit`
Expected: FAIL — 找不到 `./parts/video-composer` 等三个模块。Task 4-6 建好后转通过。

- [ ] **Step 3: Commit**

```bash
git add src/components/video/video-studio.tsx
git commit -m "feat(video): VideoStudio 容器编排状态、提交与轮询"
```

---

## Task 4: `VideoComposer` 左侧参数面板

**Files:**
- Create: `src/components/video/parts/video-composer.tsx`

- [ ] **Step 1: 写组件**

`src/components/video/parts/video-composer.tsx`：

```tsx
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
```

- [ ] **Step 2: Commit**

```bash
git add src/components/video/parts/video-composer.tsx
git commit -m "feat(video): VideoComposer 参数面板（类型/首帧/时长/比例/分辨率/渠道）"
```

---

## Task 5: `VideoStage` 预览舞台

**Files:**
- Create: `src/components/video/parts/video-stage.tsx`

- [ ] **Step 1: 写组件**

`src/components/video/parts/video-stage.tsx`。按 `generation.status` 渲染空态/生成中/成功播放器/失败：

```tsx
"use client";

import { AlertTriangle, Download, Loader2, RotateCcw, Video } from "lucide-react";

import type { GenerationItem } from "@/components/create/types";

type VideoStageProps = {
  generation: GenerationItem | null;
  onDownload: (url: string) => void;
  onRetry: () => void;
};

export function VideoStage({ generation, onDownload, onRetry }: VideoStageProps) {
  if (!generation) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="flex flex-col items-center gap-3 text-center text-[var(--ink-soft)]/70">
          <Video className="size-12" />
          <p className="text-sm">在左侧输入提示词，开始生成你的第一段视频</p>
        </div>
      </div>
    );
  }

  const video = generation.videos?.[0];

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 overflow-y-auto p-6 md:p-10">
      <div className="flex w-full max-w-3xl flex-col items-center">
        {generation.status === "pending" && (
          <div className="flex aspect-video w-full flex-col items-center justify-center gap-4 rounded-2xl border border-[var(--line)] bg-[#1c1714] text-white/90">
            <Loader2 className="size-10 animate-spin text-[var(--accent)]" />
            <p className="text-sm">视频生成中，请稍候…</p>
            <p className="text-xs text-white/50">视频生成耗时较长，可切到其他标签页，完成后会自动更新</p>
          </div>
        )}

        {generation.status === "failed" && (
          <div className="flex aspect-video w-full flex-col items-center justify-center gap-4 rounded-2xl border border-rose-200 bg-rose-50/70 px-6 text-center">
            <AlertTriangle className="size-10 text-rose-500" />
            <p className="text-sm font-medium text-rose-700">{generation.errorMessage || "生成失败"}</p>
            <button
              type="button"
              onClick={onRetry}
              className="flex items-center gap-1.5 rounded-full border border-rose-300 bg-white px-4 py-2 text-xs font-semibold text-rose-600 transition hover:bg-rose-100"
            >
              <RotateCcw className="size-3.5" /> 用当前参数重试
            </button>
          </div>
        )}

        {generation.status === "succeeded" && video && (
          <>
            <video
              key={video.id}
              src={video.url}
              poster={video.posterUrl ?? undefined}
              controls
              playsInline
              className="w-full rounded-2xl border-[6px] border-white bg-black shadow-[0_18px_40px_rgba(84,52,29,0.18)]"
            />
            <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => onDownload(video.url)}
                className="flex items-center gap-1.5 rounded-full bg-[#5a4a3b] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[var(--accent)]"
              >
                <Download className="size-3.5" /> 下载
              </button>
            </div>
          </>
        )}

        {/* 提示词 */}
        <p className="mt-5 max-w-2xl text-center text-sm leading-relaxed text-[var(--ink-soft)]">
          {generation.prompt}
        </p>
      </div>
    </div>
  );
}
```

> 投稿作品广场按钮属计划三，本计划暂不放入；下载复用 `/api/proxy-image` 代理。

- [ ] **Step 2: Commit**

```bash
git add src/components/video/parts/video-stage.tsx
git commit -m "feat(video): VideoStage 预览舞台（生成中/成功播放/失败重试）"
```

---

## Task 6: `VideoHistoryRail` 底部时间线

**Files:**
- Create: `src/components/video/parts/video-history-rail.tsx`

- [ ] **Step 1: 写组件**

`src/components/video/parts/video-history-rail.tsx`。横向滚动缩略图 + 状态角标，点击切换预览：

```tsx
"use client";

/* eslint-disable @next/next/no-img-element */
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

import type { GenerationItem } from "@/components/create/types";

type VideoHistoryRailProps = {
  generations: GenerationItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export function VideoHistoryRail({ generations, selectedId, onSelect }: VideoHistoryRailProps) {
  if (generations.length === 0) {
    return (
      <div className="flex h-28 shrink-0 items-center justify-center border-t border-[var(--line)]/60 bg-[#f6efe6]/82 text-xs text-[var(--ink-soft)]/70">
        历史视频会显示在这里
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t border-[var(--line)]/60 bg-[#f6efe6]/82 px-4 py-3 backdrop-blur-md">
      <div className="premium-scrollbar flex gap-3 overflow-x-auto pb-1">
        {generations.map((generation) => {
          const video = generation.videos?.[0];
          const isSelected = generation.id === selectedId;
          return (
            <button
              key={generation.id}
              type="button"
              onClick={() => onSelect(generation.id)}
              title={generation.prompt}
              className={`relative h-16 w-24 shrink-0 overflow-hidden rounded-lg border-2 bg-[#cfc6b8] transition ${
                isSelected ? "border-[var(--accent)]" : "border-transparent hover:border-[var(--line)]"
              }`}
            >
              {video?.posterUrl ? (
                <img src={video.posterUrl} alt="视频封面" className="size-full object-cover" loading="lazy" />
              ) : video ? (
                <video src={video.url} muted playsInline className="size-full object-cover" />
              ) : null}
              <span className="absolute bottom-0.5 right-0.5">
                {generation.status === "succeeded" && <CheckCircle2 className="size-4 text-emerald-500" />}
                {generation.status === "pending" && <Loader2 className="size-4 animate-spin text-amber-500" />}
                {generation.status === "failed" && <XCircle className="size-4 text-rose-500" />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 类型自检（VideoStudio 依赖的三组件现已齐全）**

Run: `pnpm exec tsc --noEmit`
Expected: PASS（`/video/page.tsx`、`VideoStudio` 及三个 parts 全部解析）。

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: 无错误（如有 `import` 排序等告警按 ESLint 提示修正）。

- [ ] **Step 4: Commit**

```bash
git add src/components/video/parts/video-history-rail.tsx
git commit -m "feat(video): VideoHistoryRail 底部历史时间线"
```

---

## Task 7: 导航入口与手动验收

**Files:**
- Modify: `src/components/marketing/site-header.tsx`

- [ ] **Step 1: SiteHeader 加 `/video` 入口**

`src/components/marketing/site-header.tsx:32-40`，在 `links` 数组的「创作台」之后插入「视频」：

```ts
  const links = [
    { href: "/", label: "首页" },
    { href: "/create", label: "创作台" },
    { href: "/video", label: "视频" },
    { href: "/works", label: "作品" },
    ...(currentUser ? [{ href: "/api-keys", label: "API" }] : []),
    ...(currentUser?.role === "admin"
      ? [{ href: "/admin", label: "管理后台" }]
      : []),
  ];
```

> `MobileNav` 接收同一个 `links` 数组，移动端入口自动同步，无需另改。

- [ ] **Step 2: 类型自检 + Lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: 全部通过。

- [ ] **Step 3: 本地手动验收**

Run: `pnpm dev`，登录后访问 `http://localhost:3000/video`。逐项确认：
- 顶部导航出现「视频」且高亮；页面呈现「左参数 · 中预览 · 底部时间线」。
- 文生视频：输入提示词 → 生成 → 预览区显示「生成中」→ 轮询完成后播放 mp4。
- 图生视频：切换类型 → 上传首帧 → 生成 → 完成播放。
- 历史时间线出现新任务缩略图与状态角标，点击可切换预览。
- 下载按钮可保存 mp4；失败任务显示错误与「重试」。

> 需要计划一已部署且配置了可用视频渠道（spec §14）。无渠道时可先确认 UI 流转与错误态（提交后任务转 `failed` 并退积分）。

- [ ] **Step 4: Commit**

```bash
git add src/components/marketing/site-header.tsx
git commit -m "feat(video): 顶部导航新增视频工作区入口"
```

---

## Self-Review（已执行）

- **Spec 覆盖（阶段 4，spec §9）：** `/video` 页面→Task 2；左参数面板→Task 4；中预览舞台→Task 5；底部时间线→Task 6；轮询复用 `useImagePoller`→Task 3（直接 import，未改其逻辑）；导航入口→Task 7；`serializeGeneration` 的 `videos` 输出已在计划一落地，本计划在 `GenerationItem`（Task 1）与各组件消费。
- **占位符扫描：** 无 TBD/TODO；page、容器、三组件、常量均为可运行实现。视觉细节按粒度声明允许微调。
- **类型一致性：** `VideoChannelInfo`（含 `videoCreditCost`）在 page 序列化、VideoStudio props、VideoComposer props 一致；`GenerationItem.videos` 形状与计划一 `SerializedGeneration.videos` 一致（`id/url/posterUrl/width/height/durationSeconds`）；`generationType` 在 VideoStudio 收窄为 `"text_to_video" | "image_to_video"`，提交时与 `/api/generate` zod 枚举一致；`resolveVideoSize(aspectRatio, resolution)` 签名在 constants 定义与 VideoStudio 调用一致。
- **复用而非重写：** 轮询、`Alert`、`/api/proxy-image` 下载、设计 token 全部复用；未触碰 `create` 的运行逻辑（仅给 `GenerationItem` 加可选字段）。
- **已知假设：** 视频较大，`<video>` 直接加载线上 mp4；移动端布局（三区在窄屏的堆叠）为基础实现，可在验收后按需优化。
