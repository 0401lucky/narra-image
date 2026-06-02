"use client";

/* eslint-disable @next/next/no-img-element */

// 右侧历史图片栏：静态滚动缩略图列表，点击复用 zoomedImage 放大遮罩。
// 仅桌面端展示（hidden md:flex），移动端不出现。
import { ImagePlus, SlidersHorizontal, ZoomIn } from "lucide-react";
import { useEffect, useState, type DragEvent, type MouseEvent } from "react";

import { getThumbUrl } from "@/lib/image-url";

import { HISTORY_IMAGE_DRAG_MIME } from "../constants";
import type { GenerationItem } from "../types";

type HistoryRailItem = {
  id: string;
  url: string;
  createdAt: string;
  generation: GenerationItem;
};

type HistoryRailProps = {
  images: HistoryRailItem[];
  onPickImage: (url: string) => void;
  onUseForEdit?: (url: string) => void;
  onReuseConfig?: (generation: GenerationItem) => void;
};

type ContextMenuState = {
  image: HistoryRailItem;
  x: number;
  y: number;
} | null;

export function HistoryRail({ images, onPickImage, onUseForEdit, onReuseConfig }: HistoryRailProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);

  useEffect(() => {
    if (!contextMenu) return;

    function closeMenu() {
      setContextMenu(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenu();
    }

    window.addEventListener("click", closeMenu);
    window.addEventListener("contextmenu", closeMenu);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("contextmenu", closeMenu);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  function handleContextMenu(event: MouseEvent<HTMLButtonElement>, image: HistoryRailItem) {
    event.preventDefault();
    event.stopPropagation();

    setContextMenu({
      image,
      x: Math.min(event.clientX, window.innerWidth - 184),
      y: Math.min(event.clientY, window.innerHeight - 132),
    });
  }

  function handleDragStart(event: DragEvent<HTMLButtonElement>, image: HistoryRailItem) {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(HISTORY_IMAGE_DRAG_MIME, image.url);
    event.dataTransfer.setData("text/uri-list", image.url);
    event.dataTransfer.setData("text/plain", image.url);
  }

  return (
    <aside className="hidden h-full w-72 shrink-0 flex-col overflow-hidden bg-[#f6efe6]/82 px-4 py-5 backdrop-blur-xl md:flex xl:w-80">
      <div className="mb-4 flex items-center justify-between border-b border-[var(--line)] pb-4">
        <h3 className="text-base font-semibold text-[#24170f]">历史图片</h3>
        <span className="text-xs text-[var(--ink-soft)]/70">最近生成</span>
      </div>
      {images.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-[var(--line)] bg-[#fffaf2]/45 px-4 text-center">
          <p className="text-xs leading-relaxed text-[var(--ink-soft)]/70">
            还没有作品
            <br />
            先生成一张吧
          </p>
        </div>
      ) : (
        <div className="premium-scrollbar flex-1 overflow-y-auto pb-3">
          <div className="flex flex-col gap-3">
            {images.map((image) => (
              <button
                key={image.id}
                type="button"
                draggable
                onClick={() => onPickImage(image.url)}
                onContextMenu={(event) => handleContextMenu(event, image)}
                onDragStart={(event) => handleDragStart(event, image)}
                className="group block w-full overflow-hidden rounded-2xl border-[6px] border-white bg-[#fffaf2] shadow-[0_14px_30px_rgba(84,52,29,0.12)] transition hover:-translate-y-0.5 hover:border-[#fff4e5] hover:shadow-[0_18px_36px_rgba(84,52,29,0.16)]"
                title="点击放大查看，右键可复用配置"
              >
                <img
                  src={getThumbUrl(image.url, 256)}
                  alt="历史图片"
                  loading="lazy"
                  decoding="async"
                  className="block h-auto w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                />
              </button>
            ))}
          </div>
        </div>
      )}
      {contextMenu && (
        <div
          className="fixed z-50 w-44 overflow-hidden rounded-xl border border-[var(--line)] bg-[#fffaf2]/96 p-1.5 text-sm shadow-[0_18px_44px_rgba(36,23,15,0.22)] backdrop-blur-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onPickImage(contextMenu.image.url);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[#3a281d] transition hover:bg-[#f3eadc]"
          >
            <ZoomIn className="size-4" />
            放大查看
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onUseForEdit?.(contextMenu.image.url);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[#3a281d] transition hover:bg-[#f3eadc]"
          >
            <ImagePlus className="size-4" />
            加入编辑
          </button>
          {onReuseConfig && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onReuseConfig(contextMenu.image.generation);
                setContextMenu(null);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[#3a281d] transition hover:bg-[#f3eadc]"
            >
              <SlidersHorizontal className="size-4" />
              复用配置
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
