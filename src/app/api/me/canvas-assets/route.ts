import { importCanvasAsset, readCanvasUpload, withCanvasUploadSlot } from "@/lib/canvas/assets";
import { canvasJson, withCanvasOwner } from "@/lib/canvas/http";

export async function POST(request: Request) {
  return withCanvasOwner(async (ownerId) => withCanvasUploadSlot(ownerId, async () => {
    const result = await importCanvasAsset(ownerId, await readCanvasUpload(request));
    return canvasJson({ asset: result.asset }, result.pending ? 202 : 200, result.pending ? { "Retry-After": "2" } : undefined);
  }));
}
