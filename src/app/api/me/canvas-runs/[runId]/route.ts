import { canvasJson, parseCanvasInput, withCanvasOwner } from "@/lib/canvas/http";
import { getCanvasRun } from "@/lib/canvas/runs";
import { canvasClientIdSchema } from "@/lib/validators";

type Context = { params: Promise<{ runId: string }> };

export async function GET(_request: Request, context: Context) {
  return withCanvasOwner(async (ownerId) => {
    const runId = parseCanvasInput(canvasClientIdSchema, (await context.params).runId);
    const lookup = await getCanvasRun(ownerId, runId);
    return lookup.state === "PREPARING"
      ? canvasJson(lookup, 202, { "Retry-After": String(Math.ceil(lookup.retryAfterMs / 1_000)) })
      : canvasJson(lookup);
  });
}
