-- CreateTable
CREATE TABLE "GameSlugRedirect" (
    "fromSlug" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameSlugRedirect_pkey" PRIMARY KEY ("fromSlug")
);

-- CreateTable
CREATE TABLE "GameEdition" (
    "gameId" TEXT NOT NULL,
    "otherId" TEXT NOT NULL,

    CONSTRAINT "GameEdition_pkey" PRIMARY KEY ("gameId","otherId")
);

-- CreateIndex
CREATE INDEX "GameSlugRedirect_gameId_idx" ON "GameSlugRedirect"("gameId");

-- CreateIndex
CREATE INDEX "GameEdition_otherId_idx" ON "GameEdition"("otherId");

-- AddForeignKey
ALTER TABLE "GameSlugRedirect" ADD CONSTRAINT "GameSlugRedirect_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameEdition" ADD CONSTRAINT "GameEdition_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameEdition" ADD CONSTRAINT "GameEdition_otherId_fkey" FOREIGN KEY ("otherId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
