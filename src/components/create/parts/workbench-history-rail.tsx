"use client";

/* eslint-disable @next/next/no-img-element */

// 左栏「生成记录」列表（桌面端固定侧栏，平板/手机端滑出抽屉）。
import {
  AlertCircle,
  CheckSquare,
  Clock3,
  ImageOff,
  Loader2,
  PanelLeftClose,
  Plus,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { getThumbUrl } from "@/lib/image-url";
import { isImageAvailable } from "@/lib/storage/image-availability";
import { cn } from "@/lib/utils";

import type { GenerationItem } from "../types";
import { getGenerationSourceImageUrls } from "../utils";

type WorkbenchHistoryRailProps = {
  records: GenerationItem[];
  selectedId: string | null;
  checkedIds: ReadonlySet<string>;
  allChecked: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  loadError: string | null;
  hiding: boolean;
  notice: string | null;
  open: boolean;
  onClose: () => void;
  onNewDraft: () => void;
  onSelectRecord: (id: string) => void;
  onToggleCheck: (id: string) => void;
  onToggleSelectAll: () => void;
  onDeleteSelected: () => void;
  onDeleteSingle: (id: string) => void;
  onLoadMore: () => void;
  onDismissNotice: () => void;
};

function formatDurationShort(ms: number | null | undefined) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return null;
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}秒`;
  if (seconds === 0) return `${minutes}分钟`;
  return `${minutes}分${seconds}秒`;
}

function formatRecordTimestamp(dateStr: string) {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "";
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd} ${hh}:${min}`;
}

export function WorkbenchHistoryRail({
  records,
  selectedId,
  checkedIds,
  allChecked,
  hasMore,
  loadingMore,
  loadError,
  hiding,
  notice,
  open,
  onClose,
  onNewDraft,
  onSelectRecord,
  onToggleCheck,
  onToggleSelectAll,
  onDeleteSelected,
  onDeleteSingle,
  onLoadMore,
  onDismissNotice,
}: WorkbenchHistoryRailProps) {
  const checkedCount = checkedIds.size;

  return (
    <>
      {open && (
        <div
          aria-hidden
          onClick={onClose}
          className="fixed inset-0 z-30 bg-[#21170f]/30 backdrop-blur-[1px] lg:hidden"
        />
      )}

      <aside
        aria-label="生成记录"
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex h-full w-[288px] shrink-0 flex-col border-r border-[var(--line)] bg-[#f6efe5]/96 backdrop-blur-xl transition-transform duration-200 ease-out lg:relative lg:z-0 lg:w-[264px] lg:translate-x-0 lg:bg-[#f6efe5]/78 xl:w-[292px]",
          open ? "translate-x-0 shadow-2xl lg:shadow-none" : "-translate-x-full",
        )}
      >
        <div className="shrink-0 border-b border-[var(--line)]/70 px-3.5 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold tracking-tight text-[var(--ink)]">生成记录</h2>
              <span className="rounded-full border border-[var(--line)] bg-[#fffaf2] px-2 py-0.5 text-[11px] font-medium text-[var(--ink-soft)]">
                {records.length}
              </span>
            </div>
            <button
              type="button"
              aria-label="关闭生成记录"
              onClick={onClose}
              className="rounded-lg p-1.5 text-[var(--ink-soft)] transition hover:bg-white/70 hover:text-[var(--ink)] lg:hidden"
            >
              <PanelLeftClose aria-hidden className="size-4" />
            </button>
          </div>

          <div className="mt-2.5 flex items-center gap-1.5">
            <button
              type="button"
              onClick={onNewDraft}
              className="inline-flex h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-[#24170f] px-2.5 text-xs font-semibold text-white shadow-[0_8px_18px_rgba(36,23,15,0.16)] transition hover:bg-[var(--accent)]"
            >
              <Plus aria-hidden className="size-3.5" />
              新建
            </button>
            <button
              type="button"
              disabled={records.length === 0}
              onClick={onToggleSelectAll}
              className={cn(
                "inline-flex h-8 cursor-pointer items-center justify-center gap-1 rounded-xl border px-2.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-45",
                allChecked
                  ? "border-[var(--accent)] bg-[#fff4e8] text-[var(--accent)]"
                  : "border-[var(--line)] bg-[#fffaf2]/80 text-[var(--ink-soft)] hover:border-[#c78f55] hover:text-[var(--ink)]",
              )}
            >
              {allChecked ? (
                <CheckSquare aria-hidden className="size-3.5" />
              ) : (
                <Square aria-hidden className="size-3.5" />
              )}
              全选
            </button>
            <button
              type="button"
              disabled={checkedCount === 0 || hiding}
              onClick={onDeleteSelected}
              className="inline-flex h-8 cursor-pointer items-center justify-center gap-1 rounded-xl border border-[var(--line)] bg-[#fffaf2]/80 px-2.5 text-xs font-medium text-[var(--ink-soft)] transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Trash2 aria-hidden className="size-3.5" />
              {checkedCount > 0 ? `删除(${checkedCount})` : "删除"}
            </button>
          </div>
        </div>

        {(notice || loadError) && (
          <div className="shrink-0 space-y-2 border-b border-[var(--line)]/60 px-3 py-2.5">
            {notice && (
              <Alert variant="warning" onDismiss={onDismissNotice} className="px-3 py-2 text-xs">
                {notice}
              </Alert>
            )}
            {loadError && (
              <Alert variant="error" className="px-3 py-2 text-xs">
                <span>{loadError}</span>
                <button
                  type="button"
                  onClick={onLoadMore}
                  className="ml-2 font-semibold underline"
                >
                  重试
                </button>
              </Alert>
            )}
          </div>
        )}

        <div className="premium-scrollbar flex-1 overflow-y-auto px-3 py-3">
          {records.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--line)] bg-[#fffaf2]/55 px-4 py-10 text-center">
              <Sparkles aria-hidden className="mb-2 size-6 text-[var(--ink-soft)]/35" />
              <p className="text-xs font-medium text-[var(--ink)]">暂无生成记录</p>
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--ink-soft)]">
                在中间工作台输入提示词，点击「开始生成」即可在此查看每条任务。
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {records.map((record) => {
                const isSelected = record.id === selectedId;
                const isChecked = checkedIds.has(record.id);
                const firstImage = record.images[0] ?? null;
                const firstAvailable = firstImage && isImageAvailable(firstImage.availability);
                const isImageToImage = record.generationType === "image_to_image"
                  || getGenerationSourceImageUrls(record).length > 0;
                const duration = formatDurationShort(record.durationMs);
                const successCount = record.status === "succeeded" ? record.images.length : 0;

                return (
                  <li
                    key={record.id}
                    className={cn(
                      "group relative rounded-2xl border transition",
                      isSelected
                        ? "border-[#cf8f5a] bg-[#fffaf2] shadow-[0_10px_24px_rgba(84,52,29,0.1)] ring-1 ring-[#d9643a]/15"
                        : "border-[var(--line)]/70 bg-[#fffaf2]/58 hover:border-[#cfa27a] hover:bg-[#fffaf2]/92",
                    )}
                  >
                    <div className="flex items-start gap-2 p-2.5">
                      <label
                        className="mt-0.5 flex size-5 shrink-0 cursor-pointer items-center justify-center"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => onToggleCheck(record.id)}
                          aria-label={`选择记录 ${record.prompt.slice(0, 20) || record.id}`}
                          className="size-3.5 cursor-pointer rounded border-[var(--line)] accent-[var(--accent)]"
                        />
                      </label>

                      <button
                        type="button"
                        onClick={() => onSelectRecord(record.id)}
                        className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5 text-left"
                      >
                        <div className="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--line)]/80 bg-[#efe5d7]">
                          {record.status === "pending" ? (
                            <Sparkles aria-hidden className="size-4 animate-pulse text-[var(--accent)]" />
                          ) : record.status === "failed" ? (
                            <AlertCircle aria-hidden className="size-4 text-rose-500" />
                          ) : firstAvailable ? (
                            <img
                              src={getThumbUrl(firstImage.url, 128)}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              className="size-full object-cover"
                            />
                          ) : (
                            <ImageOff aria-hidden className="size-4 text-[var(--ink-soft)]/60" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-1.5">
                            <p className="line-clamp-1 text-xs font-semibold text-[var(--ink)]">
                              {record.prompt || "未命名生图任务"}
                            </p>
                          </div>

                          <div className="mt-1.5 flex flex-wrap items-center gap-1">
                            {record.status === "pending" ? (
                              <span className="inline-flex items-center gap-1 rounded-md border border-amber-300/70 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                                <Loader2 aria-hidden className="size-2.5 animate-spin" />
                                生成中
                              </span>
                            ) : record.status === "succeeded" ? (
                              <span className="rounded-md border border-emerald-200/90 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                                成功 {successCount}
                              </span>
                            ) : (
                              <span className="rounded-md border border-rose-200/90 bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600">
                                失败
                              </span>
                            )}

                            <span className="rounded-md bg-[#efe5d7]/80 px-1.5 py-0.5 text-[10px] font-medium text-[var(--ink-soft)]">
                              {record.count} 张
                            </span>

                            {duration && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] text-[var(--ink-soft)]">
                                <Clock3 aria-hidden className="size-2.5" />
                                {duration}
                              </span>
                            )}
                          </div>

                          <div className="mt-1 flex items-center gap-1.5">
                            <p className="text-[10px] tabular-nums text-[var(--ink-soft)]/80">
                              {formatRecordTimestamp(record.createdAt)}
                            </p>
                            {isImageToImage && (
                              <span className="rounded bg-[#f8e4d8] px-1 py-[1px] text-[9px] font-medium text-[#b54722]">
                                图生图
                              </span>
                            )}
                          </div>
                        </div>
                      </button>

                      {record.status !== "pending" && (
                        <button
                          type="button"
                          disabled={hiding}
                          aria-label={`删除记录 ${record.prompt.slice(0, 20) || record.id}`}
                          title="从生成记录中移除（作品页图片仍保留）"
                          onClick={(event) => {
                            event.stopPropagation();
                            onDeleteSingle(record.id);
                          }}
                          className="shrink-0 rounded-lg p-1 text-[var(--ink-soft)]/40 opacity-100 transition hover:bg-rose-50 hover:text-rose-600 focus:opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                        >
                          <Trash2 aria-hidden className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {hasMore && (
            <div className="mt-3 flex justify-center">
              <button
                type="button"
                disabled={loadingMore}
                onClick={onLoadMore}
                className="inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-[var(--line)] bg-[#fffaf2]/80 px-3 py-2 text-xs font-medium text-[var(--ink-soft)] transition hover:border-[#cfa27a] hover:bg-white hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loadingMore && <Loader2 aria-hidden className="size-3.5 animate-spin" />}
                {loadingMore ? "加载中..." : "加载更多记录"}
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
