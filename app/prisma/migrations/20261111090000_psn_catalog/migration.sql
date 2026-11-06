-- CreateTable
CREATE TABLE "PsnCatalogList" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "console" TEXT,
    "serviceName" TEXT NOT NULL,
    "trophyCount" INTEGER NOT NULL,
    "tiers" JSONB NOT NULL,
    "matchedAt" TIMESTAMP(3),
    "trophiesSyncedAt" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PsnCatalogList_pkey" PRIMARY KEY ("id")
);
