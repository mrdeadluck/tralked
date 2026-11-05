-- AlterTable
ALTER TABLE "Achievement" ADD COLUMN     "listId" TEXT;

-- CreateTable
CREATE TABLE "TrophyList" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "console" TEXT,
    "name" TEXT NOT NULL,
    "serviceName" TEXT,
    "conceptId" INTEGER,
    "region" TEXT,
    "trophyCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrophyList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserTrophyList" (
    "userId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "unlockedCount" INTEGER NOT NULL,
    "hardcoreCount" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserTrophyList_pkey" PRIMARY KEY ("userId","listId")
);

-- CreateIndex
CREATE INDEX "TrophyList_gameId_platform_idx" ON "TrophyList"("gameId", "platform");

-- CreateIndex
CREATE INDEX "TrophyList_conceptId_idx" ON "TrophyList"("conceptId");

-- CreateIndex
CREATE UNIQUE INDEX "TrophyList_platform_externalId_key" ON "TrophyList"("platform", "externalId");

-- CreateIndex
CREATE INDEX "UserTrophyList_listId_idx" ON "UserTrophyList"("listId");

-- DropIndex
DROP INDEX "Achievement_gameId_platform_apiName_key";

-- CreateIndex
CREATE INDEX "Achievement_gameId_platform_idx" ON "Achievement"("gameId", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "Achievement_listId_apiName_key" ON "Achievement"("listId", "apiName");

-- AddForeignKey
ALTER TABLE "Achievement" ADD CONSTRAINT "Achievement_listId_fkey" FOREIGN KEY ("listId") REFERENCES "TrophyList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrophyList" ADD CONSTRAINT "TrophyList_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTrophyList" ADD CONSTRAINT "UserTrophyList_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTrophyList" ADD CONSTRAINT "UserTrophyList_listId_fkey" FOREIGN KEY ("listId") REFERENCES "TrophyList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
