-- Steam user review totals and the last media attempt of each game (catalog-enrich worker).
-- Nullable columns without defaults: a catalog change only, no table rewrite.
ALTER TABLE "Game" ADD COLUMN "steamReviewPositive" INTEGER,
ADD COLUMN "steamReviewTotal" INTEGER,
ADD COLUMN "steamReviewsAt" TIMESTAMP(3),
ADD COLUMN "mediaCheckedAt" TIMESTAMP(3);
