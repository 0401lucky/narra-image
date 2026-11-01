"use client";

// 画布凭据仅存于当前账户的内存，按节点隔离；每次验证只租给一个捕获的运行来源。
// 对话配置不参与此处，关闭/中止会释放待确认请求，已发送任务仍由控制器管理。
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import type { TurnstileWidgetHandle } from "@/components/auth/turnstile-widget";
import type { CanvasGenerationParametersV1, CanvasRunTransientFieldsV1 } from "@/lib/canvas/contracts";
import { providerConfigSchema } from "@/lib/validators";

import type { CanvasControllerOptions } from "../canvas/controller";
import type { CanvasNodeTarget } from "../parts/canvas-stage";
import type { SavedProviderInfo, StudioTurnstile } from "../types";

type AcquireLease = CanvasControllerOptions["acquireTransientLease"];
type LeaseInput = Parameters<AcquireLease>[0];
type Lease = Awaited<ReturnType<AcquireLease>>;
type RuntimeProvider = { apiKey: string; baseUrl: string; label: string };
export type CanvasProviderDraft = RuntimeProvider & { useSaved: boolean };
export type CanvasRuntimeDialogView = {
  id: number;
  target: CanvasNodeTarget;
  runId: string | null;
  reason: LeaseInput["reason"] | "settings";
  model: string;
  provider: CanvasProviderDraft | null;
  savedProviderAvailable: boolean;
  siteKey: string | null;
  verified: boolean;
  busy: boolean;
  error: string | null;
};
type Options = { ownerId: string; enabled: boolean; readOnly: boolean; savedProvider: SavedProviderInfo | null; turnstile: StudioTurnstile | null };
type Entry = {
  view: CanvasRuntimeDialogView;
  signal: AbortSignal | null;
  abort: () => void;
  resolve: ((lease: Lease) => void) | null;
  token: string | null;
  fields: CanvasRunTransientFieldsV1;
  leased: boolean;
};
type Manager = ReturnType<typeof createRuntimeLeases>;
export type UseCanvasRuntimeLeaseResult = {
  acquireTransientLease: AcquireLease;
  dialog: CanvasRuntimeDialogView | null;
  widgetRef: RefObject<TurnstileWidgetHandle | null>;
  openProviderSettings: (target: CanvasNodeTarget, parameters: CanvasGenerationParametersV1) => void;
  changeProvider: (id: number, provider: CanvasProviderDraft) => void;
  verify: (id: number, token: string | null) => void;
  confirm: (id: number) => void;
  cancel: (id: number) => void;
};

function createRuntimeLeases(getOptions: () => Options, nextId: () => number, publish: (view: CanvasRuntimeDialogView | null) => void, resetWidget: () => void) {
  const entries = new Map<number, Entry>();
  const providers = new Map<string, RuntimeProvider>();
  const queue: Entry[] = [];
  let current: Entry | null = null;
  let disposed = false;
  const providerKey = (target: CanvasNodeTarget) => `${target.canvasId}:${target.nodeId}`;
  const available = () => !disposed && getOptions().enabled && !getOptions().readOnly;
  const show = (entry: Entry) => publish({ ...entry.view, target: { ...entry.view.target }, provider: entry.view.provider ? { ...entry.view.provider } : null });
  function pump() {
    if (disposed || current) return;
    current = queue.shift() ?? null;
    if (current) show(current);
  }
  function finish(entry: Entry) {
    if (entries.get(entry.view.id) !== entry) return;
    entries.delete(entry.view.id);
    const queued = queue.indexOf(entry);
    if (queued !== -1) queue.splice(queued, 1);
    entry.signal?.removeEventListener("abort", entry.abort);
    entry.resolve?.(null);
    entry.resolve = null;
    entry.token = null;
    if (entry.view.provider) entry.view.provider.apiKey = "";
    if (entry.fields.customProvider) entry.fields.customProvider.apiKey = "";
    delete entry.fields.customProvider;
    delete entry.fields.turnstileToken;
    if (current === entry) {
      resetWidget();
      current = null;
      publish(null);
    }
    pump();
  }
  function providerFields(entry: Entry): CanvasRunTransientFieldsV1["customProvider"] | false {
    const provider = entry.view.provider;
    if (!provider || (provider.useSaved && entry.view.savedProviderAvailable)) return undefined;
    const parsed = providerConfigSchema.safeParse({
      apiKey: provider.apiKey, baseUrl: provider.baseUrl, label: provider.label,
      model: entry.view.model, remember: false,
    });
    if (!parsed.success) {
      entry.view.error = parsed.error.issues[0]?.message ?? "请检查画布渠道设置";
      if (current === entry) show(entry);
      return false;
    }
    return parsed.data;
  }
  function grant(entry: Entry) {
    if (!available() || entry.signal?.aborted) { finish(entry); return; }
    if (entry.view.siteKey && !entry.token) {
      entry.view.error = "请先完成本次画布运行的人机验证";
      show(entry);
      return;
    }
    const customProvider = providerFields(entry);
    if (customProvider === false) return;
    if (entry.view.provider) {
      const key = providerKey(entry.view.target);
      const old = providers.get(key);
      if (old) old.apiKey = "";
      if (customProvider) providers.set(key, { apiKey: customProvider.apiKey, baseUrl: customProvider.baseUrl, label: customProvider.label ?? "我的 API" });
      else providers.delete(key);
    }
    if (entry.view.reason === "settings") { finish(entry); return; }
    entry.fields = {
      ...(customProvider ? { customProvider: { ...customProvider, models: [...(customProvider.models ?? [])], remember: false } } : {}),
      ...(entry.token ? { turnstileToken: entry.token } : {}),
    };
    entry.leased = true;
    entry.view.busy = true;
    entry.view.error = null;
    const resolve = entry.resolve;
    entry.resolve = null;
    if (current === entry) show(entry);
    resolve?.({ fields: entry.fields, release: () => finish(entry) });
  }
  function makeEntry(target: CanvasNodeTarget, parameters: CanvasGenerationParametersV1, reason: CanvasRuntimeDialogView["reason"], runId: string | null, signal: AbortSignal | null, resolve: Entry["resolve"]) {
    const { savedProvider, turnstile } = getOptions();
    const cached = providers.get(providerKey(target));
    const siteKey = reason !== "settings" && turnstile?.isEnabled && turnstile.protectGenerate ? turnstile.siteKey : null;
    const provider = parameters.providerMode === "custom" || reason === "settings" ? {
      apiKey: cached?.apiKey ?? "", baseUrl: cached?.baseUrl ?? savedProvider?.baseUrl ?? "https://api.openai.com/v1",
      label: cached?.label ?? savedProvider?.label ?? "我的 API", useSaved: Boolean(savedProvider && !cached),
    } : null;
    const entry: Entry = {
      view: { id: nextId(), target: { ...target }, reason, runId, model: parameters.model,
        provider, savedProviderAvailable: Boolean(savedProvider), siteKey, verified: false, busy: false, error: null },
      signal, resolve, token: null, fields: {}, leased: false, abort: () => finish(entry),
    };
    entries.set(entry.view.id, entry);
    signal?.addEventListener("abort", entry.abort, { once: true });
    if (reason === "settings" || siteKey || (provider && !savedProvider && !cached)) {
      queue.push(entry);
      pump();
    } else grant(entry);
  }
  return {
    acquire: ((input: LeaseInput) => {
      if (!available() || input.origin.ownerId !== getOptions().ownerId || input.signal.aborted) return Promise.resolve(null);
      return new Promise<Lease>((resolve) => makeEntry(input.origin, { ...input.parameters }, input.reason, input.origin.runId, input.signal, resolve));
    }) satisfies AcquireLease,
    settings(target: CanvasNodeTarget, parameters: CanvasGenerationParametersV1) {
      if (!available() || [...entries.values()].some((entry) => entry.view.reason === "settings" && providerKey(entry.view.target) === providerKey(target))) return;
      makeEntry(target, { ...parameters }, "settings", null, null, null);
    },
    changeProvider(id: number, provider: CanvasProviderDraft) {
      if (current?.view.id !== id || current.leased || !current.view.provider) return;
      current.view.provider = { ...provider };
      current.view.error = null;
      show(current);
    },
    verify(id: number, token: string | null) {
      if (current?.view.id !== id || current.leased || !current.view.siteKey) return;
      current.token = token;
      current.view.verified = Boolean(token);
      current.view.error = null;
      show(current);
    },
    confirm(id: number) { if (current?.view.id === id && !current.leased) grant(current); },
    cancel(id: number) { if (current?.view.id === id && !current.leased) finish(current); },
    cancelWaiting() { for (const entry of [...entries.values()]) if (!entry.leased) finish(entry); },
    dispose() {
      disposed = true;
      for (const entry of [...entries.values()]) finish(entry);
      for (const provider of providers.values()) provider.apiKey = "";
      providers.clear();
    },
  };
}

export function useCanvasRuntimeLease(options: Options): UseCanvasRuntimeLeaseResult {
  const latest = useRef(options);
  const manager = useRef<Manager | null>(null);
  const nextId = useRef(0);
  const widgetRef = useRef<TurnstileWidgetHandle | null>(null);
  const [view, setView] = useState<{ ownerId: string; dialog: CanvasRuntimeDialogView | null }>({ ownerId: options.ownerId, dialog: null });

  useEffect(() => { latest.current = options; }, [options]);
  useEffect(() => {
    let live = true;
    const instance = createRuntimeLeases(() => latest.current, () => ++nextId.current,
      (dialog) => { if (live) setView({ ownerId: options.ownerId, dialog }); }, () => widgetRef.current?.reset());
    manager.current = instance;
    return () => {
      live = false;
      instance.dispose();
      if (manager.current === instance) manager.current = null;
    };
  }, [options.ownerId]);
  useEffect(() => { if (!options.enabled || options.readOnly) manager.current?.cancelWaiting(); }, [options.enabled, options.readOnly]);

  return {
    dialog: view.ownerId === options.ownerId ? view.dialog : null, widgetRef,
    acquireTransientLease: useCallback((input: LeaseInput) => manager.current?.acquire(input) ?? Promise.resolve(null), []),
    openProviderSettings: useCallback((target: CanvasNodeTarget, parameters: CanvasGenerationParametersV1) => { manager.current?.settings(target, parameters); }, []),
    changeProvider: useCallback((id: number, provider: CanvasProviderDraft) => { manager.current?.changeProvider(id, provider); }, []),
    verify: useCallback((id: number, token: string | null) => { manager.current?.verify(id, token); }, []),
    confirm: useCallback((id: number) => { manager.current?.confirm(id); }, []),
    cancel: useCallback((id: number) => { manager.current?.cancel(id); }, []),
  };
}
