CREATE INDEX "GenerationJob_userId_createdAt_idx"
    ON "GenerationJob" ("userId", "createdAt" DESC);

CREATE INDEX "GenerationJob_status_createdAt_idx"
    ON "GenerationJob" ("status", "createdAt");

CREATE INDEX "GenerationImage_showcaseStatus_featuredAt_id_idx"
    ON "GenerationImage" ("showcaseStatus", "featuredAt" DESC, "id" DESC);

CREATE INDEX "GenerationImage_jobId_createdAt_idx"
    ON "GenerationImage" ("jobId", "createdAt");

CREATE INDEX "GenerationImage_createdAt_id_idx"
    ON "GenerationImage" ("createdAt" DESC, "id" DESC);
