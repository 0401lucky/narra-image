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
    autoApproveShowcase: config?.autoApproveShowcase ?? false,
    checkInReward: config?.checkInReward ?? DEFAULT_CHECK_IN_REWARD,
  };
}

export async function updateBenefitConfig(data: {
  autoApproveShowcase?: boolean;
  checkInReward?: number;
}) {
  return db.benefitConfig.upsert({
    where: { scope: DEFAULT_SCOPE },
    update: data,
    create: {
      ...data,
      scope: DEFAULT_SCOPE,
    },
  });
}

export async function isAutoApproveShowcase() {
  const config = await getBenefitConfig();
  return config.autoApproveShowcase;
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
