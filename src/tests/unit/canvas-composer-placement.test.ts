import { describe, expect, it } from "vitest";

import { canvasComposerPlacement } from "@/components/create/canvas/composer-placement";
import { beginCanvasMove, previewCanvasMove } from "@/components/create/canvas/mobile-interaction";

describe("screen-sized composer placement", () => {
  it("prefers an available side without scaling controls with the world card", () => {
    const bounds = { left: 200, top: 100, width: 1200, height: 800 };
    const placed = canvasComposerPlacement(bounds, { left: 300, top: 200, width: 100, height: 80 }, { width: 384, height: 620 }, false);
    expect(placed).toEqual({ left: 412, top: 200, width: 384, height: 620 });
  });
  it.each([360, 390, 430])("bounds the phone sheet at %spx and short keyboard heights", (width) => {
    const bounds = { left: 0, top: 150, width, height: 220 };
    const placed = canvasComposerPlacement(bounds, { left: -1000, top: 2000, width: 30, height: 30 }, { width: 384, height: 620 }, true);
    expect(placed).toEqual(bounds);
  });
  it("keeps an offscreen desktop node's editor fully within visible bounds", () => {
    const bounds = { left: 250, top: 100, width: 350, height: 280 };
    const placed = canvasComposerPlacement(bounds, { left: 5000, top: -1000, width: 300, height: 300 }, { width: 384, height: 620 }, false);
    expect(placed).toEqual({ left: 262, top: 112, width: 326, height: 256 });
  });
  it("remembers that a pointer crossed the movement threshold even if it returns to the origin", () => {
    const gesture = beginCanvasMove({ ownerId: "owner", canvasId: "canvas", nodeId: "node" }, 1, { x: 100, y: 100 }, { x: 0, y: 0 }, { x: 0, y: 0, zoom: 0.5 })!;
    expect(previewCanvasMove(gesture, 1, { x: 102, y: 100 })!.moved).toBe(false);
    const moved = previewCanvasMove(gesture, 1, { x: 110, y: 100 })!;
    expect(moved.moved).toBe(true);
    expect(previewCanvasMove(moved, 1, { x: 100, y: 100 })!.moved).toBe(true);
  });
});
