-- Plano 4, F11: name search of /jogos (stubs of the full catalog included, ~150k names) and of
-- the libraries, ignoring accents, case and punctuation. Both extensions ship with the official
-- postgres image (contrib) and are trusted, so no superuser is needed on PostgreSQL 13+.
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- The one normalization of names and queries (lib/search/normalize.ts calls it for the query, so
-- both sides fold the same way): lower case, accents removed, apostrophes dropped ("Baldur's" ->
-- "baldurs"), any other run of non-alphanumerics as one space. IMMUTABLE is safe because the
-- unaccent dictionary is named explicitly.
CREATE OR REPLACE FUNCTION tralked_search_name(input text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT btrim(regexp_replace(
    regexp_replace(lower(public.unaccent('public.unaccent'::regdictionary, coalesce(input, ''))), '[''’`´]', '', 'g'),
    '[^[:alnum:]]+', ' ', 'g'))
$$;

-- AlterTable
ALTER TABLE "Game" ADD COLUMN "searchName" TEXT;

-- Backfill before the trigger and the indexes exist (one pass over the catalog).
UPDATE "Game" SET "searchName" = tralked_search_name(name);

-- Every writer (Steam catalog import, syncs, IGDB import, admin, seed) gets it for free.
CREATE OR REPLACE FUNCTION tralked_game_search_name() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."searchName" := tralked_search_name(NEW.name);
  RETURN NEW;
END
$$;

CREATE TRIGGER "Game_searchName_trigger"
BEFORE INSERT OR UPDATE OF name ON "Game"
FOR EACH ROW EXECUTE FUNCTION tralked_game_search_name();

-- CreateIndex
CREATE INDEX "Game_searchName_idx" ON "Game" USING GIN ("searchName" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Game_stub_popularity_name_idx" ON "Game"("stub", "popularity" DESC, "name");
