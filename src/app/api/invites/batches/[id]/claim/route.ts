import { requireTurnstile } from "@/lib/auth/turnstile";
import { createInviteClaimService } from "@/lib/invites/claim-invite";
import { claimInviteFromBatch } from "@/lib/invites/claim-invite.server";
import { getErrorMessage, jsonError, jsonOk, parseJsonBody } from "@/lib/server/http";
import { inviteClaimSchema } from "@/lib/validators";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const raw = await parseJsonBody(request).catch(() => ({}));
    const body = inviteClaimSchema.parse(raw);
    await requireTurnstile("inviteRedeem", body.turnstileToken);
    const service = createInviteClaimService({
      assignInvite: claimInviteFromBatch,
    });
    const result = await service.claim(id);

    return jsonOk(result);
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
