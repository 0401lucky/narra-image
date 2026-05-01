/* eslint-disable @next/next/no-img-element */

import { getThumbUrl } from "@/lib/image-url";

type AuthCoverWork = {
  authorName: string;
  image: string;
  title: string;
};

type AuthCoverProps = {
  caption?: string;
  placement?: "left" | "right";
  work: AuthCoverWork | null;
};

export function AuthCover({
  caption,
  placement = "right",
  work,
}: AuthCoverProps) {
  const dividerClass = placement === "left" ? "border-r" : "border-l";

  return (
    <section
      className={`relative hidden overflow-hidden ${dividerClass} border-[var(--line)] bg-[var(--surface-strong)] lg:flex`}
    >
      {work?.image ? (
        <img
          src={getThumbUrl(work.image, 1080)}
          alt={work.title}
          decoding="async"
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <div className="relative flex flex-1 flex-col items-center justify-center gap-4 p-10 text-center">
          <span className="text-[11px] uppercase tracking-[0.32em] text-[var(--ink-soft)]">
            Narra Image
          </span>
          <p className="editorial-title text-5xl font-semibold leading-[1.05] text-[var(--ink)]">
            Tell stories
            <br />
            in pixels.
          </p>
          <p className="max-w-[18rem] text-sm leading-7 text-[var(--ink-soft)]">
            一个邀请制的 AI 图像创作社区，欢迎你成为最早一批用户。
          </p>
        </div>
      )}

      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/45 via-transparent to-transparent"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-[var(--accent)]/30 via-transparent to-transparent mix-blend-soft-light"
      />

      {work ? (
        <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-[var(--ink)]/85 via-[var(--ink)]/35 to-transparent p-6 text-white">
          {caption ? (
            <span className="text-[11px] uppercase tracking-[0.32em] text-white/80">
              {caption}
            </span>
          ) : null}
          <p className="mt-1 line-clamp-2 text-sm font-semibold leading-snug">
            {work.title}
          </p>
          <p className="mt-1 text-xs text-white/75">@{work.authorName}</p>
        </div>
      ) : null}
    </section>
  );
}
