"use client";

/* eslint-disable @next/next/no-img-element */

// 右侧历史图片栏：静态滚动缩略图列表，点击复用 zoomedImage 放大遮罩。
// 仅桌面端展示（hidden md:flex），移动端不出现。
import { getThumbUrl } from "@/lib/image-url";

type HistoryRailItem = {
  id: string;
  url: string;
  createdAt: string;
};

type HistoryRailProps = {
  images: HistoryRailItem[];
  onPickImage: (url: string) => void;
};

export function HistoryRail({ images, onPickImage }: HistoryRailProps) {
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
        <div className="flex-1 overflow-y-auto pb-3" style={{ scrollbarWidth: "thin" }}>
          <div className="flex flex-col gap-3">
            {images.map((image) => (
              <button
                key={image.id}
                type="button"
                onClick={() => onPickImage(image.url)}
                className="group block w-full overflow-hidden rounded-2xl border-[6px] border-white bg-[#fffaf2] shadow-[0_14px_30px_rgba(84,52,29,0.12)] transition hover:-translate-y-0.5 hover:border-[#fff4e5] hover:shadow-[0_18px_36px_rgba(84,52,29,0.16)]"
                title="点击放大查看"
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
    </aside>
  );
}
