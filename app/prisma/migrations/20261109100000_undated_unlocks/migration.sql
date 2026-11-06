-- Steam achievements earned on an unknown date (achieved=1, unlocktime=0): kept with a NULL date.
-- Metadata-only on Postgres (no table rewrite).
ALTER TABLE "UserAchievement" ALTER COLUMN "unlockedAt" DROP NOT NULL;

-- Their ledger entries are dated at record time and left out of every time window.
ALTER TABLE "XpLedgerEntry" ADD COLUMN "dateUnknown" BOOLEAN NOT NULL DEFAULT false;
