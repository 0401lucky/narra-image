import { CanvasContractError } from "@/lib/canvas/contracts";
import { parseCanvasPageQuery } from "@/lib/canvas/cursors";
import { stringifyLogRecord } from "@/lib/logging/redact";
import { ConversationContentError, listConversationGenerations } from "@/lib/server/conversation-generations";
import { getCurrentUserRecord } from "@/lib/server/current-user";
import { jsonError, jsonOk } from "@/lib/server/http";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  let response: Response;
  try {
    const user = await getCurrentUserRecord();
    if (!user) {
      response = jsonError("未登录", 401, "CONVERSATION_UNAUTHENTICATED");
    } else {
      const { id } = await context.params;
      const page = parseCanvasPageQuery(request.url, { ownerId: user.id, scope: "conversation", parentId: id });
      response = jsonOk(await listConversationGenerations({ ownerId: user.id, conversationId: id, ...page }));
    }
  } catch (error) {
    if (error instanceof ConversationContentError) {
      response = jsonError(error.message, error.status, error.code);
    } else if (error instanceof CanvasContractError) {
      response = jsonError("会话分页参数不正确", 400, "CONVERSATION_INVALID_INPUT");
    } else {
      console.error(stringifyLogRecord({ event: "conversation.generations.failed", code: "CONVERSATION_LOAD_FAILED" }));
      response = jsonError("会话加载失败，请稍后重试", 500, "CONVERSATION_LOAD_FAILED");
    }
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
