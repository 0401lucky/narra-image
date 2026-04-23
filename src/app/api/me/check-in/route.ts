import { db } from "@/lib/db";
import { createCheckInService } from "@/lib/benefits/check-in";
import { getBenefitConfig } from "@/lib/benefits/config";
import { requireCurrentUserRecord } from "@/lib/server/current-user";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/server/http";

export async function POST() {
  try {
    const user = await requireCurrentUserRecord();
    const service = createCheckInService({
      applyReward: async ({ dateKey, rewardCredits, userId }) =>
        db.$transaction(async (tx) => {
          await tx.checkInRecord.create({
            data: {
              dateKey,
              rewardCredits,
              userId,
            },
          });

          return tx.user.update({
            where: { id: userId },
            data: {
              credits: {
                increment: rewardCredits,
              },
            },
            select: {
              credits: true,
            },
          });
        }),
      getRewardCredits: async () => {
        const config = await getBenefitConfig();
        return config.checkInReward;
      },
    });

    const result = await service.checkIn(user.id);

    return jsonOk({
      checkedIn: result.checkedIn,
      credits: result.credits ?? user.credits,
      dateKey: result.dateKey,
      rewardCredits: result.rewardCredits,
    });
  } catch (error) {
    return jsonError(getErrorMessage(error), 400);
  }
}
