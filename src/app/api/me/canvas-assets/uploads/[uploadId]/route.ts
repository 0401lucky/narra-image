import { getCanvasUpload } from "@/lib/canvas/assets";
import { canvasJson, parseCanvasInput, withCanvasOwner } from "@/lib/canvas/http";
import { canvasClientIdSchema } from "@/lib/validators";

export async function GET(_request: Request, context: { params: Promise<{ uploadId: string }> }) {
  return withCanvasOwner(async (ownerId) => {
    const uploadId = parseCanvasInput(canvasClientIdSchema, (await context.params).uploadId);
    const asset = await getCanvasUpload(ownerId, uploadId);
    return canvasJson({ asset }, asset.state === "UPLOADING" ? 202 : 200);
  });
}
