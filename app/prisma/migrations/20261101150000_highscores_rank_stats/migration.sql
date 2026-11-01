-- Plano 4 (F6): highscores totals per user and scope, and the daily rank snapshots behind the
-- rank arrows. Additive and safe on a live database: two new tables. Existing users get their
-- UserRankStats rows from `pnpm highscores:backfill` (or their next recompute).

-- CreateTable
CREATE TABLE "UserRankStats" (
    "userId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "playtimeMin" INTEGER NOT NULL DEFAULT 0,
    "achievements" INTEGER NOT NULL DEFAULT 0,
    "rareAchievements" INTEGER NOT NULL DEFAULT 0,
    "legendaryAchievements" INTEGER NOT NULL DEFAULT 0,
    "perfectGames" INTEGER NOT NULL DEFAULT 0,
    "gamesOwned" INTEGER NOT NULL DEFAULT 0,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "acervo" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserRankStats_pkey" PRIMARY KEY ("userId","scope")
);

-- CreateTable
CREATE TABLE "RankSnapshot" (
    "board" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RankSnapshot_pkey" PRIMARY KEY ("board","day","userId")
);

-- CreateIndex
CREATE INDEX "UserRankStats_scope_playtimeMin_idx" ON "UserRankStats"("scope", "playtimeMin");

-- CreateIndex
CREATE INDEX "UserRankStats_scope_achievements_idx" ON "UserRankStats"("scope", "achievements");

-- CreateIndex
CREATE INDEX "UserRankStats_scope_rareAchievements_legendaryAchievements_idx" ON "UserRankStats"("scope", "rareAchievements", "legendaryAchievements");

-- CreateIndex
CREATE INDEX "UserRankStats_scope_perfectGames_idx" ON "UserRankStats"("scope", "perfectGames");

-- CreateIndex
CREATE INDEX "UserRankStats_scope_acervo_idx" ON "UserRankStats"("scope", "acervo");

-- CreateIndex
CREATE INDEX "RankSnapshot_day_idx" ON "RankSnapshot"("day");

-- CreateIndex
CREATE INDEX "RankSnapshot_userId_idx" ON "RankSnapshot"("userId");

-- AddForeignKey
ALTER TABLE "UserRankStats" ADD CONSTRAINT "UserRankStats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankSnapshot" ADD CONSTRAINT "RankSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
