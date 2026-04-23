-- CreateEnum
CREATE TYPE "ShowcaseStatus" AS ENUM ('PRIVATE', 'PENDING', 'FEATURED', 'TAKEDOWN_PENDING');

-- AlterTable
ALTER TABLE "GenerationImage" ADD COLUMN     "featuredAt" TIMESTAMP(3),
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "showPromptPublic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "showcaseStatus" "ShowcaseStatus" NOT NULL DEFAULT 'PRIVATE',
ADD COLUMN     "submittedAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "GenerationImage" ADD CONSTRAINT "GenerationImage_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

