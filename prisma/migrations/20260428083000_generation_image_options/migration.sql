ALTER TABLE "GenerationJob" ADD COLUMN "quality" TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE "GenerationJob" ADD COLUMN "outputFormat" TEXT NOT NULL DEFAULT 'png';
ALTER TABLE "GenerationJob" ADD COLUMN "outputCompression" INTEGER;
ALTER TABLE "GenerationJob" ADD COLUMN "moderation" TEXT NOT NULL DEFAULT 'auto';
