-- Plano 4, F11 (review round 1).
--
-- 1. The name fold no longer depends on the database locale: `[^[:alnum:]]` under a C/POSIX
--    LC_CTYPE (common on hosted Postgres) treats every non-ASCII letter as punctuation, which
--    folded Japanese or Cyrillic names to ''. Separators are now an explicit list (ASCII
--    punctuation and whitespace plus common Unicode and CJK punctuation); letters of any script
--    are kept. Must stay in step with foldName (src/lib/search/fold.ts).
--    (lower() still follows LC_CTYPE: under C only ASCII is lowercased, on names and queries
--    alike, so the database search stays consistent with itself.)
CREATE OR REPLACE FUNCTION tralked_search_name(input text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT btrim(regexp_replace(
    regexp_replace(lower(public.unaccent('public.unaccent'::regdictionary, coalesce(input, ''))), '[''’`´]', '', 'g'),
    '[[:space:] 　!"#$%&()*+,./:;<=>?@^_{|}~\[\]\\\-–—‐‒…·•“”„«»‹›¿¡™®©°・「」『』【】、。：！？（）／～]+', ' ', 'g'))
$$;

-- Refold the catalog with the new rules (the trigger only fires on insert/rename). One pass over
-- "Game"; row locks only, readers are not blocked.
UPDATE "Game" SET "searchName" = tralked_search_name(name)
WHERE "searchName" IS DISTINCT FROM tralked_search_name(name);

-- 2. The "Nome" order of /jogos (stubs left out) reads an index instead of sorting the catalog.
-- CreateIndex
CREATE INDEX "Game_stub_name_idx" ON "Game"("stub", "name");
