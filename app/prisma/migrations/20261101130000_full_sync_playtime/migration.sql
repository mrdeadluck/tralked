-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "detailsRequestedAt" TIMESTAMP(3),
ADD COLUMN     "detailsSyncedAt" TIMESTAMP(3),
ADD COLUMN     "popularity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "stub" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "UserGame" ADD COLUMN     "checkedPlaytimeMin" INTEGER,
ADD COLUMN     "lastPlayedAt" TIMESTAMP(3),
ADD COLUMN     "playtime2WeeksMin" INTEGER,
ADD COLUMN     "playtimePaidMin" INTEGER,
ADD COLUMN     "playtimeUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "WishlistItem" (
    "userId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'steam',
    "priority" INTEGER,
    "addedAt" TIMESTAMP(3),

    CONSTRAINT "WishlistItem_pkey" PRIMARY KEY ("userId","gameId","platform")
);

-- CreateTable
CREATE TABLE "SyncCursor" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncCursor_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "WishlistItem_gameId_idx" ON "WishlistItem"("gameId");

-- Queue of the Steam details job (lib/sync/steam-catalog.ts detailsCandidates): games without
-- details, never attempted first, then the most popular. Partial, so it stays small once the
-- catalog is filled in; Prisma cannot declare partial indexes in the schema.
CREATE INDEX "Game_details_queue_idx" ON "Game"("lastSyncAttemptAt" ASC NULLS FIRST, "popularity" DESC)
WHERE "detailsSyncedAt" IS NULL AND "steamAppId" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "WishlistItem" ADD CONSTRAINT "WishlistItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WishlistItem" ADD CONSTRAINT "WishlistItem_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Games already completed from the Steam store (catalog bootstrap: Steam media written) need no
-- details fetch.
UPDATE "Game" g SET "detailsSyncedAt" = g."updatedAt"
WHERE g."steamAppId" IS NOT NULL AND EXISTS (SELECT 1 FROM "GameMedia" m WHERE m."gameId" = g.id AND m.source = 'steam');

-- RetroAchievements reports UserTotalPlaytime in seconds (API_GetGameInfoAndUserProgress docblock:
-- "total time the user has spent playing the game, in seconds"), but it was stored as minutes. Every
-- RA row written before this migration (all of them: playtimeUpdatedAt was just added, so NULL)
-- holds seconds: convert them once.
UPDATE "UserGame" SET "playtimeMin" = round("playtimeMin" / 60.0)
WHERE platform = 'retro' AND "playtimeUpdatedAt" IS NULL;

-- Xbox titles whose minutes were asked, on the connection row (cleared on unlink, removed with it).
ALTER TABLE "LinkedAccount" ADD COLUMN "minutesChecked" JSONB;

-- PSN/Xbox/RA titles are matched to stubs of the full Steam catalog by exact name, ignoring case
-- (lib/sync/platform-games.ts findStubByName: lower(name) = lower($1) on stubs).
CREATE INDEX "Game_stub_name_lower_idx" ON "Game"(lower(name)) WHERE stub;
