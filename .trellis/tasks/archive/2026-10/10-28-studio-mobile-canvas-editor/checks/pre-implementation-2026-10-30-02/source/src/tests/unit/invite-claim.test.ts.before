import { createInviteClaimService } from "@/lib/invites/claim-invite";

describe("公开邀请码领取", () => {
  it("从开放批次里分配一枚未领取未使用的邀请码", async () => {
    const assignInvite = vi.fn(async () => ({
      batchId: "batch_1",
      code: "ABCD1234",
      note: "首批内测",
    }));
    const service = createInviteClaimService({
      assignInvite,
    });

    const result = await service.claim("batch_1");

    expect(assignInvite).toHaveBeenCalledWith("batch_1");
    expect(result).toEqual({
      batchId: "batch_1",
      code: "ABCD1234",
      note: "首批内测",
      registerUrl: "/register?inviteCode=ABCD1234",
    });
  });

  it("没有可领取邀请码时返回明确错误", async () => {
    const service = createInviteClaimService({
      assignInvite: vi.fn(async () => null),
    });

    await expect(service.claim("batch_1")).rejects.toThrow("当前批次邀请码已领完");
  });
});
