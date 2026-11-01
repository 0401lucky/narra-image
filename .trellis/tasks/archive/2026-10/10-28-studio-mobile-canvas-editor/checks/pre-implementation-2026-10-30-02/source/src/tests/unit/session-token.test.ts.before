import {
  createSessionToken,
  verifySessionToken,
} from "@/lib/auth/session-token";

describe("会话令牌", () => {
  it("能完成签发与校验的往返", async () => {
    const token = await createSessionToken(
      {
        role: "admin",
        userId: "user_1",
      },
      "test-secret",
    );

    const payload = await verifySessionToken(token, "test-secret");

    expect(payload).toMatchObject({
      role: "admin",
      userId: "user_1",
    });
  });

  it("密钥错误时拒绝校验", async () => {
    const token = await createSessionToken(
      {
        role: "user",
        userId: "user_2",
      },
      "right-secret",
    );

    await expect(verifySessionToken(token, "wrong-secret")).rejects.toThrow();
  });
});
