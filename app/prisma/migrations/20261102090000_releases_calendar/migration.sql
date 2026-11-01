-- CreateTable
CREATE TABLE "GameRelease" (
    "gameId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "date" TIMESTAMP(3),
    "dateLabel" TEXT,
    "source" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "imageUrl" TEXT,
    "seenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameRelease_pkey" PRIMARY KEY ("gameId","platform")
);

-- CreateIndex
CREATE INDEX "GameRelease_date_idx" ON "GameRelease"("date");

-- CreateIndex
CREATE INDEX "GameRelease_platform_date_idx" ON "GameRelease"("platform", "date");

-- CreateIndex
CREATE INDEX "Game_releaseDate_idx" ON "Game"("releaseDate");

-- CreateIndex
CREATE INDEX "Game_igdbId_idx" ON "Game"("igdbId");

-- Name matching of IGDB games against the whole catalog (listed games and stubs), by
-- lower(name) = lower($1) (lib/sync/igdb-games.ts). Prisma cannot declare expression indexes.
CREATE INDEX "Game_name_lower_idx" ON "Game" (lower("name"));

-- AddForeignKey
ALTER TABLE "GameRelease" ADD CONSTRAINT "GameRelease_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
