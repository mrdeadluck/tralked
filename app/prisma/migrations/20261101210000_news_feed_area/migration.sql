-- Plan 4 F7: external headline feeds per area (GAMES | ENTRETENIMENTO | TECNOLOGIA).
-- Additive: existing feeds and headlines keep reading as GAMES.

-- AlterTable
ALTER TABLE "NewsFeed" ADD COLUMN "area" TEXT NOT NULL DEFAULT 'GAMES';

-- AlterTable
ALTER TABLE "ExternalNews" ADD COLUMN "area" TEXT NOT NULL DEFAULT 'GAMES';

-- CreateIndex
CREATE INDEX "ExternalNews_area_publishedAt_idx" ON "ExternalNews"("area", "publishedAt");
