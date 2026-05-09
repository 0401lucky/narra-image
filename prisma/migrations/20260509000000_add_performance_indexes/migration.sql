CREATE INDEX IF NOT EXISTS "GenerationJob_userId_createdAt_idx"
    ON "GenerationJob" ("userId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "GenerationJob_status_createdAt_idx"
    ON "GenerationJob" ("status", "createdAt");

CREATE INDEX IF NOT EXISTS "GenerationImage_showcaseStatus_featuredAt_id_idx"
    ON "GenerationImage" ("showcaseStatus", "featuredAt" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "GenerationImage_jobId_createdAt_idx"
    ON "GenerationImage" ("jobId", "createdAt");

CREATE INDEX IF NOT EXISTS "GenerationImage_createdAt_id_idx"
    ON "GenerationImage" ("createdAt" DESC, "id" DESC);
