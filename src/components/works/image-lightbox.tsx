"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { getThumbUrl } from "@/lib/image-url";

type ImageLightboxProps = {
  alt?: string;
  children?: ReactNode;
  onClose: () => void;
  src: string;
};

export function ImageLightbox({
  alt = "作品大图",
  children,
  onClose,
  src,
}: ImageLightboxProps) {
  const displaySrc = getThumbUrl(src, 1920, 90);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsMounted(true), 0);
    return () => clearTimeout(timer);
  }, []);

  if (!isMounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex select-none items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        type="button"
        className="absolute right-5 top-5 inline-flex size-11 items-center justify-center rounded-full border border-white/35 bg-black/65 text-white shadow-[0_12px_30px_rgba(0,0,0,0.35)] backdrop-blur-md transition hover:scale-105 hover:bg-white hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        aria-label="关闭大图"
        title="关闭"
      >
        <X className="size-6" strokeWidth={2.6} />
      </button>
      <div
        className="flex max-h-[90vh] max-w-[90vw] flex-col items-center gap-4"
        onClick={(event) => event.stopPropagation()}
      >
        <img
          src={displaySrc}
          alt={alt}
          decoding="async"
          draggable={false}
          onDragStart={(event) => event.preventDefault()}
          className="max-h-[82vh] max-w-[90vw] select-none rounded-[1.5rem] object-contain shadow-2xl"
        />
        {children ? <div>{children}</div> : null}
      </div>
    </div>,
    document.body
  );
}
