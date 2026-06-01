-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "GenerationType" ADD VALUE 'TEXT_TO_VIDEO';
ALTER TYPE "GenerationType" ADD VALUE 'IMAGE_TO_VIDEO';

-- AlterTable
ALTER TABLE "ProviderChannel" ADD COLUMN     "videoCreditCost" INTEGER NOT NULL DEFAULT 20;

-- AlterTable
ALTER TABLE "WorkLike" ADD COLUMN     "videoId" TEXT,
ALTER COLUMN "workId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "GenerationJob" ADD COLUMN     "aspectRatio" TEXT,
ADD COLUMN     "durationSeconds" INTEGER;

-- CreateTable
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

    CONSTRAINT "GeneratedVideo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GeneratedVideo_showcaseStatus_featuredAt_id_idx" ON "GeneratedVideo"("showcaseStatus", "featuredAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "GeneratedVideo_jobId_createdAt_idx" ON "GeneratedVideo"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "GeneratedVideo_createdAt_id_idx" ON "GeneratedVideo"("createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "WorkLike_videoId_idx" ON "WorkLike"("videoId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkLike_videoId_userId_key" ON "WorkLike"("videoId", "userId");

-- AddForeignKey
ALTER TABLE "WorkLike" ADD CONSTRAINT "WorkLike_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "GeneratedVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedVideo" ADD CONSTRAINT "GeneratedVideo_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "GenerationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedVideo" ADD CONSTRAINT "GeneratedVideo_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
