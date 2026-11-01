"use client";

// 查看器和下载各自持有原图租约，不借用卡片的生命周期，也不向对话添加参考图。
import { useCallback, useEffect, useRef, useState } from "react";

import type { CanvasController } from "../canvas/controller";
import type { CanvasImageTarget } from "../parts/canvas-stage";
import type { GenerationItem } from "../types";
import { getImageDimensionLabel, getImageRatioLabel } from "../utils";

type PreviewLease = NonNullable<ReturnType<CanvasController["acquirePreview"]>>;
type RetainablePreview = PreviewLease & { retain: () => PreviewLease };
type DownloadImage = (url: string) => Promise<void>;
type CanvasViewerImage = { src: string; meta: { dimensionLabel?: string; ratioLabel?: string } | null };
type ViewerState = CanvasViewerImage & { controller: CanvasController };
type UseCanvasImageViewerResult = {
  image: CanvasViewerImage | null;
  error: string | null;
  dismissError: () => void;
  open: (target: CanvasImageTarget) => void;
  close: () => void;
  download: (target: CanvasImageTarget, downloadImage: DownloadImage) => Promise<void>;
  downloadCurrent: (downloadImage: DownloadImage) => Promise<void>;
};

// A removed card cannot issue a new controller lease, but its open viewer can
// retain the captured original independently until every download finishes.
function retainablePreview(original: PreviewLease): RetainablePreview {
  let consumers = 0;
  const retain = (): PreviewLease => {
    consumers += 1;
    let released = false;
    return { url: original.url, release() {
      if (released) return;
      released = true;
      consumers -= 1;
      if (consumers === 0) original.release();
    } };
  };
  return { ...retain(), retain };
}

export function useCanvasImageViewer(controller: CanvasController | null, readJob: (id: string) => GenerationItem | null): UseCanvasImageViewerResult {
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const preview = useRef<RetainablePreview | null>(null);
  const downloads = useRef(new Set<PreviewLease>());
  const lifetime = useRef({ active: false, controller });

  useEffect(() => {
    const scope = { active: true, controller };
    lifetime.current = scope;
    const heldDownloads = downloads.current;
    return () => {
      scope.active = false;
      preview.current?.release();
      preview.current = null;
      for (const lease of heldDownloads) lease.release();
      heldDownloads.clear();
    };
  }, [controller]);

  const close = useCallback(() => {
    preview.current?.release();
    preview.current = null;
    setViewer(null);
  }, []);

  const acquire = useCallback((target: CanvasImageTarget) => {
    if (!controller || !lifetime.current.active || lifetime.current.controller !== controller) throw new Error("图片暂时无法查看，请重新选择");
    const lease = target.kind === "reference" ? controller.acquirePreview(target.canvasId, target.nodeId) : null;
    if (target.url.startsWith("blob:") && !lease) throw new Error("参考原图暂不可用，请重新上传");
    return { lease, url: lease?.url ?? target.url };
  }, [controller]);

  const open = useCallback((target: CanvasImageTarget) => {
    try {
      const { lease, url } = acquire(target);
      preview.current?.release();
      preview.current = lease ? retainablePreview(lease) : null;
      let meta: CanvasViewerImage["meta"] = null;
      if (target.kind === "result") {
        const job = readJob(target.jobId);
        const image = { ...target, id: target.imageId };
        meta = job ? { dimensionLabel: getImageDimensionLabel(job, image), ratioLabel: getImageRatioLabel(job, image) }
          : { dimensionLabel: target.actualSize ?? (target.actualWidth && target.actualHeight ? `${target.actualWidth}x${target.actualHeight}` : undefined) };
      }
      setError(null);
      setViewer({ controller: controller!, src: url, meta });
    } catch (failure) { if (lifetime.current.active && lifetime.current.controller === controller) setError(failure instanceof Error ? failure.message : "图片暂时无法查看"); }
  }, [acquire, controller, readJob]);

  const performDownload = useCallback(async (capture: () => { url: string; lease: PreviewLease | null }, downloadImage: DownloadImage) => {
    const scope = lifetime.current;
    let lease: PreviewLease | null = null;
    try {
      const captured = capture();
      lease = captured.lease;
      if (lease) downloads.current.add(lease);
      await downloadImage(captured.url);
    } catch (failure) { if (scope.active && lifetime.current === scope) setError(failure instanceof Error ? failure.message : "图片下载失败"); }
    finally { if (lease) { lease.release(); downloads.current.delete(lease); } }
  }, []);
  const download = useCallback((target: CanvasImageTarget, downloadImage: DownloadImage) => performDownload(() => acquire(target), downloadImage), [acquire, performDownload]);
  const downloadCurrent = useCallback((downloadImage: DownloadImage) => performDownload(() => {
    if (!viewer || viewer.controller !== controller || !lifetime.current.active || lifetime.current.controller !== controller) throw new Error("图片暂时无法查看，请重新选择");
    const lease = preview.current?.url === viewer.src ? preview.current.retain() : null;
    if (viewer.src.startsWith("blob:") && !lease) throw new Error("参考原图暂不可用，请重新上传");
    return { url: viewer.src, lease };
  }, downloadImage), [controller, performDownload, viewer]);

  return { image: viewer?.controller === controller ? viewer : null, error, dismissError: () => setError(null), open, close, download, downloadCurrent };
}
