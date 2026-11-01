"use client";

// 根工作台持有账户内已知任务及不可变来源，切换/删除视图不取消任务。
// 命令先同步合并 canonical cache，再通知捕获的会话或画布；仅挂载期命令/effect 可调用。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CanvasJobOrigin, CanvasJobsPort } from "../canvas/studio-bridge";
import type { GenerationItem } from "../types";
import { useImagePoller } from "./use-image-poller";

type ConversationOrigin = Readonly<{ kind: "conversation"; ownerId: string; conversationId: string }>;
type JobOrigin = ConversationOrigin | Readonly<{ kind: "canvas"; source: CanvasJobOrigin }>;
type CanvasSubscription = {
  mountEpoch: number;
  listener: (origin: CanvasJobOrigin, job: GenerationItem) => void;
};
type JobsContext = {
  scope: object;
  ownerId: string;
  active: boolean;
  mountEpoch: number;
  jobs: Map<string, GenerationItem>;
  origins: Map<string, JobOrigin>;
  subscribers: Set<CanvasSubscription>;
};
type JobsSnapshot = { scope: object; pendingGenerations: GenerationItem[] };

export type UseStudioJobsOptions = {
  ownerId: string;
  onConversationUpdate?: (conversationId: string, job: GenerationItem) => void;
};

export type UseStudioJobsResult = {
  registerConversation: (conversationId: string, job: GenerationItem) => GenerationItem;
  getJob: (jobId: string) => GenerationItem | null;
  updateJob: (job: GenerationItem) => GenerationItem | null;
  canvasJobs: CanvasJobsPort;
  pendingGenerations: GenerationItem[];
};

function sameOrigin(left: JobOrigin, right: JobOrigin) {
  if (left.kind === "conversation" && right.kind === "conversation") {
    return left.ownerId === right.ownerId && left.conversationId === right.conversationId;
  }
  if (left.kind === "canvas" && right.kind === "canvas") {
    return left.source.ownerId === right.source.ownerId && left.source.canvasId === right.source.canvasId
      && left.source.nodeId === right.source.nodeId && left.source.runId === right.source.runId;
  }
  return false;
}

function sameJobValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => sameJobValue(value, right[index]));
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const leftFields = left as Record<string, unknown>;
  const rightFields = right as Record<string, unknown>;
  return [...new Set([...Object.keys(leftFields), ...Object.keys(rightFields)])]
    .every((key) => sameJobValue(leftFields[key], rightFields[key]));
}

function copyJob(job: GenerationItem): GenerationItem {
  return {
    ...job,
    images: job.images.map((image) => ({ ...image })),
    ...(job.videos ? { videos: job.videos.map((video) => ({ ...video })) } : {}),
    ...(job.sourceImageUrls ? { sourceImageUrls: [...job.sourceImageUrls] } : {}),
  };
}

function mergeJob(current: GenerationItem | undefined, incoming: GenerationItem): GenerationItem {
  if (!current) return copyJob(incoming);
  if (current === incoming) return current;
  if (current.status !== "pending" && incoming.status !== current.status) return current;
  if (current.status === incoming.status && current.updatedAt && incoming.updatedAt
    && Date.parse(current.updatedAt) > Date.parse(incoming.updatedAt)) return current;
  const merged = { ...current, ...incoming };
  return sameJobValue(current, merged) ? current : copyJob(merged);
}

export function useStudioJobs({ ownerId, onConversationUpdate }: UseStudioJobsOptions): UseStudioJobsResult {
  const scope = useMemo(() => ({ ownerId }), [ownerId]);
  const contextRef = useRef<JobsContext | null>(null);
  const onConversationUpdateRef = useRef(onConversationUpdate);
  const [snapshot, setSnapshot] = useState<JobsSnapshot>(() => ({ scope, pendingGenerations: [] }));

  const getContext = useCallback(() => {
    const context = contextRef.current;
    return context?.scope === scope && context.active ? context : null;
  }, [scope]);

  const publish = useCallback((context: JobsContext) => {
    if (getContext() !== context) return;
    setSnapshot({
      scope: context.scope,
      pendingGenerations: [...context.jobs.values()].filter((job) => job.status === "pending"),
    });
  }, [getContext]);

  useEffect(() => {
    onConversationUpdateRef.current = onConversationUpdate;
  }, [onConversationUpdate]);

  useEffect(() => {
    if (contextRef.current?.scope !== scope) {
      contextRef.current?.jobs.clear();
      contextRef.current?.origins.clear();
      contextRef.current = {
        scope, ownerId, active: false, mountEpoch: 0,
        jobs: new Map(), origins: new Map(), subscribers: new Set(),
      };
    }
    const context = contextRef.current;
    context.active = true;
    context.mountEpoch += 1;
    publish(context);
    return () => {
      context.active = false;
      context.mountEpoch += 1;
      context.subscribers.clear();
    };
  }, [ownerId, scope, publish]);

  const mergeAndNotify = useCallback((context: JobsContext, origin: JobOrigin, job: GenerationItem) => {
    const current = context.jobs.get(job.id);
    const canonical = mergeJob(current, job);
    if (canonical === current) return canonical;
    context.jobs.set(job.id, canonical);
    publish(context);
    const mountEpoch = context.mountEpoch;
    if (origin.kind === "conversation") {
      onConversationUpdateRef.current?.(origin.conversationId, canonical);
    } else {
      for (const subscription of [...context.subscribers]) {
        if (getContext() !== context || context.mountEpoch !== mountEpoch) break;
        if (subscription.mountEpoch === mountEpoch && context.subscribers.has(subscription)) {
          subscription.listener(origin.source, canonical);
        }
      }
    }
    return canonical;
  }, [getContext, publish]);

  const register = useCallback((origin: JobOrigin, job: GenerationItem) => {
    const context = getContext();
    if (!context) return job;
    const currentOrigin = context.origins.get(job.id);
    if (currentOrigin && !sameOrigin(currentOrigin, origin)) return context.jobs.get(job.id) ?? job;
    if (!currentOrigin) context.origins.set(job.id, origin);
    return mergeAndNotify(context, currentOrigin ?? origin, job);
  }, [getContext, mergeAndNotify]);

  const registerConversation = useCallback((conversationId: string, job: GenerationItem) => {
    const origin: ConversationOrigin = Object.freeze({ kind: "conversation", ownerId, conversationId });
    return register(origin, job);
  }, [ownerId, register]);

  const getJob = useCallback((jobId: string) => getContext()?.jobs.get(jobId) ?? null, [getContext]);

  const updateJob = useCallback((job: GenerationItem) => {
    const context = getContext();
    const origin = context?.origins.get(job.id);
    return context && origin ? mergeAndNotify(context, origin, job) : null;
  }, [getContext, mergeAndNotify]);

  const registerCanvas = useCallback((origin: CanvasJobOrigin, job: GenerationItem) => {
    if (origin.ownerId !== ownerId) return job;
    const source = Object.freeze({
      ownerId: origin.ownerId, canvasId: origin.canvasId, nodeId: origin.nodeId, runId: origin.runId,
    });
    return register(Object.freeze({ kind: "canvas", source }), job);
  }, [ownerId, register]);

  const subscribe = useCallback((listener: CanvasSubscription["listener"]) => {
    const context = getContext();
    if (!context) return () => {};
    const subscription: CanvasSubscription = { mountEpoch: context.mountEpoch, listener };
    context.subscribers.add(subscription);
    return () => { context.subscribers.delete(subscription); };
  }, [getContext]);

  const canvasJobs = useMemo<CanvasJobsPort>(() => ({ register: registerCanvas, read: getJob, subscribe }), [registerCanvas, getJob, subscribe]);
  const pendingGenerations = snapshot.scope === scope ? snapshot.pendingGenerations : [];
  useImagePoller({ ownerId, generations: pendingGenerations, onUpdate: updateJob });

  return { registerConversation, getJob, updateJob, canvasJobs, pendingGenerations };
}
