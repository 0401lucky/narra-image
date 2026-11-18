"use client";

import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";
import {
  AdminToastContext,
  type AdminToastContextValue,
  type AdminToastInput,
  type AdminToastVariant,
} from "./admin-toast-context";

type AdminToastItem = {
  description?: string;
  id: string;
  title: string;
  variant: AdminToastVariant;
};

type AdminToastProviderProps = {
  children: ReactNode;
};

const MAX_TOASTS = 4;
const DEFAULT_DURATION_MS = 3800;

const variantStyles: Record<
  AdminToastVariant,
  {
    badge: string;
    border: string;
    Icon: typeof CheckCircle2;
  }
> = {
  error: {
    badge: "bg-rose-500/12 text-rose-600",
    border: "border-rose-200/90",
    Icon: AlertCircle,
  },
  info: {
    badge: "bg-sky-500/12 text-sky-600",
    border: "border-sky-200/90",
    Icon: Info,
  },
  success: {
    badge: "bg-emerald-500/12 text-emerald-600",
    border: "border-emerald-200/90",
    Icon: CheckCircle2,
  },
  warning: {
    badge: "bg-amber-500/12 text-amber-600",
    border: "border-amber-200/90",
    Icon: AlertTriangle,
  },
};

export function AdminToastProvider({ children }: AdminToastProviderProps) {
  const [toasts, setToasts] = useState<AdminToastItem[]>([]);
  const [mounted, setMounted] = useState(false);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const seqRef = useRef(0);

  useEffect(() => {
    const timers = timersRef.current;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const dismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const push = useCallback(
    (input: AdminToastInput) => {
      seqRef.current += 1;
      const id = `admin-toast-${seqRef.current}`;
      const variant = input.variant ?? "info";
      const duration = input.durationMs ?? DEFAULT_DURATION_MS;

      setToasts((prev) => {
        const next = [...prev, { description: input.description, id, title: input.title, variant }];
        return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
      });

      if (duration > 0) {
        const handle = setTimeout(() => {
          timersRef.current.delete(id);
          setToasts((prev) => prev.filter((item) => item.id !== id));
        }, duration);
        timersRef.current.set(id, handle);
      }

      return id;
    },
    [],
  );

  const api = useMemo<AdminToastContextValue>(
    () => ({
      dismiss,
      error: (title, description) => push({ description, durationMs: 5200, title, variant: "error" }),
      info: (title, description) => push({ description, title, variant: "info" }),
      push,
      success: (title, description) => push({ description, title, variant: "success" }),
      warning: (title, description) => push({ description, durationMs: 4500, title, variant: "warning" }),
    }),
    [dismiss, push],
  );

  return (
    <AdminToastContext.Provider value={api}>
      {children}
      {mounted &&
        createPortal(
          <div
            aria-live="polite"
            aria-label="后台操作通知"
            className="pointer-events-none fixed right-4 bottom-4 z-[120] flex w-full max-w-sm flex-col gap-2.5 sm:right-6 sm:bottom-6"
          >
            {toasts.map((toast) => {
              const style = variantStyles[toast.variant];
              const Icon = style.Icon;
              return (
                <motion.div
                  key={toast.id}
                  initial={{ opacity: 0, scale: 0.96, y: 12 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                  role={toast.variant === "error" ? "alert" : "status"}
                  className={cn(
                    "admin-floating-surface pointer-events-auto flex items-start gap-3 rounded-2xl border p-3.5 shadow-xl",
                    style.border,
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 grid size-7 shrink-0 place-items-center rounded-xl",
                      style.badge,
                    )}
                  >
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <p className="text-sm font-semibold text-[var(--ink)]">{toast.title}</p>
                    {toast.description ? (
                      <p className="mt-0.5 text-xs leading-relaxed text-[var(--ink-soft)]">
                        {toast.description}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => dismiss(toast.id)}
                    aria-label="关闭通知"
                    className="rounded-lg p-1 text-[var(--ink-soft)] transition hover:bg-black/5 hover:text-[var(--ink)]"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </motion.div>
              );
            })}
          </div>,
          document.body,
        )}
    </AdminToastContext.Provider>
  );
}
