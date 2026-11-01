import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb } = vi.hoisted(() => {
  const inviteCode = {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  };
  const user = {
    create: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  };
  return {
    mockDb: {
      $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({ inviteCode, user }),
      ),
      inviteCode,
      user,
    },
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: mockDb,
}));
vi.mock("@/lib/auth/oauth-config", () => ({
  getOAuthProvider: vi.fn(),
}));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    APP_URL: "https://narra.example.com",
  }),
}));

import {
  findOrCreateOAuthUser,
  linkLinuxDoAccount,
  unlinkLinuxDoAccount,
} from "@/lib/auth/linuxdo-oauth";

const baseLdUser = {
  active: true,
  avatar_url: "",
  id: 0,
  name: "",
  silenced: false,
  trust_level: 1,
  username: "tester",
};

describe("LinuxDo OAuth 用户处理", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("已有 OAuth 绑定时按最早记录更新并返回用户（跳过邀请码）", async () => {
    mockDb.user.findFirst.mockResolvedValue({
      avatarUrl: null,
      credits: 500,
      email: "old@linuxdo.oauth",
      id: "user-1",
      nickname: null,
      role: "USER",
    });
    mockDb.user.update.mockResolvedValue({
      avatarUrl: "https://linux.do/user_avatar/linux.do/tester/120/1.png",
      credits: 500,
      email: "old@linuxdo.oauth",
      id: "user-1",
      nickname: "Tester",
      role: "USER",
    });

    const result = await findOrCreateOAuthUser({
      ldUser: {
        ...baseLdUser,
        avatar_url: "/user_avatar/linux.do/tester/{size}/1.png",
        id: 42,
        name: "Tester",
        trust_level: 2,
      },
    });

    expect(mockDb.user.findFirst).toHaveBeenCalledWith({
      orderBy: { createdAt: "asc" },
      select: {
        avatarUrl: true,
        bannedAt: true,
        credits: true,
        email: true,
        id: true,
        nickname: true,
        role: true,
      },
      where: {
        oauthId: "42",
        oauthProvider: "linuxdo",
      },
    });
    expect(mockDb.user.update).toHaveBeenCalledWith({
      data: {
        avatarUrl: "https://linux.do/user_avatar/linux.do/tester/120/1.png",
        nickname: "Tester",
      },
      select: {
        avatarUrl: true,
        bannedAt: true,
        credits: true,
        email: true,
        id: true,
        nickname: true,
        role: true,
      },
      where: { id: "user-1" },
    });
    expect(mockDb.user.findUnique).not.toHaveBeenCalled();
    expect(mockDb.user.create).not.toHaveBeenCalled();
    expect(mockDb.$transaction).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user.id).toBe("user-1");
  });

  it("占位邮箱已存在时补充 OAuth 绑定（跳过邀请码）", async () => {
    mockDb.user.findFirst.mockResolvedValue(null);
    mockDb.user.findUnique.mockResolvedValue({ id: "user-2", nickname: null });
    mockDb.user.update.mockResolvedValue({
      avatarUrl: "https://avatar.example.com/2.png",
      credits: 800,
      email: "tester@linuxdo.oauth",
      id: "user-2",
      nickname: "Tester",
      role: "USER",
    });

    const result = await findOrCreateOAuthUser({
      ldUser: {
        ...baseLdUser,
        avatar_url: "https://avatar.example.com/2.png",
        id: 99,
        name: "Tester",
        trust_level: 3,
      },
    });

    expect(mockDb.user.findUnique).toHaveBeenCalledWith({
      select: { bannedAt: true, id: true, nickname: true },
      where: { email: "tester@linuxdo.oauth" },
    });
    expect(mockDb.user.update).toHaveBeenCalledWith({
      data: {
        avatarUrl: "https://avatar.example.com/2.png",
        nickname: "Tester",
        oauthId: "99",
        oauthProvider: "linuxdo",
      },
      select: {
        avatarUrl: true,
        bannedAt: true,
        credits: true,
        email: true,
        id: true,
        nickname: true,
        role: true,
      },
      where: { id: "user-2" },
    });
    expect(mockDb.user.create).not.toHaveBeenCalled();
    expect(mockDb.$transaction).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user.id).toBe("user-2");
  });

  it("全新用户未提供邀请码时返回 invite_required", async () => {
    mockDb.user.findFirst.mockResolvedValue(null);
    mockDb.user.findUnique.mockResolvedValue(null);

    const result = await findOrCreateOAuthUser({
      ldUser: {
        ...baseLdUser,
        id: 7,
        username: "tester",
      },
    });

    expect(mockDb.user.create).not.toHaveBeenCalled();
    expect(mockDb.$transaction).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invite_required");
  });

  it("邀请码无效时返回 invite_invalid", async () => {
    mockDb.user.findFirst.mockResolvedValue(null);
    mockDb.user.findUnique.mockResolvedValue(null);
    mockDb.inviteCode.findUnique.mockResolvedValue(null);

    const result = await findOrCreateOAuthUser({
      ldUser: { ...baseLdUser, id: 8 },
      inviteCode: "BAD-CODE",
    });

    expect(mockDb.inviteCode.findUnique).toHaveBeenCalledWith({
      select: { id: true, usedAt: true },
      where: { code: "BAD-CODE" },
    });
    expect(mockDb.user.create).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invite_invalid");
  });

  it("邀请码已被使用时返回 invite_invalid", async () => {
    mockDb.user.findFirst.mockResolvedValue(null);
    mockDb.user.findUnique.mockResolvedValue(null);
    mockDb.inviteCode.findUnique.mockResolvedValue({
      id: "invite-1",
      usedAt: new Date(),
    });

    const result = await findOrCreateOAuthUser({
      ldUser: { ...baseLdUser, id: 9 },
      inviteCode: "USED-CODE",
    });

    expect(mockDb.user.create).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invite_invalid");
  });

  it("有效邀请码时创建新用户并消费邀请码", async () => {
    mockDb.user.findFirst.mockResolvedValue(null);
    mockDb.user.findUnique.mockResolvedValue(null);
    mockDb.inviteCode.findUnique.mockResolvedValue({
      id: "invite-2",
      usedAt: null,
    });
    mockDb.inviteCode.updateMany.mockResolvedValue({ count: 1 });
    mockDb.user.create.mockResolvedValue({
      avatarUrl: null,
      credits: 500,
      email: "tester@linuxdo.oauth",
      id: "user-3",
      nickname: "tester",
      role: "USER",
    });
    mockDb.inviteCode.update.mockResolvedValue({});

    const result = await findOrCreateOAuthUser({
      ldUser: { ...baseLdUser, id: 7 },
      inviteCode: " VALID-CODE ",
    });

    expect(mockDb.$transaction).toHaveBeenCalledOnce();
    expect(mockDb.inviteCode.findUnique).toHaveBeenCalledWith({
      select: { id: true, usedAt: true },
      where: { code: "VALID-CODE" },
    });
    expect(mockDb.inviteCode.updateMany).toHaveBeenCalledWith({
      data: { usedAt: expect.any(Date) },
      where: { id: "invite-2", usedAt: null },
    });
    expect(mockDb.user.create).toHaveBeenCalledWith({
      data: {
        avatarUrl: null,
        credits: 500,
        email: "tester@linuxdo.oauth",
        nickname: "tester",
        oauthId: "7",
        oauthProvider: "linuxdo",
      },
      select: {
        avatarUrl: true,
        bannedAt: true,
        credits: true,
        email: true,
        id: true,
        nickname: true,
        role: true,
      },
    });
    expect(mockDb.inviteCode.update).toHaveBeenCalledWith({
      data: {
        usedById: "user-3",
      },
      where: { id: "invite-2" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user.id).toBe("user-3");
  });

  it("邀请码被并发抢占时返回 invite_invalid 且不创建用户", async () => {
    mockDb.user.findFirst.mockResolvedValue(null);
    mockDb.user.findUnique.mockResolvedValue(null);
    // 读到时还未使用，但条件占用时已被并发事务抢先消费
    mockDb.inviteCode.findUnique.mockResolvedValue({
      id: "invite-3",
      usedAt: null,
    });
    mockDb.inviteCode.updateMany.mockResolvedValue({ count: 0 });

    const result = await findOrCreateOAuthUser({
      ldUser: { ...baseLdUser, id: 10 },
      inviteCode: "RACED-CODE",
    });

    expect(mockDb.inviteCode.updateMany).toHaveBeenCalledWith({
      data: { usedAt: expect.any(Date) },
      where: { id: "invite-3", usedAt: null },
    });
    expect(mockDb.user.create).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invite_invalid");
  });

  it("已有 OAuth 绑定但账号已被封禁时返回 banned", async () => {
    mockDb.user.findFirst.mockResolvedValue({
      avatarUrl: null,
      bannedAt: new Date(),
      credits: 500,
      email: "old@linuxdo.oauth",
      id: "user-1",
      nickname: null,
      role: "USER",
    });

    const result = await findOrCreateOAuthUser({
      ldUser: { ...baseLdUser, id: 42, name: "Tester" },
    });

    expect(mockDb.user.update).not.toHaveBeenCalled();
    expect(mockDb.$transaction).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("banned");
  });

  it("占位邮箱命中已封禁账号时返回 banned", async () => {
    mockDb.user.findFirst.mockResolvedValue(null);
    mockDb.user.findUnique.mockResolvedValue({
      bannedAt: new Date(),
      id: "user-2",
      nickname: null,
    });

    const result = await findOrCreateOAuthUser({
      ldUser: { ...baseLdUser, id: 99, name: "Tester" },
    });

    expect(mockDb.user.update).not.toHaveBeenCalled();
    expect(mockDb.user.create).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("banned");
  });

  it("linkLinuxDoAccount：成功把 LinuxDo 绑定到当前账号", async () => {
    mockDb.user.findUnique.mockResolvedValue({
      bannedAt: null,
      id: "user-4",
      nickname: null,
    });
    mockDb.user.findFirst.mockResolvedValue(null);
    mockDb.user.update.mockResolvedValue({});

    const result = await linkLinuxDoAccount({
      ldUser: { ...baseLdUser, id: 200, name: "Binder" },
      userId: "user-4",
    });

    expect(mockDb.user.findFirst).toHaveBeenCalledWith({
      select: { id: true },
      where: { oauthId: "200", oauthProvider: "linuxdo" },
    });
    expect(mockDb.user.update).toHaveBeenCalledWith({
      data: {
        nickname: "Binder",
        oauthId: "200",
        oauthProvider: "linuxdo",
      },
      where: { id: "user-4" },
    });
    expect(result.ok).toBe(true);
  });

  it("linkLinuxDoAccount：已绑定同一 LinuxDo 时幂等成功", async () => {
    mockDb.user.findUnique.mockResolvedValue({
      bannedAt: null,
      id: "user-5",
      nickname: "Binder",
    });
    mockDb.user.findFirst.mockResolvedValue({ id: "user-5" });

    const result = await linkLinuxDoAccount({
      ldUser: { ...baseLdUser, id: 201, name: "Binder" },
      userId: "user-5",
    });

    expect(mockDb.user.update).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it("linkLinuxDoAccount：LinuxDo 已被其他账号绑定时返回 conflict", async () => {
    mockDb.user.findUnique.mockResolvedValue({
      bannedAt: null,
      id: "user-6",
      nickname: null,
    });
    mockDb.user.findFirst.mockResolvedValue({ id: "user-other" });

    const result = await linkLinuxDoAccount({
      ldUser: { ...baseLdUser, id: 202, name: "Binder" },
      userId: "user-6",
    });

    expect(mockDb.user.update).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("conflict");
  });

  it("linkLinuxDoAccount：当前账号被封禁时返回 banned", async () => {
    mockDb.user.findUnique.mockResolvedValue({
      bannedAt: new Date(),
      id: "user-7",
      nickname: null,
    });

    const result = await linkLinuxDoAccount({
      ldUser: { ...baseLdUser, id: 203, name: "Binder" },
      userId: "user-7",
    });

    expect(mockDb.user.findFirst).not.toHaveBeenCalled();
    expect(mockDb.user.update).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("banned");
  });

  it("linkLinuxDoAccount：目标用户不存在时返回 unknown_user", async () => {
    mockDb.user.findUnique.mockResolvedValue(null);

    const result = await linkLinuxDoAccount({
      ldUser: { ...baseLdUser, id: 204, name: "Binder" },
      userId: "missing-user",
    });

    expect(mockDb.user.findFirst).not.toHaveBeenCalled();
    expect(mockDb.user.update).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unknown_user");
  });

  it("unlinkLinuxDoAccount：纯 OAuth 注册账号禁止解绑", async () => {
    mockDb.user.findUnique.mockResolvedValue({
      id: "user-8",
      oauthId: "300",
      oauthProvider: "linuxdo",
      passwordHash: null,
    });

    const result = await unlinkLinuxDoAccount("user-8");

    expect(mockDb.user.update).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("password_required");
  });

  it("unlinkLinuxDoAccount：未绑定账号返回 not_linked", async () => {
    mockDb.user.findUnique.mockResolvedValue({
      id: "user-9",
      oauthId: null,
      oauthProvider: null,
      passwordHash: "hashed",
    });

    const result = await unlinkLinuxDoAccount("user-9");

    expect(mockDb.user.update).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_linked");
  });

  it("unlinkLinuxDoAccount：有密码的账号解绑成功并置空 OAuth 字段", async () => {
    mockDb.user.findUnique.mockResolvedValue({
      id: "user-10",
      oauthId: "301",
      oauthProvider: "linuxdo",
      passwordHash: "hashed",
    });
    mockDb.user.update.mockResolvedValue({});

    const result = await unlinkLinuxDoAccount("user-10");

    expect(mockDb.user.update).toHaveBeenCalledWith({
      data: { oauthId: null, oauthProvider: null },
      where: { id: "user-10" },
    });
    expect(result.ok).toBe(true);
  });
});
