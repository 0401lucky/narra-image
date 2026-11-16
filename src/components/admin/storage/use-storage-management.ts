"use client";

import { useEffect, useRef, useState } from "react";
import { ZodError } from "zod";

import type { ImageCleanupPreview, ImageMaintenanceJob, ImageStorageOverview } from "@/lib/storage/image-maintenance-types";
import type { ImageManagementOverview } from "@/lib/storage/image-management-types";
import { imageStoragePolicySchema } from "@/lib/validators";
import { STORAGE_ACTIVE_STATES, STORAGE_POLL_INTERVAL_MS, STORAGE_REQUEST_TIMEOUT_MS } from "./constants";
import { storageGbToBytes, storagePolicyDraft } from "./utils";

class StorageRequestError extends Error {
  constructor(message: string, readonly code?: string) { super(message); }
}

async function storageRequest<T>(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  let rejectAbort: (error: Error) => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const abort = () => {
    controller.abort();
    rejectAbort(new StorageRequestError("请求未完成，请刷新进度或使用原操作重试"));
  };
  const timer = setTimeout(abort, STORAGE_REQUEST_TIMEOUT_MS);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  try {
    const fetchResult = async () => {
      const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...init, signal: controller.signal });
      const body = await response.json() as { data?: T; error?: string; code?: string };
      if (controller.signal.aborted) throw new StorageRequestError("请求已中断，请刷新进度");
      if (!response.ok) throw new StorageRequestError(body.error || "存储管理请求失败", body.code);
      if (body.data === undefined || body.data === null) throw new StorageRequestError("存储管理响应不完整，请重试");
      return body.data;
    };
    return await Promise.race([fetchResult(), aborted]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

const jsonRequest = (method: string, body: unknown): RequestInit => ({
  method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

type UseStorageManagementInput = {
  initialOverview: ImageManagementOverview;
  initialJob: ImageMaintenanceJob | null;
};

export function useStorageManagement({ initialOverview, initialJob }: UseStorageManagementInput) {
  const [overview, setOverview] = useState(initialOverview);
  const [draft, setDraft] = useState(() => storagePolicyDraft(initialOverview.policy));
  const [cleanupMode, setCleanupMode] = useState<"MANUAL_AGE" | "MANUAL_ALL">("MANUAL_AGE");
  const [cleanupDays, setCleanupDays] = useState(String(initialOverview.policy.retentionDays));
  const [preview, setPreview] = useState<ImageCleanupPreview | null>(null);
  const [job, setJob] = useState(initialJob);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [pollRound, setPollRound] = useState(0);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const confirmRequest = useRef<{ previewId: string; requestId: string } | null>(null);
  const cancelRequest = useRef<{ jobId: string; requestId: string } | null>(null);
  const jobActive = Boolean(job && STORAGE_ACTIVE_STATES.includes(job.state));
  const jobId = job?.id ?? null;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function refreshOverview() {
    const next = await storageRequest<ImageManagementOverview>("/api/admin/storage");
    if (mounted.current) setOverview(next);
    return next;
  }

  function selectJob(next: ImageMaintenanceJob) {
    if (!mounted.current) return;
    setJob(next);
    setPollError(null);
    setOverview((current) => ({ ...current, recentJobs: [next, ...current.recentJobs.filter((item) => item.id !== next.id)].slice(0, 10) }));
    const url = new URL(window.location.href);
    url.searchParams.set("job", next.id);
    window.history.replaceState(window.history.state, "", url);
  }

  async function perform(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try { await action(); }
    catch (caught) {
      if (!mounted.current) return;
      setError(caught instanceof ZodError ? caught.issues[0]?.message ?? "参数不正确" : caught instanceof Error ? caught.message : "操作失败，请稍后重试");
      if (caught instanceof StorageRequestError && ["IMAGE_PREVIEW_EXPIRED", "IMAGE_POLICY_CONFLICT"].includes(caught.code ?? "")) {
        setPreview(null);
        confirmRequest.current = null;
      }
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  useEffect(() => {
    if (!jobId || !jobActive) return;
    const id = jobId;
    const controller = new AbortController();
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await storageRequest<ImageMaintenanceJob>(`/api/admin/storage/jobs/${encodeURIComponent(id)}`, {}, controller.signal);
        if (disposed) return;
        if (!STORAGE_ACTIVE_STATES.includes(next.state)) {
          const nextOverview = await storageRequest<ImageManagementOverview>("/api/admin/storage", {}, controller.signal).catch(() => null);
          if (disposed) return;
          if (nextOverview) setOverview(nextOverview);
          else setPollError("任务已结束，用量暂未更新，请刷新进度");
        }
        setJob((current) => current?.id === id ? next : current);
        if (STORAGE_ACTIVE_STATES.includes(next.state)) {
          setPollError(null);
          timer = setTimeout(poll, STORAGE_POLL_INTERVAL_MS);
        }
      } catch (caught) {
        if (!disposed) setPollError(caught instanceof Error ? caught.message : "进度读取失败，请重试");
      }
    };
    timer = setTimeout(poll, STORAGE_POLL_INTERVAL_MS);
    return () => { disposed = true; clearTimeout(timer); controller.abort(); };
  }, [jobId, jobActive, pollRound]);

  const clearPreview = () => { setPreview(null); confirmRequest.current = null; };

  return {
    overview, draft, setDraft, cleanupMode, cleanupDays, preview, job, busy, error, notice, pollError, jobActive,
    setCleanupMode: (value: "MANUAL_AGE" | "MANUAL_ALL") => { setCleanupMode(value); clearPreview(); },
    setCleanupDays: (value: string) => { setCleanupDays(value); clearPreview(); },
    clearPreview,
    savePolicy: () => perform(async () => {
      const input = imageStoragePolicySchema.parse({
        expectedVersion: draft.expectedVersion, enabled: draft.enabled,
        quotaCleanupEnabled: draft.quotaCleanupEnabled, scheduleEnabled: draft.scheduleEnabled,
        limitBytes: storageGbToBytes(draft.limitGb), retentionDays: Number(draft.retentionDays),
        intervalSeconds: Number(draft.intervalHours) * 3600,
      });
      const policy = await storageRequest<ImageStorageOverview["policy"]>("/api/admin/storage/policy", jsonRequest("PATCH", input));
      if (!mounted.current) return;
      setOverview((current) => ({ ...current, policy }));
      setDraft(storagePolicyDraft(policy));
      clearPreview();
      setNotice("清理策略已保存");
    }),
    reloadPolicy: () => perform(async () => {
      const next = await refreshOverview();
      if (mounted.current) { setDraft(storagePolicyDraft(next.policy)); clearPreview(); setNotice("已重新载入当前策略"); }
    }),
    previewCleanup: () => perform(async () => {
      const result = await storageRequest<ImageCleanupPreview>("/api/admin/storage/cleanup/preview", jsonRequest("POST", {
        previewRequestId: crypto.randomUUID(), expectedPolicyVersion: overview.policy.version, mode: cleanupMode,
        ...(cleanupMode === "MANUAL_AGE" ? { retentionDays: Number(cleanupDays) } : {}),
      }));
      if (mounted.current) { setPreview(result); confirmRequest.current = null; }
    }),
    confirmCleanup: () => perform(async () => {
      if (!preview) return;
      if (confirmRequest.current?.previewId !== preview.previewId) confirmRequest.current = { previewId: preview.previewId, requestId: crypto.randomUUID() };
      const next = await storageRequest<ImageMaintenanceJob>("/api/admin/storage/cleanup", jsonRequest("POST", {
        ...confirmRequest.current, expectedPolicyVersion: preview.policyVersion,
      }));
      selectJob(next);
      clearPreview();
      setNotice("清理任务已提交，关闭页面后仍会继续执行");
    }),
    loadJob: (id: string) => perform(async () => {
      const next = await storageRequest<ImageMaintenanceJob>(`/api/admin/storage/jobs/${encodeURIComponent(id)}`);
      selectJob(next);
      setPollRound((round) => round + 1);
      await refreshOverview();
    }),
    cancelJob: () => perform(async () => {
      if (!job) return;
      if (cancelRequest.current?.jobId !== job.id) cancelRequest.current = { jobId: job.id, requestId: crypto.randomUUID() };
      const next = await storageRequest<ImageMaintenanceJob>(`/api/admin/storage/jobs/${encodeURIComponent(job.id)}/cancel`, jsonRequest("POST", { requestId: cancelRequest.current.requestId }));
      selectJob(next);
      setNotice("已停止后续清理，已发出的删除仍会完成结果核对");
    }),
  };
}
