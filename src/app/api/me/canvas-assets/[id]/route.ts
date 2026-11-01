import { getCanvasAsset } from "@/lib/canvas/assets";
import { canvasJson, parseCanvasInput, withCanvasOwner } from "@/lib/canvas/http";
import { canvasCanonicalIdSchema } from "@/lib/validators";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return withCanvasOwner(async (ownerId) => {
    const id = parseCanvasInput(canvasCanonicalIdSchema, (await context.params).id);
    const asset = await getCanvasAsset(ownerId, id);
    return canvasJson({ asset }, asset.state === "UPLOADING" ? 202 : 200);
  });
}
