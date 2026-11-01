import { describe, expect, it } from "vitest";

import { beginCanvasMove, finishCanvasMove, previewCanvasMove } from "@/components/create/canvas/mobile-interaction";

const target = { ownerId: "owner-one", canvasId: "canvas-one", nodeId: "node-one" };
const position = { x: -300, y: 120 };
const client = { x: 200, y: 100 };

describe("captured one-pointer movement", () => {
  it.each([0.1, 0.5, 1, 2])("converts preview through the starting camera at zoom %s and accepts a single final drop", (zoom) => {
    const viewport = { x: -25, y: 40, zoom };
    const start = beginCanvasMove(target, 7, client, position, viewport)!;
    const preview = previewCanvasMove(start, 7, { x: 250, y: 125 })!;
    expect(start.position).toEqual(position);
    expect(preview.position).toEqual({ x: -300 + 50 / zoom, y: 120 + 25 / zoom });
    expect(finishCanvasMove(preview, { target, position, viewport, pointerId: 7, pointerCount: 1 })).toEqual(preview.position);
  });

  it.each(["second-finger", "pointer", "owner", "canvas", "node", "position", "camera"])("rejects a %s interruption without accepting the preview", (kind) => {
    const viewport = { x: 0, y: 0, zoom: 1 };
    const preview = previewCanvasMove(beginCanvasMove(target, 7, client, position, viewport)!, 7, { x: 250, y: 150 })!;
    const current = { target: { ...target }, position: { ...position }, viewport: { ...viewport }, pointerId: 7, pointerCount: 1 };
    if (kind === "second-finger") current.pointerCount = 2;
    if (kind === "pointer") current.pointerId = 8;
    if (kind === "owner") current.target.ownerId = "owner-two";
    if (kind === "canvas") current.target.canvasId = "canvas-two";
    if (kind === "node") current.target.nodeId = "node-two";
    if (kind === "position") current.position.x += 1;
    if (kind === "camera") current.viewport.zoom = 0.5;
    expect(finishCanvasMove(preview, current)).toBeNull();
  });

  it("does not treat a tap, nonfinite pointer or invalid zoom as a completed edit", () => {
    const viewport = { x: 0, y: 0, zoom: 1 };
    const start = beginCanvasMove(target, 7, client, position, viewport)!;
    expect(finishCanvasMove(start, { target, position, viewport, pointerId: 7, pointerCount: 1 })).toBeNull();
    expect(previewCanvasMove(start, 7, { x: NaN, y: 100 })).toBeNull();
    expect(beginCanvasMove(target, 7, client, position, { ...viewport, zoom: 0 })).toBeNull();
  });
});
