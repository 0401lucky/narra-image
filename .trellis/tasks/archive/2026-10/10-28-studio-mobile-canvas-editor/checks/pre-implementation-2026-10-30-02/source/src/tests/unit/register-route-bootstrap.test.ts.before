import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockEnv,
  mockHashPassword,
  mockInviteUpsert,
  mockRegisterUser,
  mockRequireTurnstile,
  mockTransaction,
} = vi.hoisted(() => ({
  mockEnv: {
    AUTH_SECRET: "unit-test-secret",
    BOOTSTRAP_ADMIN_EMAIL: "",
    BOOTSTRAP_INVITE_CODE: "",
  },
  mockHashPassword: vi.fn(),
  mockInviteUpsert: vi.fn(),
  mockRegisterUser: vi.fn(),
  mockRequireTurnstile: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    inviteCode: { upsert: mockInviteUpsert },
    $transaction: mockTransaction,
  },
}));

vi.mock("@/lib/env", () => ({
  getEnv: () => mockEnv,
}));

vi.mock("@/lib/auth/password", () => ({
  hashPassword: mockHashPassword,
}));

vi.mock("@/lib/auth/register-user", () => ({
  registerUser: mockRegisterUser,
}));

vi.mock("@/lib/auth/turnstile", () => ({
  requireTurnstile: mockRequireTurnstile,
}));

vi.mock("@/lib/auth/session", () => ({
  attachSessionCookie: vi.fn(),
}));

import { POST } from "@/app/api/auth/register/route";

function registerRequest() {
  return new Request("http://localhost/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email: "new-user@example.com",
      inviteCode: "",
      password: "password123",
    }),
  });
}

describe("注册接口初始邀请码", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.BOOTSTRAP_INVITE_CODE = "";
    mockHashPassword.mockResolvedValue("hashed-password");
    mockRegisterUser.mockResolvedValue({ ok: false, message: "邀请码已失效" });
    mockTransaction.mockImplementation(async (callback) => callback({}));
  });

  it("未显式配置时不创建公开默认邀请码", async () => {
    const response = await POST(registerRequest());

    expect(response.status).toBe(400);
    expect(mockInviteUpsert).not.toHaveBeenCalled();
  });

  it("仅在显式配置时创建初始邀请码", async () => {
    mockEnv.BOOTSTRAP_INVITE_CODE = "private-bootstrap-code";

    await POST(registerRequest());

    expect(mockInviteUpsert).toHaveBeenCalledWith({
      where: { code: "private-bootstrap-code" },
      update: {},
      create: {
        code: "private-bootstrap-code",
        note: "初始管理员邀请码",
      },
    });
  });
});
