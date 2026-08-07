-- CreateEnum
CREATE TYPE "GenerationHandoffState" AS ENUM (
  'NOT_STARTED',
  'SUBMITTING',
  'SUBMITTED',
  'UNKNOWN',
  'RESOLVED'
);

-- CreateEnum
CREATE TYPE "GenerationAttemptStatus" AS ENUM (
  'CLAIMED',
  'SUBMITTING',
  'SUBMITTED',
  'SUCCEEDED',
  'FAILED_RETRYABLE',
  'FAILED_FINAL',
  'UNKNOWN'
);

-- AlterTable: legacy writers keep contractVersion=0 and handoffState=NULL.
ALTER TABLE "GenerationJob"
  ADD COLUMN "contractVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "errorCode" TEXT,
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "handoffState" "GenerationHandoffState",
  ADD COLUMN "cancelRequestedAt" TIMESTAMP(3),
  ADD COLUMN "refundAppliedAt" TIMESTAMP(3);

-- Every v1+ row must expose an explicit handoff state. Legacy writers keep
-- contractVersion=0 and may continue writing NULL.
ALTER TABLE "GenerationJob"
  ADD CONSTRAINT "GenerationJob_contract_handoff_state_check"
  CHECK ("contractVersion" < 1 OR "handoffState" IS NOT NULL);

-- Database-level guard for old finalizers. A CHECK cannot distinguish a
-- zero-credit custom job from an attempted refund, so use OLD/NEW transition
-- data: when a positive reservation is cleared from an unresolved handoff,
-- the same UPDATE must explicitly move the row to RESOLVED. NULL or
-- NOT_STARTED cannot be used to bypass the guard.
CREATE FUNCTION "guard_generation_job_unresolved_refund"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."contractVersion" >= 1
    AND OLD."creditsSpent" > 0
    AND NEW."creditsSpent" = 0
    AND OLD."handoffState" IN ('SUBMITTING', 'SUBMITTED', 'UNKNOWN')
    AND NEW."handoffState" IS DISTINCT FROM 'RESOLVED'
  THEN
    RAISE EXCEPTION 'cannot clear credits for unresolved generation handoff'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "GenerationJob_unresolved_refund_guard"
BEFORE UPDATE OF "creditsSpent", "handoffState", "contractVersion"
ON "GenerationJob"
FOR EACH ROW
EXECUTE FUNCTION "guard_generation_job_unresolved_refund"();

-- CreateTable
CREATE TABLE "GenerationAttempt" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "workerId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "providerChannelId" TEXT,
  "model" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" "GenerationAttemptStatus" NOT NULL DEFAULT 'CLAIMED',
  "providerRequestId" TEXT,
  "upstreamSubmittedAt" TIMESTAMP(3),
  "nextRetryAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),

  CONSTRAINT "GenerationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GenerationAttempt_jobId_ordinal_key"
  ON "GenerationAttempt"("jobId", "ordinal");
CREATE INDEX "GenerationAttempt_jobId_createdAt_idx"
  ON "GenerationAttempt"("jobId", "createdAt");
CREATE INDEX "GenerationAttempt_status_updatedAt_idx"
  ON "GenerationAttempt"("status", "updatedAt");
CREATE INDEX "GenerationAttempt_providerRequestId_idx"
  ON "GenerationAttempt"("providerRequestId");
CREATE INDEX "GenerationAttempt_nextRetryAt_idx"
  ON "GenerationAttempt"("nextRetryAt");
CREATE INDEX "GenerationJob_userId_status_createdAt_idx"
  ON "GenerationJob"("userId", "status", "createdAt");
CREATE INDEX "GenerationJob_workerManaged_status_nextAttemptAt_createdAt_idx"
  ON "GenerationJob"("workerManaged", "status", "nextAttemptAt", "createdAt");

-- AddForeignKey
ALTER TABLE "GenerationAttempt"
  ADD CONSTRAINT "GenerationAttempt_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "GenerationJob"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
