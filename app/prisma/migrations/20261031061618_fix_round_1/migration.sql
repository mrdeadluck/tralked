-- DropForeignKey
ALTER TABLE "Family" DROP CONSTRAINT "Family_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "Guide" DROP CONSTRAINT "Guide_authorId_fkey";

-- DropForeignKey
ALTER TABLE "GuideRevision" DROP CONSTRAINT "GuideRevision_authorId_fkey";

-- DropForeignKey
ALTER TABLE "GuideTip" DROP CONSTRAINT "GuideTip_authorId_fkey";

-- AlterTable
ALTER TABLE "Family" ALTER COLUMN "ownerId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Guide" ADD COLUMN     "collectibles" JSONB NOT NULL DEFAULT '[]',
ALTER COLUMN "authorId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "GuideRevision" ALTER COLUMN "authorId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "GuideTip" ALTER COLUMN "authorId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "XpLedgerEntry" ADD COLUMN     "skillPoints" JSONB;

-- CreateIndex
CREATE INDEX "GuideRevision_guideId_idx" ON "GuideRevision"("guideId");

-- CreateIndex
CREATE INDEX "GuideTip_guideId_idx" ON "GuideTip"("guideId");

-- CreateIndex
CREATE INDEX "GuideVote_tipId_idx" ON "GuideVote"("tipId");

-- CreateIndex
CREATE INDEX "SkillProgress_skill_level_points_idx" ON "SkillProgress"("skill", "level", "points");

-- CreateIndex
CREATE INDEX "UserAchievement_achievementId_idx" ON "UserAchievement"("achievementId");

-- CreateIndex
CREATE INDEX "UserAchievement_userId_unlockedAt_idx" ON "UserAchievement"("userId", "unlockedAt");

-- CreateIndex
CREATE INDEX "UserGame_gameId_idx" ON "UserGame"("gameId");

-- CreateIndex
CREATE INDEX "UserStats_totalXp_idx" ON "UserStats"("totalXp");

-- CreateIndex
CREATE INDEX "UserStats_level_idx" ON "UserStats"("level");

-- CreateIndex
CREATE INDEX "XpLedgerEntry_userId_createdAt_idx" ON "XpLedgerEntry"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Guide" ADD CONSTRAINT "Guide_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuideTip" ADD CONSTRAINT "GuideTip_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuideRevision" ADD CONSTRAINT "GuideRevision_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Family" ADD CONSTRAINT "Family_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
