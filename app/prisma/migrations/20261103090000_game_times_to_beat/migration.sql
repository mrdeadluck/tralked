-- IGDB times to beat in three levels (rushed, main story, 100%), filled in bulk by the igdb-catalog job.
-- Nullable columns without defaults: a catalog change only, no table rewrite.
ALTER TABLE "Game" ADD COLUMN "timeToBeatHastyMin" INTEGER,
ADD COLUMN "timeToBeatNormalMin" INTEGER,
ADD COLUMN "timeToBeatCheckedAt" TIMESTAMP(3);
