"use client";

/* eslint-disable @next/next/no-img-element */
import { useState } from "react";

type MyVideoItem = {
  id: string;
  url: string;
  posterUrl: string | null;
  showcaseStatus: "PRIVATE" | "PENDING" | "FEATURED" | "TAKEDOWN_PENDING";
};

const STATUS_LABEL: Record<MyVideoItem["showcaseStatus"], string> = {
  PRIVATE: "私有",
  PENDING: "待审核",
  FEATURED: "已公开",
  TAKEDOWN_PENDING: "待下架审核",
};

export function VideoWorksSection({ initialVideos }: { initialVideos: MyVideoItem[] }) {
  const [videos, setVideos] = useState(initialVideos);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function act(id: string, action: "submit" | "withdraw") {
    setBusyId(id);
    try {
      const res = await fetch(`/api/me/works/${id}/showcase`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, mediaType: "video", showPromptPublic: true }),
      });
      if (res.ok) {
        setVideos((cur) =>
          cur.map((v) =>
            v.id === id
              ? { ...v, showcaseStatus: action === "submit" ? "PENDING" : "PRIVATE" }
              : v,
          ),
        );
      }
    } finally {
      setBusyId(null);
    }
  }

  if (videos.length === 0) {
    return <p className="text-sm text-[var(--ink-soft)]">还没有视频作品，去 /video 生成一段吧。</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {videos.map((video) => (
        <div key={video.id} className="studio-card overflow-hidden p-0">
          <div className="relative aspect-video bg-[#1c1714]">
            {video.posterUrl ? (
              <img src={video.posterUrl} alt="视频" className="size-full object-cover" />
            ) : (
              <video src={video.url} muted playsInline preload="metadata" className="size-full object-cover" />
            )}
          </div>
          <div className="flex items-center justify-between gap-2 p-2.5">
            <span className="text-xs text-[var(--ink-soft)]">{STATUS_LABEL[video.showcaseStatus]}</span>
            {video.showcaseStatus === "PRIVATE" && (
              <button
                type="button"
                disabled={busyId === video.id}
                onClick={() => act(video.id, "submit")}
                className="rounded-full bg-[#5a4a3b] px-3 py-1 text-xs font-semibold text-white transition hover:bg-[var(--accent)] disabled:opacity-50"
              >
                投稿
              </button>
            )}
            {video.showcaseStatus === "PENDING" && (
              <button
                type="button"
                disabled={busyId === video.id}
                onClick={() => act(video.id, "withdraw")}
                className="rounded-full border border-[var(--line)] px-3 py-1 text-xs font-semibold text-[var(--ink-soft)] transition hover:bg-[#f7efe4] disabled:opacity-50"
              >
                撤回
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
