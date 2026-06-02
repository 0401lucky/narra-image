import { getErrorMessage, jsonError, jsonOk } from "@/lib/server/http";
import { listPrompts } from "@/lib/prompts/service";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") || "1");
    const pageSize = Number(url.searchParams.get("pageSize") || "24");
    const keyword = url.searchParams.get("keyword") || "";
    const source = url.searchParams.get("source") || undefined;
    const tags = url.searchParams.getAll("tag");

    if (!Number.isFinite(page) || page < 1) {
      return jsonError("page 参数无效", 400);
    }
    if (!Number.isFinite(pageSize) || pageSize < 1) {
      return jsonError("pageSize 参数无效", 400);
    }

    return jsonOk(await listPrompts({ keyword, page, pageSize, source, tags }));
  } catch (error) {
    return jsonError(getErrorMessage(error), 500);
  }
}
