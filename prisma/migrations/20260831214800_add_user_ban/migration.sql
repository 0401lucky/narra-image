-- Additive: 用户封禁时间戳（可空；非空即封禁，解封置回 NULL）
ALTER TABLE "User" ADD COLUMN "bannedAt" TIMESTAMP(3);