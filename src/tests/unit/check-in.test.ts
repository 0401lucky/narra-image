import { buildCheckInDateKey, createCheckInService } from "@/lib/benefits/check-in";

describe("签到逻辑", () => {
  it("按北京时间生成自然日日期键", () => {
    expect(buildCheckInDateKey(new Date("2026-04-23T15:59:59.000Z"))).toBe("2026-04-23");
    expect(buildCheckInDateKey(new Date("2026-04-23T16:00:00.000Z"))).toBe("2026-04-24");
  });

  it("当天首次签到成功后增加积分", async () => {
    const applyReward = vi.fn(async () => ({ credits: 550 }));
    const service = createCheckInService({
      applyReward,
      getRewardCredits: async () => 50,
      now: () => new Date("2026-04-23T01:23:45.000Z"),
    });

    const result = await service.checkIn("user_1");

    expect(result).toEqual({
      checkedIn: true,
      credits: 550,
      dateKey: "2026-04-23",
      rewardCredits: 50,
    });
    expect(applyReward).toHaveBeenCalledWith({
      dateKey: "2026-04-23",
      rewardCredits: 50,
      userId: "user_1",
    });
  });

  it("当天重复签到时不重复加分", async () => {
    const service = createCheckInService({
      applyReward: vi.fn(async () => {
        const error = new Error("duplicate");
        Object.assign(error, { code: "P2002" });
        throw error;
      }),
      getRewardCredits: async () => 50,
      now: () => new Date("2026-04-23T10:00:00.000Z"),
    });

    const result = await service.checkIn("user_1");

    expect(result).toEqual({
      checkedIn: false,
      credits: null,
      dateKey: "2026-04-23",
      rewardCredits: 50,
    });
  });
});
