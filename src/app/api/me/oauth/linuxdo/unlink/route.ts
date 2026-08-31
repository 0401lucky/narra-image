import { unlinkLinuxDoAccount } from "@/lib/auth/linuxdo-oauth";
import { getCurrentUserRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/server/http";

export async function POST() {
  try {
    const user = await getCurrentUserRecord();
    if (!user) {
      return jsonError("未登录", 401);
    }

    const result = await unlinkLinuxDoAccount(user.id);
    if (!result.ok) {
      const message =
        result.reason === "password_required"
          ? "该账号仅通过第三方登录创建，请先设置密码后再解绑"
          : result.reason === "not_linked"
            ? "该账号未绑定 LinuxDo"
            : "操作失败，请重试";
      return jsonError(message, 400);
    }

    return jsonOk({ unlinked: true });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}