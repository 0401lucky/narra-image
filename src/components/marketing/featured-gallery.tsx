"use client";

import { useState } from "react";
import { X, ZoomIn } from "lucide-react";

type Work = {
  id: string;
  image: string;
  prompt: string;
  title: string;
};

export function FeaturedGallery({ works }: { works: Work[] }) {
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);

  return (
    <>
      <div className="columns-1 gap-5 sm:columns-2 lg:columns-3 xl:columns-4 space-y-5">
        {works.map((work, index) => (
          <article
            key={`${work.id}-${index}`}
            className="studio-card group relative break-inside-avoid overflow-hidden rounded-[1.5rem]"
          >
            <img src={work.image} alt={work.title} className="w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]" />
            <div className="absolute inset-0 bg-gradient-to-t from-[var(--ink)]/80 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
            <div className="absolute bottom-0 left-0 right-0 p-5 opacity-0 transition-all duration-300 group-hover:opacity-100 flex items-end justify-between gap-4">
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-white truncate">{work.title}</h3>
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-white/80">
                  {work.prompt}
                </p>
              </div>
              <button 
                type="button"
                onClick={() => setZoomedImage(work.image)}
                className="shrink-0 rounded-full bg-white/20 p-2.5 text-white backdrop-blur-sm transition hover:bg-white/40 hover:scale-110 translate-y-4 group-hover:translate-y-0 duration-300 delay-100"
                title="放大查看"
              >
                <ZoomIn className="size-5" />
              </button>
            </div>
          </article>
        ))}
      </div>

      {zoomedImage && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={() => setZoomedImage(null)}
        >
          <button 
            type="button"
            className="absolute top-6 right-6 text-white/70 transition hover:text-white hover:scale-110"
            onClick={() => setZoomedImage(null)}
            title="关闭"
          >
            <X className="size-8" />
          </button>
          <img 
            src={zoomedImage} 
            alt="Zoomed" 
            className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()} 
          />
        </div>
      )}
    </>
  );
}
