"use client";

// 生图工作台扁平记录列表 Hook。
// 1) 初始数据仅在挂载时初始化本地列表；后续 router.refresh() 只按同 ID 窄合并图片可用性与当前地址，
//    绝不覆盖分页、选中态或复活已隐藏记录；
// 2) 分页加载带 STUDIO_READ_TIMEOUT_MS 截止与 AbortController，防止迟到响应回写；
// 3) 删除仅调用 POST /api/me/generations/hide 隐藏终态记录，进行中任务跳过并提示，失败自动回滚。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { mergeImageAvailability } from "@/lib/storage/image-availability";

import { STUDIO_READ_TIMEOUT_MS } from "../constants";
import { isGenerationItem } from "../generation-item";
import type { GenerationItem } from "../types";
import { sameGenerationValue } from "./generation-value";

export type UseWorkbenchRecordsOptions = {
  ownerId: string;
  initialGenerations: GenerationItem[];
  initialHasMore?: boolean;
  initialNextCursor?: string | null;
};

export type HideRecordsResult = {
  hiddenCount: number;
  skippedPendingCount: number;
  error?: string;
};

export type UseWorkbenchRecordsResult = {
  records: GenerationItem[];
  selectedId: string | null;
  selectedRecord: GenerationItem | null;
  checkedIds: ReadonlySet<string>;
  allChecked: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  loadError: string | null;
  hiding: boolean;
  notice: string | null;
  dismissNotice: () => void;
  selectRecord: (id: string | null) => void;
  toggleCheck: (id: string) => void;
  toggleSelectAll: () => void;
  clearSelection: () => void;
  prependRecord: (job: GenerationItem) => void;
  updateRecord: (job: GenerationItem) => void;
  loadMore: () => Promise<void>;
  hideRecords: (ids: string[]) => Promise<HideRecordsResult>;
};

function mergeRecord(current: GenerationItem, incoming: GenerationItem): GenerationItem {
  if (current === incoming) return current;
  if (current.status !== "pending" && incoming.status !== current.status) {
    const images = mergeImageAvailability(current.images, incoming.images);
    const next = { ...current, images };
    return sameGenerationValue(current, next) ? current : next;
  }
  const stale = current.status === incoming.status
    && current.updatedAt
    && incoming.updatedAt
    && Date.parse(current.updatedAt) > Date.parse(incoming.updatedAt);
  const preferred = stale ? current : { ...current, ...incoming };
  const merged: GenerationItem = {
    ...preferred,
    images: mergeImageAvailability(stale ? incoming.images : current.images, preferred.images),
  };
  return sameGenerationValue(current, merged) ? current : merged;
}

function mergeMediaOnly(current: GenerationItem, incoming: GenerationItem): GenerationItem {
  const images = mergeImageAvailability(current.images, incoming.images);
  const next: GenerationItem = { ...current, images };
  return sameGenerationValue(current, next) ? current : next;
}

async function fetchJsonWithTimeout<T>(url: string, init: RequestInit, timeoutMs: number): Promise<{ ok: boolean; status: number; body: T | null }> {
  const controller = new AbortController();
  const externalSignal = init.signal;
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error("请求超时，请稍后重试"));
    }, timeoutMs);
  });

  try {
    const response = await Promise.race([
      fetch(url, { ...init, signal: controller.signal }),
      timeoutPromise,
    ]);
    const body = await Promise.race([
      response.json().catch(() => null) as Promise<T | null>,
      timeoutPromise,
    ]);
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    if (timedOut) throw new Error("加载生成记录超时，请重试");
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}

export function useWorkbenchRecords({
  ownerId,
  initialGenerations,
  initialHasMore = false,
  initialNextCursor = null,
}: UseWorkbenchRecordsOptions): UseWorkbenchRecordsResult {
  const [recordState, setRecordState] = useState<{
    receivedInitial: GenerationItem[];
    records: GenerationItem[];
  }>(() => ({
    receivedInitial: initialGenerations,
    records: initialGenerations,
  }));

  // router.refresh() 下发新引用时，仅按同 ID 窄合并图片可用性/当前地址，不替换列表也不复活已隐藏项。
  if (recordState.receivedInitial !== initialGenerations) {
    const incomingById = new Map(initialGenerations.map((item) => [item.id, item]));
    setRecordState({
      receivedInitial: initialGenerations,
      records: recordState.records.map((record) => {
        const incoming = incomingById.get(record.id);
        return incoming ? mergeMediaOnly(record, incoming) : record;
      }),
    });
  }

  const records = recordState.records;
  const setRecords = useCallback(
    (updater: GenerationItem[] | ((current: GenerationItem[]) => GenerationItem[])) => {
      setRecordState((state) => {
        const next = typeof updater === "function" ? updater(state.records) : updater;
        return next === state.records ? state : { ...state, records: next };
      });
    },
    [],
  );

  const [selectedId, setSelectedId] = useState<string | null>(() => initialGenerations[0]?.id ?? null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set());
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hiding, setHiding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const recordsRef = useRef(records);
  const selectedIdRef = useRef(selectedId);
  const hiddenIdsRef = useRef(new Set<string>());
  const activeRef = useRef(true);
  const epochRef = useRef(0);
  const requestsRef = useRef(new Set<AbortController>());

  useEffect(() => {
    recordsRef.current = records;
  }, [records]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    const currentRequests = requestsRef.current;
    activeRef.current = true;
    epochRef.current += 1;
    return () => {
      activeRef.current = false;
      epochRef.current += 1;
      currentRequests.forEach((controller) => controller.abort());
      currentRequests.clear();
    };
  }, [ownerId]);

  const selectedRecord = useMemo(
    () => (selectedId ? records.find((record) => record.id === selectedId) ?? null : null),
    [records, selectedId],
  );

  const allChecked = records.length > 0 && records.every((record) => checkedIds.has(record.id));

  const selectRecord = useCallback((id: string | null) => {
    setSelectedId(id);
  }, []);

  const toggleCheck = useCallback((id: string) => {
    setCheckedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setCheckedIds((current) => {
      const all = recordsRef.current;
      if (all.length === 0) return current;
      const everyChecked = all.every((record) => current.has(record.id));
      if (everyChecked) return new Set();
      return new Set(all.map((record) => record.id));
    });
  }, []);

  const clearSelection = useCallback(() => {
    setCheckedIds(new Set());
  }, []);

  const dismissNotice = useCallback(() => {
    setNotice(null);
  }, []);

  const prependRecord = useCallback((job: GenerationItem) => {
    hiddenIdsRef.current.delete(job.id);
    setRecords((current) => {
      const existingIndex = current.findIndex((item) => item.id === job.id);
      if (existingIndex === 0) {
        const merged = mergeRecord(current[0], job);
        return merged === current[0] ? current : [merged, ...current.slice(1)];
      }
      if (existingIndex > 0) {
        const merged = mergeRecord(current[existingIndex], job);
        return [merged, ...current.slice(0, existingIndex), ...current.slice(existingIndex + 1)];
      }
      return [job, ...current];
    });
    setSelectedId(job.id);
  }, [setRecords]);

  const updateRecord = useCallback((job: GenerationItem) => {
    if (hiddenIdsRef.current.has(job.id)) return;
    setRecords((current) => {
      const index = current.findIndex((item) => item.id === job.id);
      if (index === -1) return current;
      const merged = mergeRecord(current[index], job);
      if (merged === current[index]) return current;
      const next = [...current];
      next[index] = merged;
      return next;
    });
  }, [setRecords]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !nextCursor) return;
    const epoch = epochRef.current;
    const controller = new AbortController();
    requestsRef.current.add(controller);
    setLoadingMore(true);
    setLoadError(null);

    try {
      const params = new URLSearchParams({ scope: "studio", cursor: nextCursor });
      const { ok, body } = await fetchJsonWithTimeout<{
        data?: { generations?: unknown[]; hasMore?: boolean; nextCursor?: string | null };
        error?: string;
      }>(`/api/me/generations?${params.toString()}`, {
        method: "GET",
        signal: controller.signal,
      }, STUDIO_READ_TIMEOUT_MS);

      if (!activeRef.current || epochRef.current !== epoch || controller.signal.aborted) return;
      if (!ok || !body?.data || !Array.isArray(body.data.generations)) {
        setLoadError(body?.error || "加载更多记录失败，请重试");
        return;
      }

      const incoming = body.data.generations.filter(isGenerationItem);
      setRecords((current) => {
        const byId = new Map(current.map((item) => [item.id, item]));
        const next = [...current];
        let changed = false;
        for (const item of incoming) {
          if (hiddenIdsRef.current.has(item.id)) continue;
          const existing = byId.get(item.id);
          if (existing) {
            const merged = mergeRecord(existing, item);
            if (merged !== existing) {
              const idx = next.findIndex((entry) => entry.id === item.id);
              if (idx !== -1) next[idx] = merged;
              changed = true;
            }
          } else {
            next.push(item);
            byId.set(item.id, item);
            changed = true;
          }
        }
        return changed ? next : current;
      });
      setHasMore(Boolean(body.data.hasMore));
      setNextCursor(typeof body.data.nextCursor === "string" ? body.data.nextCursor : null);
    } catch (error) {
      if (!activeRef.current || epochRef.current !== epoch || controller.signal.aborted) return;
      setLoadError(error instanceof Error ? error.message : "加载更多记录失败，请重试");
    } finally {
      requestsRef.current.delete(controller);
      if (activeRef.current && epochRef.current === epoch) {
        setLoadingMore(false);
      }
    }
  }, [hasMore, loadingMore, nextCursor, setRecords]);

  const hideRecords = useCallback(async (rawIds: string[]): Promise<HideRecordsResult> => {
    const uniqueIds = [...new Set(rawIds)];
    if (uniqueIds.length === 0) return { hiddenCount: 0, skippedPendingCount: 0 };

    const currentSnapshot = recordsRef.current;
    const byId = new Map(currentSnapshot.map((item) => [item.id, item]));
    const terminalIds: string[] = [];
    const skippedPendingIds: string[] = [];

    for (const id of uniqueIds) {
      const target = byId.get(id);
      if (!target) continue;
      if (target.status === "pending") {
        skippedPendingIds.push(id);
      } else {
        terminalIds.push(id);
      }
    }

    if (terminalIds.length === 0) {
      const msg = skippedPendingIds.length > 0
        ? "生成中的任务无法直接删除，请先取消生成"
        : undefined;
      if (msg) setNotice(msg);
      return { hiddenCount: 0, skippedPendingCount: skippedPendingIds.length };
    }

    const epoch = epochRef.current;
    const controller = new AbortController();
    requestsRef.current.add(controller);
    setHiding(true);
    setNotice(null);

    const terminalSet = new Set(terminalIds);
    const previousSelectedId = selectedIdRef.current;
    const removedRecords = currentSnapshot.filter((record) => terminalSet.has(record.id));
    terminalIds.forEach((id) => hiddenIdsRef.current.add(id));

    const remaining = currentSnapshot.filter((record) => !terminalSet.has(record.id));
    setRecords(remaining);
    setCheckedIds((current) => {
      const next = new Set(current);
      terminalIds.forEach((id) => next.delete(id));
      return next;
    });
    if (previousSelectedId && terminalSet.has(previousSelectedId)) {
      const oldIndex = currentSnapshot.findIndex((record) => record.id === previousSelectedId);
      const fallback = remaining[Math.min(Math.max(0, oldIndex), Math.max(0, remaining.length - 1))] ?? null;
      setSelectedId(fallback?.id ?? null);
    }

    const restore = (message: string, idsToRestore: string[] = terminalIds) => {
      const restoreSet = new Set(idsToRestore);
      idsToRestore.forEach((id) => hiddenIdsRef.current.delete(id));
      const itemsToRestore = removedRecords.filter((record) => restoreSet.has(record.id));
      if (itemsToRestore.length > 0) {
        setRecords((current) => {
          const existingIds = new Set(current.map((item) => item.id));
          const merged = [...current];
          for (const item of itemsToRestore) {
            if (!existingIds.has(item.id)) merged.push(item);
          }
          merged.sort((left, right) => {
            const diff = Date.parse(right.createdAt) - Date.parse(left.createdAt);
            return diff !== 0 ? diff : right.id.localeCompare(left.id);
          });
          return merged;
        });
      }
      if (previousSelectedId && restoreSet.has(previousSelectedId)) {
        setSelectedId(previousSelectedId);
      }
      setNotice(message);
    };

    try {
      const { ok, body } = await fetchJsonWithTimeout<{
        data?: { hiddenIds?: string[]; skippedPendingIds?: string[] };
        error?: string;
      }>("/api/me/generations/hide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: terminalIds }),
        signal: controller.signal,
      }, STUDIO_READ_TIMEOUT_MS);

      if (!activeRef.current || epochRef.current !== epoch || controller.signal.aborted) {
        return { hiddenCount: 0, skippedPendingCount: skippedPendingIds.length };
      }

      if (!ok) {
        const message = body?.error || "删除生成记录失败，请稍后重试";
        restore(message);
        return { hiddenCount: 0, skippedPendingCount: skippedPendingIds.length, error: message };
      }

      const serverSkipped = body?.data?.skippedPendingIds ?? [];
      const totalSkipped = skippedPendingIds.length + serverSkipped.length;
      if (serverSkipped.length > 0) {
        restore(`已隐藏部分记录，跳过 ${totalSkipped} 条生成中的任务（请先取消生成）`, serverSkipped);
      } else if (skippedPendingIds.length > 0) {
        setNotice(`已隐藏 ${terminalIds.length} 条记录，跳过 ${skippedPendingIds.length} 条生成中的任务（请先取消生成）`);
      }

      return {
        hiddenCount: Math.max(0, terminalIds.length - serverSkipped.length),
        skippedPendingCount: totalSkipped,
      };
    } catch (error) {
      if (!activeRef.current || epochRef.current !== epoch || controller.signal.aborted) {
        return { hiddenCount: 0, skippedPendingCount: skippedPendingIds.length };
      }
      const message = error instanceof Error ? error.message : "删除生成记录失败，请稍后重试";
      restore(message);
      return { hiddenCount: 0, skippedPendingCount: skippedPendingIds.length, error: message };
    } finally {
      requestsRef.current.delete(controller);
      if (activeRef.current && epochRef.current === epoch) {
        setHiding(false);
      }
    }
  }, [setRecords]);

  return {
    records,
    selectedId,
    selectedRecord,
    checkedIds,
    allChecked,
    hasMore,
    loadingMore,
    loadError,
    hiding,
    notice,
    dismissNotice,
    selectRecord,
    toggleCheck,
    toggleSelectAll,
    clearSelection,
    prependRecord,
    updateRecord,
    loadMore,
    hideRecords,
  };
}
