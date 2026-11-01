-- Plano 4, F10 review: indexes of the console catalog (raw SQL: Prisma cannot declare them).

-- "Game_name_lower_idx" (lower(name) on every game, 20261102090000_releases_calendar) also serves
-- findStubByName's `stub AND lower(name) = lower($1)`, so F1's partial index is redundant.
DROP INDEX IF EXISTS "Game_stub_name_lower_idx";

-- Queue of the IGDB details step (lib/sync/igdb-catalog.ts): IGDB-only stubs without details,
-- least recently attempted first, then the newest releases.
CREATE INDEX IF NOT EXISTS "Game_igdb_details_queue_idx"
  ON "Game" ("lastSyncAttemptAt" ASC NULLS FIRST, "releaseDate" DESC NULLS LAST, id)
  WHERE stub AND "steamAppId" IS NULL AND "igdbId" IS NOT NULL AND "detailsSyncedAt" IS NULL;
