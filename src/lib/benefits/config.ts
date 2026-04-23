import "server-only";

import { db } from "@/lib/db";
import { buildCheckInDateKey } from "@/lib/benefits/check-in";

export const DEFAULT_CHECK_IN_REWARD = 50;
const DEFAULT_SCOPE = "default";

export async function getBenefitConfig() {
  const config = await db.benefitConfig.findUnique({
    where: { scope: DEFAULT_SCOPE },
  });

  return {
    checkInReward: config?.checkInReward ?? DEFAULT_CHECK_IN_REWARD,
  };
}

export async function updateBenefitConfig(checkInReward: number) {
  return db.benefitConfig.upsert({
    where: { scope: DEFAULT_SCOPE },
    update: { checkInReward },
    create: {
      checkInReward,
      scope: DEFAULT_SCOPE,
    },
  });
}

export async function getCheckInSummary(userId: string | null) {
  const { checkInReward } = await getBenefitConfig();
  const dateKey = buildCheckInDateKey(new Date());

  if (!userId) {
    return {
      checkInReward,
      checkedInToday: false,
      dateKey,
    };
  }

  const record = await db.checkInRecord.findUnique({
    where: {
      userId_dateKey: {
        dateKey,
        userId,
      },
    },
  });

  return {
    checkInReward,
    checkedInToday: Boolean(record),
    dateKey,
  };
}
