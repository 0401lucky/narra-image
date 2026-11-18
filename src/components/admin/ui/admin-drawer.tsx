"use client";

import { X } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

type AdminDrawerWidth = "md" | "lg" | "xl";

type AdminDrawerProps = {
  busy?: boolean;
  children: ReactNode;
  description?: string;
  eyebrow?: string;
  footer?: ReactNode;
  onClose: () => void;
  open: boolean;
  title: string;
  width?: AdminDrawerWidth;
};

const widthClasses: Record<AdminDrawerWidth, string> = {
  lg: "max-w-2xl",
  md: "max-w-xl",
  xl: "max-w-3xl",
};

export function AdminDrawer({
  busy = false,
  children,
  description,
  eyebrow,
  footer,
  onClose,
  open,
  title,
  width = "lg",
}: AdminDrawerProps) {
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) {
        event.stopPropagation();
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [busy, onClose, open]);

  if (typeof document === "undefined" || !open) return null;

  return createPortal(
    <motion.div
      key="admin-drawer-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="fixed inset-0 z-[100] flex justify-end bg-black/45 backdrop-blur-[2px]"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        transition={{ damping: 30, stiffness: 300, type: "spring" }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        onClick={(event) => event.stopPropagation()}
        className={cn(
          "admin-floating-surface flex h-full w-full flex-col border-l border-[var(--line)] shadow-2xl",
          widthClasses[width],
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--line)] bg-white/85 px-6 py-4">
          <div className="min-w-0">
            {eyebrow ? (
              <p className="text-[11px] font-semibold tracking-wider text-[#9e5322] uppercase">
                {eyebrow}
              </p>
            ) : null}
            <h2 id={titleId} className="mt-0.5 truncate text-lg font-semibold text-[var(--ink)]">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="mt-1 text-xs leading-relaxed text-[var(--ink-soft)]">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            aria-label="关闭抽屉"
            className="grid size-8 shrink-0 place-items-center rounded-xl text-[var(--ink-soft)] transition hover:bg-black/5 hover:text-[var(--ink)] disabled:opacity-50"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div className="premium-scrollbar flex-1 overflow-y-auto px-6 py-5">
          {children}
        </div>

        {footer ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] bg-[#faf6ee]/85 px-6 py-3.5">
            {footer}
          </div>
        ) : null}
      </motion.div>
    </motion.div>,
    document.body,
  );
}
