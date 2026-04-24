/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { ArrowUpRight, User } from "lucide-react";

type Work = {
  authorAvatar: string | null;
  authorName: string;
  id: string;
  image: string;
  prompt: string;
  title: string;
};

export function FeaturedGallery({ works }: { works: Work[] }) {
  return (
    <div className="columns-1 space-y-5 gap-5 sm:columns-2 lg:columns-3 xl:columns-4">
      {works.map((work, index) => (
        <Link
          key={`${work.id}-${index}`}
          href={`/works/${work.id}`}
          className="studio-card group relative block break-inside-avoid overflow-hidden rounded-[1.5rem]"
        >
          <img
            src={work.image}
            alt={work.title}
            className="w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[var(--ink)]/85 via-[var(--ink)]/20 to-transparent opacity-70 transition-opacity duration-300 group-hover:opacity-100" />
          <div className="absolute bottom-0 left-0 right-0 flex items-end justify-between gap-4 p-5">
            <div className="min-w-0 flex-1">
              {/* 作者信息 */}
              <div className="mb-2 flex items-center gap-2">
                <div className="size-6 shrink-0 overflow-hidden rounded-full border border-white/30 bg-white/15">
                  {work.authorAvatar ? (
                    <img
                      src={work.authorAvatar}
                      alt={work.authorName}
                      className="size-full object-cover"
                    />
                  ) : (
                    <div className="flex size-full items-center justify-center">
                      <User className="size-3.5 text-white/80" />
                    </div>
                  )}
                </div>
                <span className="truncate text-xs font-medium text-white/90">
                  {work.authorName}
                </span>
              </div>
              <h3 className="truncate font-semibold text-white">{work.title}</h3>
              <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-white/80">
                {work.prompt}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-white/15 p-2.5 text-white backdrop-blur-sm transition group-hover:-translate-y-0.5 group-hover:bg-white/25">
              <ArrowUpRight className="size-5" />
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}
