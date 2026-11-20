-- Additive: 创作台工作台记录隐藏时间戳（可空；隐藏仅作用于 /create 列表，不删除作品或计费审计）
ALTER TABLE "GenerationJob" ADD COLUMN "studioHiddenAt" TIMESTAMP(3);

CREATE INDEX "GenerationJob_userId_studioHiddenAt_createdAt_idx"
    ON "GenerationJob"("userId", "studioHiddenAt", "createdAt" DESC);
