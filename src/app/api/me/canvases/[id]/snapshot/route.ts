import { readCanvasJson } from "@/lib/canvas/body-limit";
import { CANVAS_LIMITS } from "@/lib/canvas/contracts";
import { saveCanvasSnapshot } from "@/lib/canvas/documents";
import { canvasJson, parseCanvasInput, withCanvasOwner } from "@/lib/canvas/http";
import { canvasClientIdSchema, canvasSnapshotSchema } from "@/lib/validators";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return withCanvasOwner(async (ownerId) => {
    const id = parseCanvasInput(canvasClientIdSchema, (await context.params).id);
    const input = parseCanvasInput(canvasSnapshotSchema, await readCanvasJson(request, CANVAS_LIMITS.snapshotBodyBytes));
    return canvasJson(await saveCanvasSnapshot(ownerId, id, input));
  });
}
