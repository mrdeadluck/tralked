-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "detailsRequestedAt" TIMESTAMP(3),
ADD COLUMN     "detailsSyncedAt" TIMESTAMP(3),
ADD COLUMN     "popularity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "stub" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "UserGame" ADD COLUMN     "checkedPlaytimeMin" INTEGER,
ADD COLUMN     "lastPlayedAt" TIMESTAMP(3),
ADD COLUMN     "playtime2WeeksMin" INTEGER,
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

-- CreateIndex
CREATE INDEX "Game_stub_detailsSyncedAt_popularity_idx" ON "Game"("stub", "detailsSyncedAt", "popularity");

-- AddForeignKey
ALTER TABLE "WishlistItem" ADD CONSTRAINT "WishlistItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WishlistItem" ADD CONSTRAINT "WishlistItem_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Games already completed from the Steam store (catalog bootstrap: Steam media written) need no
-- details fetch.
UPDATE "Game" g SET "detailsSyncedAt" = g."updatedAt"
WHERE g."steamAppId" IS NOT NULL AND EXISTS (SELECT 1 FROM "GameMedia" m WHERE m."gameId" = g.id AND m.source = 'steam');
