-- Guide robot: walkthrough guides (format 2), reader checkmarks per item, updates waiting for an
-- admin, the robot's request queue, and the PT-BR names of Steam achievements. Additive only.

-- AlterTable
ALTER TABLE "Guide" ADD COLUMN "format" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "walkthrough" JSONB,
ADD COLUMN "edition" INTEGER,
ADD COLUMN "compat" TEXT,
ADD COLUMN "report" JSONB;

-- AlterTable
ALTER TABLE "Achievement" ADD COLUMN "namePt" TEXT,
ADD COLUMN "descriptionPt" TEXT;

-- CreateTable
CREATE TABLE "GuideItemProgress" (
    "userId" TEXT NOT NULL,
    "guideId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuideItemProgress_pkey" PRIMARY KEY ("userId","guideId","itemKey")
);

-- CreateTable
CREATE TABLE "GuidePendingUpdate" (
    "id" TEXT NOT NULL,
    "guideId" TEXT NOT NULL,
    "botKeyId" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuidePendingUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuideRequest" (
    "id" TEXT NOT NULL,
    "steamAppId" INTEGER NOT NULL,
    "gameId" TEXT,
    "platform" TEXT NOT NULL DEFAULT 'steam',
    "status" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "firstWaitingAt" TIMESTAMP(3),
    "reason" TEXT,
    "report" JSONB,
    "guideId" TEXT,
    "requestedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuideRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Guide_edition_key" ON "Guide"("edition");

-- CreateIndex
CREATE INDEX "GuidePendingUpdate_guideId_idx" ON "GuidePendingUpdate"("guideId");

-- CreateIndex
CREATE INDEX "GuideRequest_status_priority_createdAt_idx" ON "GuideRequest"("status", "priority", "createdAt");

-- AddForeignKey
ALTER TABLE "GuideItemProgress" ADD CONSTRAINT "GuideItemProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuideItemProgress" ADD CONSTRAINT "GuideItemProgress_guideId_fkey" FOREIGN KEY ("guideId") REFERENCES "Guide"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuidePendingUpdate" ADD CONSTRAINT "GuidePendingUpdate_guideId_fkey" FOREIGN KEY ("guideId") REFERENCES "Guide"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuidePendingUpdate" ADD CONSTRAINT "GuidePendingUpdate_botKeyId_fkey" FOREIGN KEY ("botKeyId") REFERENCES "ApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;
