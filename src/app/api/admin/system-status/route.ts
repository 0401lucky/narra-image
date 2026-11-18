import { getAdminShellSummary } from "@/lib/server/admin-overview";
import { requireAdminRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdminRecord();
    const summary = await getAdminShellSummary();
    return jsonOk({ summary });
  } catch (error) {
    return jsonError(getErrorMessage(error), 403);
  }
}
