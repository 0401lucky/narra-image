import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateRedemption,
  mockFindCode,
  mockFindRedemption,
  mockReserveCode,
  mockTransaction,
  mockUpdateUser,
} = vi.hoisted(() => ({
  mockCreateRedemption: vi.fn(),
  mockFindCode: vi.fn(),
  mockFindRedemption: vi.fn(),
  mockReserveCode: vi.fn(),
  mockTransaction: vi.fn(async (callback) =>
    callback({
      redeemCode: {
        findUnique: mockFindCode,
        updateMany: mockReserveCode,
      },
      redeemRedemption: {
        create: mockCreateRedemption,
        findUnique: mockFindRedemption,
      },
      user: {
        update: mockUpdateUser,
      },
    }),
  ),
  mockUpdateUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: mockTransaction,
  },
}));

import { claimRedeemCode, normalizeRedeemCode } from "@/lib/redeem-codes";

describe("积分兑换码", () => {
  beforeEach(() => {
    mockCreateRedemption.mockReset();
    mockFindCode.mockReset();
    mockFindRedemption.mockReset();
    mockReserveCode.mockReset();
    mockTransaction.mockClear();
    mockUpdateUser.mockReset();
  });

  it("兑换码会统一去空格并转大写", () => {
    expect(normalizeRedeemCode(" ab cd-01 ")).toBe("ABCD-01");
  });

  it("首次兑换成功后增加积分并写入兑换记录", async () => {
    mockFindCode.mockResolvedValue({
      batch: { isActive: true },
      id: "code_1",
      isActive: true,
      maxRedemptions: 10,
      redeemedCount: 2,
      rewardCredits: 80,
    });
    mockFindRedemption.mockResolvedValue(null);
    mockReserveCode.mockResolvedValue({ count: 1 });
    mockUpdateUser.mockResolvedValue({ credits: 580 });

    const result = await claimRedeemCode({
      code: " spring ",
      userId: "user_1",
    });

    expect(result).toEqual({
      code: "SPRING",
      credits: 580,
      rewardCredits: 80,
    });
    expect(mockCreateRedemption).toHaveBeenCalledWith({
      data: {
        codeId: "code_1",
        rewardCredits: 80,
        userId: "user_1",
      },
    });
  });

  it("同一用户不能重复兑换同一个码", async () => {
    mockFindCode.mockResolvedValue({
      batch: { isActive: true },
      id: "code_1",
      isActive: true,
      maxRedemptions: 10,
      redeemedCount: 2,
      rewardCredits: 80,
    });
    mockFindRedemption.mockResolvedValue({ id: "redeem_1" });

    await expect(
      claimRedeemCode({
        code: "SPRING",
        userId: "user_1",
      }),
    ).rejects.toThrow("你已兑换过这个兑换码");
    expect(mockReserveCode).not.toHaveBeenCalled();
  });

  it("兑换次数耗尽时不增加积分", async () => {
    mockFindCode.mockResolvedValue({
      batch: { isActive: true },
      id: "code_1",
      isActive: true,
      maxRedemptions: 3,
      redeemedCount: 3,
      rewardCredits: 80,
    });
    mockFindRedemption.mockResolvedValue(null);
    mockReserveCode.mockResolvedValue({ count: 0 });

    await expect(
      claimRedeemCode({
        code: "SPRING",
        userId: "user_1",
      }),
    ).rejects.toThrow("兑换码已被领完");
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });
});
