import { readCanvasJson } from "@/lib/canvas/body-limit";
import { CANVAS_LIMITS } from "@/lib/canvas/contracts";
import { canvasJson, parseCanvasInput, withCanvasOwner } from "@/lib/canvas/http";
import { resolveCanvasRuntime } from "@/lib/canvas/runtime";
import { canvasRuntimeResolveSchema } from "@/lib/validators";

export async function POST(request: Request) {
  return withCanvasOwner(async (ownerId) => {
    const input = parseCanvasInput(canvasRuntimeResolveSchema, await readCanvasJson(request, CANVAS_LIMITS.resolveBodyBytes));
    return canvasJson(await resolveCanvasRuntime(ownerId, input));
  });
}
