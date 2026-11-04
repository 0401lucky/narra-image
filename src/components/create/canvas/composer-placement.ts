export type CanvasScreenRect = { left: number; top: number; width: number; height: number };

// Screen geometry only; opening an editor must never move the scene camera.
export function canvasComposerPlacement(bounds: CanvasScreenRect, node: CanvasScreenRect | null, size: { width: number; height: number }, touch: boolean, gap = 12, attached = false): CanvasScreenRect {
  const width = Math.max(0, Math.min(size.width, bounds.width - (touch ? 0 : gap * 2)));
  const height = Math.max(0, Math.min(size.height, bounds.height - (touch ? 0 : gap * 2)));
  const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(value, Math.max(low, high)));
  if (touch) return { left: bounds.left, top: bounds.top + bounds.height - height, width: Math.max(0, bounds.width), height };
  const right = bounds.left + bounds.width, bottom = bounds.top + bounds.height;
  if (attached) return { left: clamp(node?.left ?? right - width - gap, bounds.left + gap, right - width - gap),
    top: clamp(node?.top ?? bounds.top + gap, bounds.top + gap, bottom - height - gap), width, height };
  const alongside = node && node.left + node.width + gap + width <= right - gap;
  return { left: clamp(alongside ? node.left + node.width + gap : node?.left ?? right - width - gap, bounds.left + gap, right - width - gap),
    top: clamp(alongside ? node.top : node ? node.top + node.height + gap : bounds.top + gap, bounds.top + gap, bottom - height - gap), width, height };
}
