-- AlterTable
ALTER TABLE "Article" ADD COLUMN     "reviewedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Guide" ADD COLUMN     "sources" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "GuideAchievementNote" ADD COLUMN     "tipBlocks" JSONB;

-- AlterTable
ALTER TABLE "GuideStep" ADD COLUMN     "blocks" JSONB;

-- AlterTable
ALTER TABLE "IngestionLog" ADD COLUMN     "requestHash" TEXT,
ADD COLUMN     "response" JSONB;

