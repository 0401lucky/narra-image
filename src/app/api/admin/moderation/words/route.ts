import { getSensitiveWordsSnapshot } from "@/lib/moderation/sensitive-words";
import { requireAdminRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/server/http";

export async function GET() {
  try {
    await requireAdminRecord();
    return jsonOk({ categories: getSensitiveWordsSnapshot() });
  } catch (error) {
    return jsonError(getErrorMessage(error), 403);
  }
}