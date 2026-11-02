-- Item 14: Steam concurrent players (steam-players worker). One small row per sampled game, updated
-- in place every hour: last sample, the day's peak and the highest peak Tralked measured. No history.
-- Item 15: the RetroAchievements catalog (retro-catalog worker), light rows linked to Game through
-- GamePlatformLink (platform 'retro'); achievement lists are read on demand.
-- Additive only: two new tables; existing tables are not rewritten (the foreign key only references
-- "Game", whose rows are not touched).

-- CreateTable
CREATE TABLE "SteamPlayerCount" (
    "gameId" TEXT NOT NULL,
    "current" INTEGER NOT NULL,
    "sampledAt" TIMESTAMP(3) NOT NULL,
    "todayPeak" INTEGER NOT NULL,
    "todayPeakDay" DATE NOT NULL,
    "allTimePeak" INTEGER NOT NULL,
    "allTimePeakAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SteamPlayerCount_pkey" PRIMARY KEY ("gameId")
);

-- CreateTable
CREATE TABLE "RetroCatalogGame" (
    "id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "consoleId" INTEGER NOT NULL,
    "consoleName" TEXT NOT NULL,
    "iconPath" TEXT,
    "achievementCount" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "setModifiedAt" TIMESTAMP(3),
    "matchedAt" TIMESTAMP(3),
    "achievementsSyncedAt" TIMESTAMP(3),

    CONSTRAINT "RetroCatalogGame_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "SteamPlayerCount" ADD CONSTRAINT "SteamPlayerCount_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
