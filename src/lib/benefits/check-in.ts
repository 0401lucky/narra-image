type CheckInResult = {
  checkedIn: boolean;
  credits: number | null;
  dateKey: string;
  rewardCredits: number;
};

type CreateCheckInServiceInput = {
  applyReward: (input: {
    dateKey: string;
    rewardCredits: number;
    userId: string;
  }) => Promise<{
    credits: number;
  }>;
  getRewardCredits: () => Promise<number>;
  now?: () => Date;
};

export function buildCheckInDateKey(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Shanghai",
    year: "numeric",
  })
    .format(date)
    .replace(/\//g, "-");
}

function isDuplicateCheckInError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

export function createCheckInService(input: CreateCheckInServiceInput) {
  const getNow = input.now ?? (() => new Date());

  return {
    async checkIn(userId: string): Promise<CheckInResult> {
      const rewardCredits = await input.getRewardCredits();
      const dateKey = buildCheckInDateKey(getNow());

      try {
        const user = await input.applyReward({
          dateKey,
          rewardCredits,
          userId,
        });

        return {
          checkedIn: true,
          credits: user.credits,
          dateKey,
          rewardCredits,
        };
      } catch (error) {
        if (isDuplicateCheckInError(error)) {
          return {
            checkedIn: false,
            credits: null,
            dateKey,
            rewardCredits,
          };
        }

        throw error;
      }
    },
  };
}
