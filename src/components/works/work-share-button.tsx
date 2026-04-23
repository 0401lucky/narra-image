"use client";

import { useState } from "react";

type WorkShareButtonProps = {
  url: string;
};

export function WorkShareButton({ url }: WorkShareButtonProps) {
  const [feedback, setFeedback] = useState<string | null>(null);

  async function copyLink() {
    if (!navigator.clipboard?.writeText) {
      setFeedback("当前浏览器不支持自动复制，请手动复制地址");
      return;
    }

    await navigator.clipboard.writeText(url);
    setFeedback("链接已复制，可直接发送给朋友");
  }

  async function handleShare() {
    setFeedback(null);

    if (navigator.share) {
      try {
        await navigator.share({
          text: "来看看这张作品",
          title: "Narra Image 作品",
          url,
        });
        return;
      } catch {
        await copyLink();
        return;
      }
    }

    await copyLink();
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={handleShare}
        className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-medium text-[var(--ink)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
      >
        分享作品
      </button>
      {feedback ? <p className="text-xs text-[var(--ink-soft)]">{feedback}</p> : null}
    </div>
  );
}
