-- CreateTable
CREATE TABLE "TurnstileConfig" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'default',
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "siteKey" TEXT,
    "secretEncrypted" TEXT,
    "protectLogin" BOOLEAN NOT NULL DEFAULT true,
    "protectRegister" BOOLEAN NOT NULL DEFAULT true,
    "protectInviteRedeem" BOOLEAN NOT NULL DEFAULT true,
    "protectGenerate" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TurnstileConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TurnstileConfig_scope_key" ON "TurnstileConfig"("scope");
