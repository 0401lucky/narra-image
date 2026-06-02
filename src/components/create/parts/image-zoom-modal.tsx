"use client";

// 图片放大遮罩。完全独立的展示组件，无内部状态（除动画）。
import { Download, ImagePlus, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";

type ImageZoomModalProps = {
  src: string | null;
  meta?: {
    dimensionLabel?: string;
    ratioLabel?: string;
  } | null;
  onClose: () => void;
  onDownload: (url: string) => void;
  onUseForEdit: (url: string) => void;
};

export function ImageZoomModal({ src, meta, onClose, onDownload, onUseForEdit }: ImageZoomModalProps) {
  // 监听 Escape 关闭，弥补原实现只能点背景关闭的可访问性短板。
  useEffect(() => {
    if (!src) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [src, onClose]);

  return (
    <AnimatePresence>
      {src && (
        <motion.div
          key="zoomed-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex select-none items-center justify-center bg-black/80 p-4 backdrop-blur-md"
          onClick={onClose}
        >
          <button
            type="button"
            className="absolute right-5 top-5 inline-flex size-11 cursor-pointer items-center justify-center rounded-full border border-white/35 bg-black/65 text-white shadow-[0_12px_30px_rgba(0,0,0,0.35)] backdrop-blur-md transition hover:scale-105 hover:bg-white hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
            aria-label="关闭"
          >
            <X className="size-6" strokeWidth={2.6} />
          </button>
          <motion.img
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            src={src}
            alt="放大查看"
            decoding="async"
            draggable={false}
            onDragStart={(event) => event.preventDefault()}
            className="max-h-[90vh] max-w-[90vw] select-none rounded-xl object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          {meta && (
            <div className="absolute left-6 top-6 flex flex-wrap gap-2 text-xs font-medium text-white">
              {meta.dimensionLabel && (
                <span className="rounded-full bg-black/60 px-3 py-1.5 shadow-sm backdrop-blur-md">
                  {meta.dimensionLabel}
                </span>
              )}
              {meta.ratioLabel && (
                <span className="rounded-full bg-black/60 px-3 py-1.5 shadow-sm backdrop-blur-md">
                  {meta.ratioLabel}
                </span>
              )}
            </div>
          )}
          <div className="absolute bottom-8 flex items-center gap-4">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDownload(src);
              }}
              className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-white/20 px-6 py-3 text-sm font-medium text-white shadow-lg backdrop-blur-md transition-all duration-200 ease-out hover:bg-[var(--accent)] hover:shadow-xl"
            >
              <Download className="size-4" />
              保存高清原图
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUseForEdit(src);
                onClose();
              }}
              className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-medium text-black shadow-lg transition-all duration-200 ease-out hover:bg-[var(--accent)] hover:text-white hover:shadow-xl"
            >
              <ImagePlus className="size-4" />
              加入编辑
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
