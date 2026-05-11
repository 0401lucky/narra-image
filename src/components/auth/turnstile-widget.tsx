"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { CheckCircle2, Loader2, ShieldAlert } from "lucide-react";

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        options: {
          sitekey: string;
          callback?: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
          size?: "normal" | "compact" | "flexible";
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]`,
    );
    if (existing) {
      if (window.turnstile) {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("脚本加载失败")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("脚本加载失败")), { once: true });
    document.head.appendChild(script);
  });

  return scriptPromise;
}

export type TurnstileWidgetHandle = {
  reset: () => void;
};

type TurnstileStatus = "loading" | "ready" | "verified" | "expired" | "error";

type TurnstileWidgetProps = {
  siteKey: string;
  onVerify: (token: string) => void;
  onExpire?: () => void;
  onError?: () => void;
  theme?: "light" | "dark" | "auto";
  size?: "normal" | "compact" | "flexible";
  className?: string;
  ref?: Ref<TurnstileWidgetHandle>;
};

export function TurnstileWidget({
  siteKey,
  onVerify,
  onExpire,
  onError,
  theme = "auto",
  size = "flexible",
  className,
  ref,
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState<TurnstileStatus>("loading");

  useImperativeHandle(ref, () => ({
    reset() {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.reset(widgetIdRef.current);
      }
      setStatus("ready");
    },
  }), []);

  useEffect(() => {
    let cancelled = false;
    let widgetId: string | null = null;

    setStatus("loading");

    loadScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        setStatus("ready");
        widgetId = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme,
          size,
          callback: (token) => {
            setStatus("verified");
            onVerify(token);
          },
          "expired-callback": () => {
            setStatus("expired");
            onExpire?.();
          },
          "error-callback": () => {
            setStatus("error");
            onError?.();
          },
        });
        widgetIdRef.current = widgetId;
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("error");
          onError?.();
        }
      });

    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) {
        try {
          window.turnstile.remove(widgetId);
        } catch {
          // widget 已经被移除时静默忽略
        }
      }
      widgetIdRef.current = null;
    };
  }, [siteKey, theme, size, onVerify, onExpire, onError]);

  return (
    <div className={className}>
      {status === "loading" && (
        <div className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white/60 px-4 py-3 text-sm text-[var(--ink-soft)]">
          <Loader2 className="size-4 animate-spin" />
          <span>正在加载人机验证...</span>
        </div>
      )}
      {status === "verified" && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 className="size-4" />
          <span>验证通过</span>
        </div>
      )}
      {status === "error" && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50/80 px-4 py-3 text-sm text-rose-600">
          <ShieldAlert className="size-4" />
          <span>验证加载失败，请刷新页面重试</span>
        </div>
      )}
      {status === "expired" && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-700">
          <ShieldAlert className="size-4" />
          <span>验证已过期，请重新验证</span>
        </div>
      )}
      <div
        ref={containerRef}
        className={status === "verified" ? "hidden" : undefined}
      />
    </div>
  );
}
