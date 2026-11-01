"use client";

import { LoaderCircle, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef } from "react";

import { TurnstileWidget } from "@/components/auth/turnstile-widget";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

import type { CanvasRuntimeDialogView, UseCanvasRuntimeLeaseResult } from "../hooks/use-canvas-runtime-lease";
import { useCanvasMobileViewport } from "../hooks/use-canvas-mobile-viewport";
import styles from "./canvas-stage.module.css";

type CanvasRuntimeDialogProps = Pick<UseCanvasRuntimeLeaseResult, "widgetRef" | "changeProvider" | "verify" | "confirm" | "cancel"> & { dialog: CanvasRuntimeDialogView };

export function CanvasRuntimeDialog({ dialog, widgetRef, changeProvider, verify, confirm, cancel }: CanvasRuntimeDialogProps) {
  const element = useRef<HTMLDivElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const composing = useRef(false);
  const viewport = useCanvasMobileViewport();
  const mounted = useRef(false);
  const titleId = useId();
  const helpId = useId();
  const onVerify = useCallback((token: string) => { if (mounted.current) verify(dialog.id, token); }, [dialog.id, verify]);
  const clearToken = useCallback(() => { if (mounted.current) verify(dialog.id, null); }, [dialog.id, verify]);
  const provider = dialog.provider;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.current?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [dialog.id]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; verify(dialog.id, null); };
  }, [dialog.id, verify]);

  return <div className={cn("fixed inset-0 z-[60] flex items-center justify-center bg-[#261b15]/55 p-4 backdrop-blur-sm", styles.visibleDialogBackdrop, styles.runtimeDialog)} style={viewport.style}
    onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={(event) => {
    event.stopPropagation();
    if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape" && !dialog.busy) { event.preventDefault(); cancel(dialog.id); }
    if (event.key !== "Tab") return;
    const items = Array.from(element.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), iframe, [tabindex="0"]') ?? []);
    const first = items[0];
    const last = items.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === element.current)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}>
    <div ref={element} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={helpId} tabIndex={-1}
      className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-3xl border border-[var(--line)] bg-[#fffaf2] p-5 shadow-2xl sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div><p className="mb-1 text-xs font-semibold text-[var(--accent)]">仅用于此画布节点</p><h2 id={titleId} className="text-lg font-semibold text-[var(--ink)]">{dialog.reason === "settings" ? "画布渠道设置" : "确认本次画布运行"}</h2></div>
        <button type="button" aria-label="关闭画布运行设置" disabled={dialog.busy} onClick={() => cancel(dialog.id)} className="rounded-xl p-2 text-[var(--ink-soft)] hover:bg-black/5 disabled:opacity-40"><X aria-hidden className="size-4" /></button>
      </div>
      <p id={helpId} className="mt-3 text-sm leading-relaxed text-[var(--ink-soft)]">渠道凭据只在本页内存中使用，不保存到草稿或账户，也不会更改对话配置。{dialog.reason === "transport-retry" && "本次重试保留原运行标识与输入，不创建新的运行。"}</p>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-xl bg-[#f4ecdf] p-3 text-xs text-[var(--ink-soft)]">
        <dt>画布</dt><dd className="truncate" title={dialog.target.canvasId}>{dialog.target.canvasId}</dd>
        <dt>节点</dt><dd className="truncate" title={dialog.target.nodeId}>{dialog.target.nodeId}</dd>
        <dt>模型</dt><dd className="break-all font-semibold text-[var(--ink)]">{dialog.model}</dd>
      </dl>
      <form ref={form} className="mt-4 space-y-4" onSubmit={(event) => event.preventDefault()}>
        {provider && <fieldset disabled={dialog.busy} className="space-y-3">
          <legend className="sr-only">此节点的第三方渠道</legend>
          {dialog.savedProviderAvailable && <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-[var(--ink)]"><input type="checkbox" checked={provider.useSaved} onChange={(event) => changeProvider(dialog.id, { ...provider, useSaved: event.target.checked })} />使用账户已保存的渠道</label>}
          {provider.useSaved ? <p className="text-xs text-[var(--ink-soft)]">API Key 由服务端读取，本次不发送浏览器端凭据。</p> : <>
            <label className="block text-xs font-medium text-[var(--ink-soft)]">画布 Base URL<input aria-label="画布 Base URL" type="url" required value={provider.baseUrl} onChange={(event) => changeProvider(dialog.id, { ...provider, baseUrl: event.target.value })} className="mt-1.5 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--ink)]" /></label>
            <label className="block text-xs font-medium text-[var(--ink-soft)]">画布 API Key<input aria-label="画布 API Key" type="password" autoComplete="off" required value={provider.apiKey} onChange={(event) => changeProvider(dialog.id, { ...provider, apiKey: event.target.value })} className="mt-1.5 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--ink)]" /></label>
            <label className="block text-xs font-medium text-[var(--ink-soft)]">画布渠道名称<input aria-label="画布渠道名称" maxLength={40} value={provider.label} onChange={(event) => changeProvider(dialog.id, { ...provider, label: event.target.value })} className="mt-1.5 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--ink)]" /></label>
          </>}
        </fieldset>}
        {dialog.siteKey && <section aria-label="本次画布运行的人机验证" className="space-y-2"><p className="flex items-center gap-2 text-xs text-[var(--ink-soft)]"><ShieldCheck aria-hidden className="size-4" />每次运行使用独立验证，不复用对话验证。</p><TurnstileWidget ref={widgetRef} siteKey={dialog.siteKey} onVerify={onVerify} onExpire={clearToken} onError={clearToken} /></section>}
        {dialog.error && <Alert>{dialog.error}</Alert>}
        <div className="flex justify-end gap-2 border-t border-[var(--line)] pt-4">
          <button type="button" disabled={dialog.busy} onClick={() => cancel(dialog.id)} className="rounded-xl border border-[var(--line)] px-4 py-2 text-sm text-[var(--ink)] disabled:opacity-50">取消</button>
          <button type="button" onClick={() => { if (!dialog.busy && !composing.current && form.current?.reportValidity()) confirm(dialog.id); }} disabled={dialog.busy || Boolean(dialog.siteKey && !dialog.verified)} className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{dialog.busy ? <><LoaderCircle aria-hidden className="size-4 animate-spin" />正在提交</> : dialog.reason === "settings" ? "仅在本页使用" : "确认运行"}</button>
        </div>
      </form>
    </div>
  </div>;
}
