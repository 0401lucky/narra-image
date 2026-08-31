-- Additive: 内容审核（ContentReview 触发记录 + ModerationConfig 配置），均为新表
CREATE TABLE "ContentReview" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "negativePrompt" TEXT,
    "hitWords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "category" TEXT,
    "aiScore" DOUBLE PRECISION,
    "aiModel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentReview_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ModerationConfig" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'default',
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "sensitiveWordsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "aiEnabled" BOOLEAN NOT NULL DEFAULT false,
    "aiBaseUrl" TEXT,
    "aiApiKeyEncrypted" TEXT,
    "aiModel" TEXT DEFAULT 'text-moderation-latest',
    "aiThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModerationConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ModerationConfig_scope_key" ON "ModerationConfig"("scope");

CREATE INDEX "ContentReview_createdAt_idx" ON "ContentReview"("createdAt");
CREATE INDEX "ContentReview_kind_createdAt_idx" ON "ContentReview"("kind", "createdAt");
CREATE INDEX "ContentReview_userId_createdAt_idx" ON "ContentReview"("userId", "createdAt");

ALTER TABLE "ContentReview" ADD CONSTRAINT "ContentReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;