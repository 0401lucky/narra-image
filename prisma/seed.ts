import { Role } from "@prisma/client";

import { createPrismaClient } from "./create-prisma-client";

const prisma = createPrismaClient({
  connectionString: process.env.DATABASE_URL || "",
});

async function main() {
  const bootstrapInviteCode =
    process.env.BOOTSTRAP_INVITE_CODE?.trim() || "FOUNDING-ACCESS";

  await prisma.inviteCode.upsert({
    where: { code: bootstrapInviteCode },
    update: {},
    create: {
      code: bootstrapInviteCode,
      note: "初始管理员邀请码",
    },
  });

  const bootstrapAdminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim();
  const bootstrapAdminPasswordHash =
    process.env.BOOTSTRAP_ADMIN_PASSWORD_HASH?.trim();

  if (bootstrapAdminEmail && bootstrapAdminPasswordHash) {
    await prisma.user.upsert({
      where: { email: bootstrapAdminEmail.toLowerCase() },
      update: {
        role: Role.ADMIN,
      },
      create: {
        credits: 500,
        email: bootstrapAdminEmail.toLowerCase(),
        passwordHash: bootstrapAdminPasswordHash,
        role: Role.ADMIN,
      },
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
