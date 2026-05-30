ALTER TYPE "GenerationStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';

ALTER TABLE "GenerationJob"
  ADD COLUMN "workerManaged" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "workerId" TEXT,
  ADD COLUMN "lockedAt" TIMESTAMP(3),
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "completedAt" TIMESTAMP(3),
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "providerChannelId" TEXT,
  ADD COLUMN "providerBaseUrl" TEXT,
  ADD COLUMN "providerApiKeyEncrypted" TEXT,
  ADD COLUMN "providerRemember" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "providerLabel" TEXT,
  ADD COLUMN "providerModels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "seed" INTEGER;

CREATE INDEX "GenerationJob_providerChannelId_idx" ON "GenerationJob"("providerChannelId");
CREATE INDEX "GenerationJob_workerManaged_status_lockedAt_createdAt_idx"
  ON "GenerationJob"("workerManaged", "status", "lockedAt", "createdAt");
