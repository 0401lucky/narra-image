-- CreateEnum
CREATE TYPE "PromptSourceStatus" AS ENUM ('IDLE', 'SYNCING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "PromptSource" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "rawBaseUrl" TEXT NOT NULL,
    "parser" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "PromptSourceStatus" NOT NULL DEFAULT 'IDLE',
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptLibraryItem" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "remoteId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "coverUrl" TEXT,
    "preview" TEXT,
    "previewUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptLibraryItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PromptSource_slug_key" ON "PromptSource"("slug");

-- CreateIndex
CREATE INDEX "PromptSource_isEnabled_sortOrder_idx" ON "PromptSource"("isEnabled", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PromptLibraryItem_sourceId_remoteId_key" ON "PromptLibraryItem"("sourceId", "remoteId");

-- CreateIndex
CREATE INDEX "PromptLibraryItem_sourceId_sortOrder_idx" ON "PromptLibraryItem"("sourceId", "sortOrder");

-- CreateIndex
CREATE INDEX "PromptLibraryItem_createdAt_idx" ON "PromptLibraryItem"("createdAt");

-- CreateIndex
CREATE INDEX "PromptLibraryItem_updatedAt_idx" ON "PromptLibraryItem"("updatedAt");

-- AddForeignKey
ALTER TABLE "PromptLibraryItem" ADD CONSTRAINT "PromptLibraryItem_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "PromptSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
