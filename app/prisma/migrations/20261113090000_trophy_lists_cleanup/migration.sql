-- Trophy lists, phase d (cleanup): every Achievement belongs to a TrophyList.
-- Refuses to run while any row has no list (the phase a backfill and finish fill them in);
-- production had none on 2026-11-06.
DO $$
DECLARE
  listless bigint;
BEGIN
  SELECT count(*) INTO listless FROM "Achievement" WHERE "listId" IS NULL;
  IF listless > 0 THEN
    RAISE EXCEPTION 'trophy_lists_cleanup: % Achievement row(s) without a list (listId IS NULL). Give them a list before making listId required.', listless;
  END IF;
END
$$;

-- AlterTable
ALTER TABLE "Achievement" ALTER COLUMN "listId" SET NOT NULL;
