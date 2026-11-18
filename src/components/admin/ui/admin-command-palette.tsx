"use client";

import { ArrowRight, Search, X } from "lucide-react";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";
import { ADMIN_COMMAND_ITEMS, type AdminCommandItem } from "../constants";

type AdminCommandPaletteProps = {
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

export function AdminCommandPalette({
  onOpenChange,
  open,
}: AdminCommandPaletteProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    function handleGlobalKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(!open);
      } else if (event.key === "Escape" && open) {
        event.preventDefault();
        onOpenChange(false);
      }
    }

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [onOpenChange, open]);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = setTimeout(() => {
      inputRef.current?.focus();
    }, 10);
    return () => {
      clearTimeout(focusTimer);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  const filteredItems = useMemo<AdminCommandItem[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ADMIN_COMMAND_ITEMS;
    return ADMIN_COMMAND_ITEMS.filter((item) => {
      if (item.label.toLowerCase().includes(q)) return true;
      if (item.description.toLowerCase().includes(q)) return true;
      if (item.group.toLowerCase().includes(q)) return true;
      return item.keywords.some((kw) => kw.toLowerCase().includes(q));
    });
  }, [query]);

  const safeIndex =
    filteredItems.length === 0
      ? 0
      : Math.min(selectedIndex, filteredItems.length - 1);

  function closePalette() {
    setQuery("");
    setSelectedIndex(0);
    onOpenChange(false);
  }

  function handleSelect(item: AdminCommandItem) {
    closePalette();
    router.push(item.href);
  }

  function handleListKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (filteredItems.length > 0) {
        setSelectedIndex((prev) => (prev + 1) % filteredItems.length);
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (filteredItems.length > 0) {
        setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % filteredItems.length);
      }
    } else if (event.key === "Enter") {
      const target = filteredItems[safeIndex];
      if (target) {
        event.preventDefault();
        handleSelect(target);
      }
    }
  }

  if (typeof document === "undefined" || !open) return null;

  return createPortal(
    <motion.div
      key="admin-cmd-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className="fixed inset-0 z-[110] flex items-start justify-center bg-black/50 px-4 pt-[12vh] backdrop-blur-[3px]"
      onClick={closePalette}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: -8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        role="dialog"
        aria-modal="true"
        aria-label="后台快捷跳转面板"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleListKeyDown}
        className="admin-floating-surface flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl"
      >
        <div className="flex items-center gap-3 border-b border-[var(--line)] bg-white px-4 py-3.5">
          <Search className="size-4 shrink-0 text-[#9e5322]" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
            }}
            placeholder="输入模块名称或关键词快速跳转（例如：渠道、用户、存储、敏感词）…"
            className="min-w-0 flex-1 border-none bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-soft)]/65"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setSelectedIndex(0);
                inputRef.current?.focus();
              }}
              aria-label="清空输入"
              className="rounded-lg p-1 text-[var(--ink-soft)] hover:bg-black/5 hover:text-[var(--ink)]"
            >
              <X className="size-4" aria-hidden />
            </button>
          ) : (
            <kbd className="rounded-md border border-[var(--line)] bg-[#f7f3ec] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ink-soft)]">
              ESC
            </kbd>
          )}
        </div>

        <div className="premium-scrollbar flex-1 overflow-y-auto p-2">
          {filteredItems.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-[var(--ink-soft)]">
              未找到与「{query}」匹配的后台模块
            </div>
          ) : (
            <div className="grid gap-1">
              {filteredItems.map((item, index) => {
                const Icon = item.icon;
                const active = index === safeIndex;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onMouseEnter={() => setSelectedIndex(index)}
                    onClick={() => handleSelect(item)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                      active
                        ? "bg-[#f9e6df] text-[#292524]"
                        : "text-[var(--ink)] hover:bg-[#f5eee3]",
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className={cn(
                          "grid size-8 shrink-0 place-items-center rounded-lg",
                          active
                            ? "bg-white text-[#c25934] shadow-2xs"
                            : "bg-[#f6efe3] text-[#9e5322]",
                        )}
                      >
                        <Icon className="size-4" aria-hidden />
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "truncate text-sm",
                              active ? "font-semibold text-[#c25934]" : "font-medium",
                            )}
                          >
                            {item.label}
                          </span>
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[10px]",
                              active
                                ? "bg-white/85 font-medium text-[#c25934]"
                                : "bg-black/5 text-[var(--ink-soft)]",
                            )}
                          >
                            {item.group}
                          </span>
                        </div>
                        <p
                          className={cn(
                            "mt-0.5 truncate text-xs",
                            active ? "text-[#6e655e]" : "text-[var(--ink-soft)]",
                          )}
                        >
                          {item.description}
                        </p>
                      </div>
                    </div>
                    <ArrowRight
                      className={cn(
                        "size-4 shrink-0 transition-transform",
                        active ? "translate-x-0.5 text-[#c25934]" : "text-[var(--ink-soft)]/40",
                      )}
                      aria-hidden
                    />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--line)] bg-[#faf6ee] px-4 py-2 text-[11px] text-[var(--ink-soft)]">
          <span>↑ ↓ 选择模块 · Enter 跳转</span>
          <span className="font-mono">Ctrl / ⌘ + K</span>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
