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

import { findOrCreateOAuthUser } from "@/lib/auth/linuxdo-oauth";

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
      select: { id: true, nickname: true },
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
});
