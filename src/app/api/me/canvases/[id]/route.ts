import { readCanvasJson } from "@/lib/canvas/body-limit";
import { CANVAS_LIMITS } from "@/lib/canvas/contracts";
import { deleteCanvas, getCanvas, renameCanvas } from "@/lib/canvas/documents";
import { canvasJson, parseCanvasInput, withCanvasOwner } from "@/lib/canvas/http";
import { canvasClientIdSchema, canvasDeleteSchema, canvasRenameSchema } from "@/lib/validators";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  return withCanvasOwner(async (ownerId) => canvasJson(await getCanvas(ownerId, parseCanvasInput(canvasClientIdSchema, (await context.params).id))));
}

export async function PATCH(request: Request, context: Context) {
  return withCanvasOwner(async (ownerId) => {
    const id = parseCanvasInput(canvasClientIdSchema, (await context.params).id);
    const input = parseCanvasInput(canvasRenameSchema, await readCanvasJson(request, CANVAS_LIMITS.metadataBodyBytes));
    return canvasJson(await renameCanvas(ownerId, id, input));
  });
}

export async function DELETE(request: Request, context: Context) {
  return withCanvasOwner(async (ownerId) => {
    const id = parseCanvasInput(canvasClientIdSchema, (await context.params).id);
    const input = parseCanvasInput(canvasDeleteSchema, await readCanvasJson(request, CANVAS_LIMITS.metadataBodyBytes));
    return canvasJson(await deleteCanvas(ownerId, id, input.expectedRevision));
  });
}
