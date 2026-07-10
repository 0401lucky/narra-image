import { registerUser } from "@/lib/auth/register-user";

describe("注册流程", () => {
  it("使用有效邀请码注册成功后，获得默认积分并标记邀请码已使用", async () => {
    const createUser = vi.fn(async (data: {
      email: string;
      passwordHash: string;
      role: "user" | "admin";
      credits: number;
    }) => ({ id: "user_1", ...data }));
    const markInviteUsed = vi.fn(async () => undefined);

    const result = await registerUser(
      {
        email: "new@example.com",
        password: "super-secret-password",
        inviteCode: "INVITE-001",
      },
      {
        bootstrapAdminEmail: "admin@example.com",
        initialCredits: 500,
        findUserByEmail: async () => null,
        findInviteByCode: async () => ({
          id: "invite_1",
          code: "INVITE-001",
          usedAt: null,
        }),
        hashPassword: async () => "hashed-password",
        createUser,
        markInviteUsed,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected success");
    }

    expect(result.user.role).toBe("user");
    expect(result.user.credits).toBe(500);
    expect(createUser).toHaveBeenCalledWith({
      credits: 500,
      email: "new@example.com",
      passwordHash: "hashed-password",
      role: "user",
    });
    expect(markInviteUsed).toHaveBeenCalledWith({
      inviteId: "invite_1",
      userId: "user_1",
    });
  });

  it("邀请码失效时返回错误，不创建用户", async () => {
    const createUser = vi.fn();

    const result = await registerUser(
      {
        email: "new@example.com",
        password: "super-secret-password",
        inviteCode: "USED-001",
      },
      {
        bootstrapAdminEmail: "admin@example.com",
        initialCredits: 500,
        findUserByEmail: async () => null,
        findInviteByCode: async () => ({
          id: "invite_1",
          code: "USED-001",
          usedAt: new Date("2026-04-20T00:00:00Z"),
        }),
        hashPassword: async () => "hashed-password",
        createUser,
        markInviteUsed: async () => undefined,
      },
    );

    expect(result).toEqual({
      message: "邀请码已失效",
      ok: false,
    });
    expect(createUser).not.toHaveBeenCalled();
  });

  it("当邮箱命中管理员引导配置时，创建管理员账号", async () => {
    const result = await registerUser(
      {
        email: "admin@example.com",
        password: "super-secret-password",
        inviteCode: "INVITE-002",
      },
      {
        bootstrapAdminEmail: "admin@example.com",
        initialCredits: 500,
        findUserByEmail: async () => null,
        findInviteByCode: async () => ({
          id: "invite_2",
          code: "INVITE-002",
          usedAt: null,
        }),
        hashPassword: async () => "hashed-password",
        createUser: async (data) => ({ id: "admin_1", ...data }),
        markInviteUsed: async () => undefined,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected success");
    }

    expect(result.user.role).toBe("admin");
  });

  it("管理员引导邮箱也必须提供有效邀请码", async () => {
    const createUser = vi.fn();

    const result = await registerUser(
      {
        email: "admin@example.com",
        password: "super-secret-password",
        inviteCode: "",
      },
      {
        bootstrapAdminEmail: "admin@example.com",
        initialCredits: 500,
        findUserByEmail: async () => null,
        findInviteByCode: async () => null,
        hashPassword: async () => "hashed-password",
        createUser,
        markInviteUsed: async () => undefined,
      },
    );

    expect(result).toEqual({
      message: "邀请码已失效",
      ok: false,
    });
    expect(createUser).not.toHaveBeenCalled();
  });
});
