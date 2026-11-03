import type { CanvasPositionV1, CanvasViewportV1 } from "@/lib/canvas/contracts";

import { canvasEditorKey, type CanvasEditorTarget } from "./editor-state";

export type CanvasMoveGesture = Readonly<{
  target: CanvasEditorTarget;
  pointerId: number;
  startClient: CanvasPositionV1;
  startPosition: CanvasPositionV1;
  viewport: CanvasViewportV1;
  position: CanvasPositionV1;
  moved: boolean;
}>;

const finitePoint = (point: CanvasPositionV1) => Number.isFinite(point.x) && Number.isFinite(point.y);
const samePoint = (left: CanvasPositionV1, right: CanvasPositionV1) => left.x === right.x && left.y === right.y;

export function beginCanvasMove(target: CanvasEditorTarget, pointerId: number, client: CanvasPositionV1, position: CanvasPositionV1, viewport: CanvasViewportV1): CanvasMoveGesture | null {
  if (!finitePoint(client) || !finitePoint(position) || !finitePoint(viewport) || !Number.isFinite(viewport.zoom) || viewport.zoom <= 0) return null;
  return { target, pointerId, startClient: { ...client }, startPosition: { ...position }, viewport: { ...viewport }, position: { ...position }, moved: false };
}

export function previewCanvasMove(gesture: CanvasMoveGesture, pointerId: number, client: CanvasPositionV1): CanvasMoveGesture | null {
  if (pointerId !== gesture.pointerId || !finitePoint(client)) return null;
  const position = { x: gesture.startPosition.x + (client.x - gesture.startClient.x) / gesture.viewport.zoom,
    y: gesture.startPosition.y + (client.y - gesture.startClient.y) / gesture.viewport.zoom };
  const moved = gesture.moved || Math.hypot(client.x - gesture.startClient.x, client.y - gesture.startClient.y) >= 3;
  return finitePoint(position) ? { ...gesture, position, moved } : null;
}

export function finishCanvasMove(gesture: CanvasMoveGesture, current: { target: CanvasEditorTarget; position: CanvasPositionV1; viewport: CanvasViewportV1; pointerId: number; pointerCount: number }): CanvasPositionV1 | null {
  if (current.pointerCount !== 1 || current.pointerId !== gesture.pointerId || canvasEditorKey(current.target) !== canvasEditorKey(gesture.target)
    || !samePoint(current.position, gesture.startPosition) || !samePoint(current.viewport, gesture.viewport) || current.viewport.zoom !== gesture.viewport.zoom
    || !finitePoint(gesture.position) || Math.hypot(gesture.position.x - gesture.startPosition.x, gesture.position.y - gesture.startPosition.y) * gesture.viewport.zoom < 3) return null;
  return { ...gesture.position };
}

export type CanvasVisibleBounds = Readonly<{ top: number; left: number; width: number; height: number }>;
type ViewportBounds = { offsetTop: number; offsetLeft: number; width: number; height: number };

export function canvasVisibleBounds(scope: CanvasVisibleBounds | null, viewport: ViewportBounds | null, fallback: { width: number; height: number }): CanvasVisibleBounds {
  const positive = (value: number, otherwise: number) => Number.isFinite(value) && value > 0 ? value : otherwise;
  const width = positive(fallback.width, 360);
  const height = positive(fallback.height, 640);
  const view = { top: viewport && Number.isFinite(viewport.offsetTop) ? Math.max(0, viewport.offsetTop) : 0,
    left: viewport && Number.isFinite(viewport.offsetLeft) ? Math.max(0, viewport.offsetLeft) : 0,
    width: positive(viewport?.width ?? 0, width), height: positive(viewport?.height ?? 0, height) };
  if (!scope || ![scope.top, scope.left, scope.width, scope.height].every(Number.isFinite) || scope.width <= 0 || scope.height <= 0) return view;
  const left = Math.max(view.left, scope.left);
  const top = Math.max(view.top, scope.top);
  return { top, left, width: Math.max(0, Math.min(view.left + view.width, scope.left + scope.width) - left),
    height: Math.max(0, Math.min(view.top + view.height, scope.top + scope.height) - top) };
}
