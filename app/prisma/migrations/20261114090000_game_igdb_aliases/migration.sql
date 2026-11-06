-- IGDB ids of duplicates joined into a game (mergeGames): the IGDB imports find the game by them
-- instead of creating the duplicate again. Backfilled for the 2026-11-06 joins by
-- `pnpm games:igdb-aliases`.

-- CreateTable
CREATE TABLE "GameIgdbAlias" (
    "igdbId" INTEGER NOT NULL,
    "gameId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameIgdbAlias_pkey" PRIMARY KEY ("igdbId")
);

-- CreateIndex
CREATE INDEX "GameIgdbAlias_gameId_idx" ON "GameIgdbAlias"("gameId");

-- AddForeignKey
ALTER TABLE "GameIgdbAlias" ADD CONSTRAINT "GameIgdbAlias_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
