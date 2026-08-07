-- Disposable legacy snapshot for worker-contracts verification only.
-- 这不是空库 migration 历史证明，只表示新增 contract v1 migration
-- 执行前 Worker 所需的最小 legacy schema。

CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');
CREATE TYPE "ProviderMode" AS ENUM ('BUILT_IN', 'CUSTOM');
CREATE TYPE "GenerationStatus" AS ENUM (
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'PROCESSING'
);
CREATE TYPE "GenerationType" AS ENUM (
  'TEXT_TO_IMAGE',
  'IMAGE_TO_IMAGE',
  'TEXT_TO_VIDEO',
  'IMAGE_TO_VIDEO'
);
CREATE TYPE "GenerationClientSource" AS ENUM ('WEB', 'API');
CREATE TYPE "ShowcaseStatus" AS ENUM (
  'PRIVATE',
  'PENDING',
  'FEATURED',
  'TAKEDOWN_PENDING'
);

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT,
  "nickname" TEXT,
  "avatarUrl" TEXT,
  "oauthProvider" TEXT,
  "oauthId" TEXT,
  "role" "Role" NOT NULL DEFAULT 'USER',
  "credits" INTEGER NOT NULL DEFAULT 500,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_oauthProvider_oauthId_idx"
  ON "User"("oauthProvider", "oauthId");

CREATE TABLE "ProviderChannel" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "baseUrl" TEXT NOT NULL,
  "apiKeyEncrypted" TEXT NOT NULL,
  "defaultModel" TEXT NOT NULL,
  "models" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "creditCost" INTEGER NOT NULL DEFAULT 5,
  "videoCreditCost" INTEGER NOT NULL DEFAULT 20,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProviderChannel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderChannel_slug_key"
  ON "ProviderChannel"("slug");

CREATE TABLE "GenerationJob" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "apiKeyId" TEXT,
  "workerManaged" BOOLEAN NOT NULL DEFAULT false,
  "workerId" TEXT,
  "lockedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "conversationId" TEXT,
  "clientSource" "GenerationClientSource" NOT NULL DEFAULT 'WEB',
  "generationType" "GenerationType" NOT NULL DEFAULT 'TEXT_TO_IMAGE',
  "providerMode" "ProviderMode" NOT NULL,
  "providerChannelId" TEXT,
  "providerBaseUrl" TEXT,
  "providerApiKeyEncrypted" TEXT,
  "providerRemember" BOOLEAN NOT NULL DEFAULT false,
  "providerLabel" TEXT,
  "providerModels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "model" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "negativePrompt" TEXT,
  "size" TEXT NOT NULL,
  "quality" TEXT NOT NULL DEFAULT 'auto',
  "outputFormat" TEXT NOT NULL DEFAULT 'png',
  "outputCompression" INTEGER,
  "moderation" TEXT NOT NULL DEFAULT 'auto',
  "seed" INTEGER,
  "sourceImageUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "durationSeconds" INTEGER,
  "aspectRatio" TEXT,
  "count" INTEGER NOT NULL,
  "status" "GenerationStatus" NOT NULL DEFAULT 'PENDING',
  "errorMessage" TEXT,
  "creditsSpent" INTEGER NOT NULL DEFAULT 0,
  "featuredAt" TIMESTAMP(3),
  "featuredById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GenerationJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GenerationJob_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "GenerationJob_apiKeyId_idx"
  ON "GenerationJob"("apiKeyId");
CREATE INDEX "GenerationJob_apiKeyId_clientSource_createdAt_idx"
  ON "GenerationJob"("apiKeyId", "clientSource", "createdAt");
CREATE INDEX "GenerationJob_clientSource_idx"
  ON "GenerationJob"("clientSource");
CREATE INDEX "GenerationJob_conversationId_idx"
  ON "GenerationJob"("conversationId");
CREATE INDEX "GenerationJob_providerChannelId_idx"
  ON "GenerationJob"("providerChannelId");
CREATE INDEX "GenerationJob_userId_createdAt_idx"
  ON "GenerationJob"("userId", "createdAt" DESC);
CREATE INDEX "GenerationJob_status_createdAt_idx"
  ON "GenerationJob"("status", "createdAt");
CREATE INDEX "GenerationJob_workerManaged_status_lockedAt_createdAt_idx"
  ON "GenerationJob"("workerManaged", "status", "lockedAt", "createdAt");

CREATE TABLE "GenerationImage" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "showcaseStatus" "ShowcaseStatus" NOT NULL DEFAULT 'PRIVATE',
  "showPromptPublic" BOOLEAN NOT NULL DEFAULT false,
  "submittedAt" TIMESTAMP(3),
  "featuredAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "reviewNote" TEXT,
  "reviewedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GenerationImage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GenerationImage_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "GenerationJob"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "GenerationImage_showcaseStatus_featuredAt_id_idx"
  ON "GenerationImage"("showcaseStatus", "featuredAt" DESC, "id" DESC);
CREATE INDEX "GenerationImage_jobId_createdAt_idx"
  ON "GenerationImage"("jobId", "createdAt");
CREATE INDEX "GenerationImage_createdAt_id_idx"
  ON "GenerationImage"("createdAt" DESC, "id" DESC);

CREATE TABLE "GeneratedVideo" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "posterUrl" TEXT,
  "width" INTEGER,
  "height" INTEGER,
  "durationSeconds" INTEGER,
  "showcaseStatus" "ShowcaseStatus" NOT NULL DEFAULT 'PRIVATE',
  "showPromptPublic" BOOLEAN NOT NULL DEFAULT false,
  "submittedAt" TIMESTAMP(3),
  "featuredAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "reviewNote" TEXT,
  "reviewedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GeneratedVideo_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GeneratedVideo_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "GenerationJob"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "GeneratedVideo_showcaseStatus_featuredAt_id_idx"
  ON "GeneratedVideo"("showcaseStatus", "featuredAt" DESC, "id" DESC);
CREATE INDEX "GeneratedVideo_jobId_createdAt_idx"
  ON "GeneratedVideo"("jobId", "createdAt");
CREATE INDEX "GeneratedVideo_createdAt_id_idx"
  ON "GeneratedVideo"("createdAt" DESC, "id" DESC);

CREATE TABLE "SavedProviderConfig" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "label" TEXT,
  "baseUrl" TEXT NOT NULL,
  "apiKeyEncrypted" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "models" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SavedProviderConfig_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SavedProviderConfig_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SavedProviderConfig_userId_key"
  ON "SavedProviderConfig"("userId");

CREATE TABLE "_prisma_migrations" (
  "id" VARCHAR(36) NOT NULL,
  "checksum" VARCHAR(64) NOT NULL,
  "finished_at" TIMESTAMPTZ,
  "migration_name" VARCHAR(255) NOT NULL,
  "logs" TEXT,
  "rolled_back_at" TIMESTAMPTZ,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "applied_steps_count" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "_prisma_migrations_pkey" PRIMARY KEY ("id")
);

-- WORKER_CONTRACTS_BASELINE_MIGRATION: 20260423165000_single_image_works
-- WORKER_CONTRACTS_BASELINE_MIGRATION: 20260427090000_likes_redeem_codes_multi_sources
-- WORKER_CONTRACTS_BASELINE_MIGRATION: 20260428083000_generation_image_options
-- WORKER_CONTRACTS_BASELINE_MIGRATION: 20260502143000_add_turnstile_config
-- WORKER_CONTRACTS_BASELINE_MIGRATION: 20260502153000_generation_image_dimensions
-- WORKER_CONTRACTS_BASELINE_MIGRATION: 20260505000000_add_conversation
-- WORKER_CONTRACTS_BASELINE_MIGRATION: 20260505160000_api_keys_external_api
-- WORKER_CONTRACTS_BASELINE_MIGRATION: 20260509000000_add_performance_indexes
-- WORKER_CONTRACTS_BASELINE_MIGRATION: 20260512000000_add_login_cover_config
-- WORKER_CONTRACTS_BASELINE_MIGRATION: 20260530090000_go_worker_generation_jobs
-- WORKER_CONTRACTS_BASELINE_MIGRATION: 20260601000000_video_workspace
-- WORKER_CONTRACTS_BASELINE_MIGRATION: 20260602000000_prompt_library

INSERT INTO "_prisma_migrations" (
  "id",
  "checksum",
  "finished_at",
  "migration_name",
  "started_at",
  "applied_steps_count"
) VALUES
  ('00000000-0000-0000-0000-000000000001', '61aec657681dff69ab2a118cec0cd8a978122a84466753952ae0a8b46d354a25', CURRENT_TIMESTAMP, '20260423165000_single_image_works', CURRENT_TIMESTAMP, 1),
  ('00000000-0000-0000-0000-000000000002', '5cefb1804c280f154cbed67355aa4c9540f54b0f07f2f37a699138ab089e349e', CURRENT_TIMESTAMP, '20260427090000_likes_redeem_codes_multi_sources', CURRENT_TIMESTAMP, 1),
  ('00000000-0000-0000-0000-000000000003', 'da8ad72c4a6d853fe9bec52bc1dbd0d267a8e43f59a7a768200d5cee2fafe594', CURRENT_TIMESTAMP, '20260428083000_generation_image_options', CURRENT_TIMESTAMP, 1),
  ('00000000-0000-0000-0000-000000000004', 'd399ee2b21b47f6963f134f4eab7f5d36d4fd0df5dac99c0f41fc582715dcef9', CURRENT_TIMESTAMP, '20260502143000_add_turnstile_config', CURRENT_TIMESTAMP, 1),
  ('00000000-0000-0000-0000-000000000005', '435ee999e8f54e0ad9bffa326c9c0c9c505e1f2211686fb97f2f2716d417446a', CURRENT_TIMESTAMP, '20260502153000_generation_image_dimensions', CURRENT_TIMESTAMP, 1),
  ('00000000-0000-0000-0000-000000000006', '04a80060f732d4b629bfccd5f02a5afde431d7e0e2fc271ef08258a44e48d686', CURRENT_TIMESTAMP, '20260505000000_add_conversation', CURRENT_TIMESTAMP, 1),
  ('00000000-0000-0000-0000-000000000007', 'd0a0aa6d89e22b72360ae3c05554c7d7d1fa4b6ceddeff0d61884dcdf734921e', CURRENT_TIMESTAMP, '20260505160000_api_keys_external_api', CURRENT_TIMESTAMP, 1),
  ('00000000-0000-0000-0000-000000000008', '61bd7884d82823447130288d79978075237fcec930e69c557a598b345a5bf89a', CURRENT_TIMESTAMP, '20260509000000_add_performance_indexes', CURRENT_TIMESTAMP, 1),
  ('00000000-0000-0000-0000-000000000009', '0ac708b58bbcc92e34c5326e86a8acf92cf436a8adc319fe8050bb0a5847d7bf', CURRENT_TIMESTAMP, '20260512000000_add_login_cover_config', CURRENT_TIMESTAMP, 1),
  ('00000000-0000-0000-0000-000000000010', '0186b38f04f4cb77bc068e3e3fb40bc01f9228eee42d93eb468f28a3665497ba', CURRENT_TIMESTAMP, '20260530090000_go_worker_generation_jobs', CURRENT_TIMESTAMP, 1),
  ('00000000-0000-0000-0000-000000000011', '1c3ea7dbc95c06fc41e08ecb316cf388a459f8472d0ddd12a2737d4fd75fa97f', CURRENT_TIMESTAMP, '20260601000000_video_workspace', CURRENT_TIMESTAMP, 1),
  ('00000000-0000-0000-0000-000000000012', '30a9439362c1d061539f641c8cfee0557691b36e141e123996693dd7a0777d34', CURRENT_TIMESTAMP, '20260602000000_prompt_library', CURRENT_TIMESTAMP, 1);
