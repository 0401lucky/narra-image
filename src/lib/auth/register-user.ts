import type { UserRole } from "@/lib/types";

type RegisterUserInput = {
  email: string;
  password: string;
  inviteCode: string;
};

type RegisterUserDeps = {
  bootstrapAdminEmail?: string;
  initialCredits: number;
  findUserByEmail: (
    email: string,
  ) => Promise<{ id: string; email: string } | null>;
  findInviteByCode: (
    code: string,
  ) => Promise<{ id: string; code: string; usedAt: Date | null } | null>;
  hashPassword: (password: string) => Promise<string>;
  createUser: (data: {
    email: string;
    passwordHash: string;
    role: UserRole;
    credits: number;
  }) => Promise<{
    id: string;
    email: string;
    passwordHash: string | null;
    role: UserRole;
    credits: number;
  }>;
  markInviteUsed: (input: { inviteId: string; userId: string }) => Promise<void>;
};

type RegisterUserResult =
  | {
      ok: true;
      user: {
        id: string;
        email: string;
        role: UserRole;
        credits: number;
      };
    }
  | {
      ok: false;
      message: string;
    };

function isAdminEmail(email: string, bootstrapAdminEmail?: string) {
  return (
    typeof bootstrapAdminEmail === "string" &&
    bootstrapAdminEmail.trim().toLowerCase() === email.trim().toLowerCase()
  );
}

export async function registerUser(
  input: RegisterUserInput,
  deps: RegisterUserDeps,
): Promise<RegisterUserResult> {
  const email = input.email.trim().toLowerCase();
  const inviteCode = input.inviteCode.trim();
  const bootstrapAdmin = isAdminEmail(email, deps.bootstrapAdminEmail);

  const existingUser = await deps.findUserByEmail(email);
  if (existingUser) {
    return {
      ok: false,
      message: "该邮箱已注册",
    };
  }

  const invite = inviteCode ? await deps.findInviteByCode(inviteCode) : null;
  if (!bootstrapAdmin && (!invite || invite.usedAt)) {
    return {
      ok: false,
      message: "邀请码已失效",
    };
  }

  const passwordHash = await deps.hashPassword(input.password);
  const role: UserRole = bootstrapAdmin ? "admin" : "user";
  const user = await deps.createUser({
    credits: deps.initialCredits,
    email,
    passwordHash,
    role,
  });

  if (invite) {
    await deps.markInviteUsed({
      inviteId: invite.id,
      userId: user.id,
    });
  }

  return {
    ok: true,
    user: {
      credits: user.credits,
      email: user.email,
      id: user.id,
      role: user.role,
    },
  };
}
