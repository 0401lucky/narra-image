import { readCanvasJson } from "@/lib/canvas/body-limit";
import { CANVAS_LIMITS } from "@/lib/canvas/contracts";
import { parseCanvasPageQuery } from "@/lib/canvas/cursors";
import { createCanvas, listCanvases } from "@/lib/canvas/documents";
import { canvasJson, parseCanvasInput, withCanvasOwner } from "@/lib/canvas/http";
import { canvasCreateSchema } from "@/lib/validators";

export async function GET(request: Request) {
  return withCanvasOwner(async (ownerId) => canvasJson(await listCanvases(ownerId, parseCanvasPageQuery(request.url, { ownerId, scope: "canvas", parentId: null }))));
}

export async function POST(request: Request) {
  return withCanvasOwner(async (ownerId) => {
    const input = parseCanvasInput(canvasCreateSchema, await readCanvasJson(request, CANVAS_LIMITS.metadataBodyBytes));
    return canvasJson(await createCanvas(ownerId, input));
  });
}
