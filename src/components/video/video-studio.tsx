"use client";

// 视频工作区容器：左参数面板 · 中预览舞台 · 底部历史时间线。
// 复用 create 的 useImagePoller（仅看 status，媒体类型无关）；提交沿用 /api/generate。
import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { useImagePoller } from "@/components/create/hooks/use-image-poller";
import type { GenerationItem, StudioTurnstile, ViewerUser } from "@/components/create/types";
import type { GenerationType } from "@/lib/types";
import {
  TurnstileWidget,
  type TurnstileWidgetHandle,
} from "@/components/auth/turnstile-widget";

import { resolveVideoSize } from "./constants";
import type { VideoAspectRatio, VideoChannelInfo, VideoReferenceImage, VideoResolution } from "./types";
import { VideoComposer } from "./parts/video-composer";
import { VideoStage } from "./parts/video-stage";
import { VideoHistoryRail } from "./parts/video-history-rail";

type VideoStudioProps = {
  currentUser: ViewerUser;
  initialGenerations?: GenerationItem[];
  channels?: VideoChannelInfo[];
  turnstile?: StudioTurnstile | null;
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
  turnstile = null,
}: VideoStudioProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileWidgetRef = useRef<TurnstileWidgetHandle>(null);
  const needsTurnstile = Boolean(
    turnstile?.isEnabled && turnstile?.siteKey && turnstile?.protectGenerate,
  );

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
    if (updated.status !== "pending") {
      router.refresh();
    }
  }, [router]);
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

  const canSubmit =
    Boolean(prompt.trim()) &&
    (generationType === "text_to_video" || referenceImage !== null) &&
    (!needsTurnstile || turnstileToken !== null);

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
        if (turnstileToken) formData.append("turnstileToken", turnstileToken);
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
            turnstileToken: turnstileToken || undefined,
          }),
        });
      }

      // Turnstile token 一次性有效，无论成败都要重置以便下次提交
      if (needsTurnstile) {
        setTurnstileToken(null);
        turnstileWidgetRef.current?.reset();
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
      router.refresh();
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
          turnstileSlot={
            needsTurnstile && turnstile?.siteKey ? (
              <TurnstileWidget
                ref={turnstileWidgetRef}
                siteKey={turnstile.siteKey}
                onVerify={(token) => setTurnstileToken(token)}
                onExpire={() => setTurnstileToken(null)}
                onError={() => setTurnstileToken(null)}
              />
            ) : undefined
          }
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
