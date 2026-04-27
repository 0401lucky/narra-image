-- CreateEnum
CREATE TYPE "RedeemCodeMode" AS ENUM ('SINGLE_USE', 'SHARED');

-- AlterTable
ALTER TABLE "GenerationJob" ADD COLUMN "sourceImageUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "GenerationJob"
SET "sourceImageUrls" = ARRAY["sourceImageUrl"]
WHERE "sourceImageUrl" IS NOT NULL AND "sourceImageUrl" <> '';

ALTER TABLE "GenerationJob" DROP COLUMN "sourceImageUrl";

-- CreateTable
CREATE TABLE "WorkLike" (
    "id" TEXT NOT NULL,
    "workId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkLike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RedeemCodeBatch" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "mode" "RedeemCodeMode" NOT NULL DEFAULT 'SINGLE_USE',
    "rewardCredits" INTEGER NOT NULL,
    "maxRedemptions" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "RedeemCodeBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RedeemCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "note" TEXT,
    "mode" "RedeemCodeMode" NOT NULL,
    "rewardCredits" INTEGER NOT NULL,
    "maxRedemptions" INTEGER NOT NULL,
    "redeemedCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "batchId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RedeemCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RedeemRedemption" (
    "id" TEXT NOT NULL,
    "codeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rewardCredits" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RedeemRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkLike_workId_userId_key" ON "WorkLike"("workId", "userId");

-- CreateIndex
CREATE INDEX "WorkLike_userId_idx" ON "WorkLike"("userId");

-- CreateIndex
CREATE INDEX "WorkLike_workId_idx" ON "WorkLike"("workId");

-- CreateIndex
CREATE UNIQUE INDEX "RedeemCode_code_key" ON "RedeemCode"("code");

-- CreateIndex
CREATE INDEX "RedeemCode_batchId_idx" ON "RedeemCode"("batchId");

-- CreateIndex
CREATE INDEX "RedeemCode_isActive_idx" ON "RedeemCode"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "RedeemRedemption_codeId_userId_key" ON "RedeemRedemption"("codeId", "userId");

-- CreateIndex
CREATE INDEX "RedeemRedemption_userId_idx" ON "RedeemRedemption"("userId");

-- CreateIndex
CREATE INDEX "RedeemRedemption_codeId_idx" ON "RedeemRedemption"("codeId");

-- AddForeignKey
ALTER TABLE "WorkLike" ADD CONSTRAINT "WorkLike_workId_fkey" FOREIGN KEY ("workId") REFERENCES "GenerationImage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkLike" ADD CONSTRAINT "WorkLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedeemCodeBatch" ADD CONSTRAINT "RedeemCodeBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedeemCode" ADD CONSTRAINT "RedeemCode_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "RedeemCodeBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedeemCode" ADD CONSTRAINT "RedeemCode_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedeemRedemption" ADD CONSTRAINT "RedeemRedemption_codeId_fkey" FOREIGN KEY ("codeId") REFERENCES "RedeemCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedeemRedemption" ADD CONSTRAINT "RedeemRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
