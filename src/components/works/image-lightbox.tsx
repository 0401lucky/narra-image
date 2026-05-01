"use client";

/* eslint-disable @next/next/no-img-element */

import type { ReactNode } from "react";
import { X } from "lucide-react";

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
  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        type="button"
        className="absolute right-6 top-6 text-white/70 transition hover:text-white hover:scale-110"
        onClick={onClose}
        title="关闭"
      >
        <X className="size-8" />
      </button>
      <div
        className="flex max-h-[90vh] max-w-[90vw] flex-col items-center gap-4"
        onClick={(event) => event.stopPropagation()}
      >
        <img
          src={src}
          alt={alt}
          decoding="async"
          className="max-h-[82vh] max-w-[90vw] rounded-[1.5rem] object-contain shadow-2xl"
        />
        {children ? <div>{children}</div> : null}
      </div>
    </div>
  );
}
