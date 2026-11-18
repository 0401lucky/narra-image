"use client";

import { AlertTriangle, Loader2, X } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

type AdminModalSize = "sm" | "md" | "lg" | "xl";

type AdminModalProps = {
  busy?: boolean;
  children: ReactNode;
  className?: string;
  description?: string;
  eyebrow?: string;
  footer?: ReactNode;
  onClose: () => void;
  open: boolean;
  preventOutsideClose?: boolean;
  size?: AdminModalSize;
  title: string;
};

const sizeClasses: Record<AdminModalSize, string> = {
  lg: "max-w-2xl",
  md: "max-w-lg",
  sm: "max-w-md",
  xl: "max-w-4xl",
};

export function AdminModal({
  busy = false,
  children,
  className,
  description,
  eyebrow,
  footer,
  onClose,
  open,
  preventOutsideClose = false,
  size = "md",
  title,
}: AdminModalProps) {
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
      key="admin-modal-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[3px]"
      onClick={() => {
        if (!busy && !preventOutsideClose) {
          onClose();
        }
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        onClick={(event) => event.stopPropagation()}
        className={cn(
          "admin-floating-surface relative flex max-h-[88vh] w-full flex-col overflow-hidden rounded-[1.5rem]",
          sizeClasses[size],
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--line)] bg-white/70 px-6 py-4">
          <div className="min-w-0">
            {eyebrow ? (
              <p className="text-[11px] font-semibold tracking-wider text-[#9e5322] uppercase">
                {eyebrow}
              </p>
            ) : null}
            <h3 id={titleId} className="text-lg font-semibold text-[var(--ink)]">
              {title}
            </h3>
            {description ? (
              <p id={descId} className="mt-1 text-sm leading-relaxed text-[var(--ink-soft)]">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            aria-label="关闭弹窗"
            className="grid size-8 shrink-0 place-items-center rounded-xl text-[var(--ink-soft)] transition hover:bg-black/5 hover:text-[var(--ink)] disabled:opacity-50"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div className="premium-scrollbar flex-1 overflow-y-auto px-6 py-5">
          {children}
        </div>

        {footer ? (
          <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-[var(--line)] bg-[#faf6ee]/75 px-6 py-4">
            {footer}
          </div>
        ) : null}
      </motion.div>
    </motion.div>,
    document.body,
  );
}

export type AdminConfirmTone = "danger" | "warning" | "primary";

type AdminConfirmDialogProps = {
  busy?: boolean;
  cancelLabel?: string;
  children?: ReactNode;
  confirmLabel?: string;
  description: string;
  error?: string | null;
  onClose: () => void;
  onConfirm: () => void;
  open: boolean;
  title: string;
  tone?: AdminConfirmTone;
};

const confirmToneStyles: Record<AdminConfirmTone, string> = {
  danger: "bg-rose-600 text-white hover:bg-rose-700",
  primary: "bg-[#c25934] text-white hover:bg-[#ad4c2a]",
  warning: "bg-amber-600 text-white hover:bg-amber-700",
};

export function AdminConfirmDialog({
  busy = false,
  cancelLabel = "取消",
  children,
  confirmLabel = "确认执行",
  description,
  error,
  onClose,
  onConfirm,
  open,
  title,
  tone = "danger",
}: AdminConfirmDialogProps) {
  return (
    <AdminModal
      open={open}
      onClose={onClose}
      busy={busy}
      size="sm"
      title={title}
      description={description}
      footer={
        <>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm font-medium text-[var(--ink-soft)] transition hover:border-[var(--ink)]/30 hover:text-[var(--ink)] disabled:opacity-55"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold shadow-sm transition disabled:opacity-60",
              confirmToneStyles[tone],
            )}
          >
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="grid gap-3">
        {tone === "danger" ? (
          <div className="flex items-center gap-2 rounded-xl border border-rose-200/80 bg-rose-50/70 px-3 py-2 text-xs text-rose-700">
            <AlertTriangle className="size-4 shrink-0 text-rose-500" aria-hidden />
            <span>请确认目标信息无误，关键破坏性操作执行后不可撤销。</span>
          </div>
        ) : null}
        {children}
        {error ? <Alert variant="error">{error}</Alert> : null}
      </div>
    </AdminModal>
  );
}
