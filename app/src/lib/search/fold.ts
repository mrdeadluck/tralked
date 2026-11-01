/**
 * Name search ignoring accents, case and punctuation (Plano 4, F11), pure part.
 *
 * The catalog is searched in the database: `Game.searchName` is written by a trigger with
 * `tralked_search_name(name)` (migration 20261102100000_game_name_search), and the query goes
 * through the same SQL function (normalize.ts), so both sides fold exactly alike. Lists already in
 * memory (a player's or a family's library) use `foldName`, the same rules in JavaScript.
 */

/** Longest query honored (longer input is cut). */
export const SEARCH_MAX_LENGTH = 80;

/** User input, trimmed and capped; undefined when blank. */
export function cleanQuery(raw: string | undefined | null): string | undefined {
  const value = raw?.trim().slice(0, SEARCH_MAX_LENGTH).trim();
  return value ? value : undefined;
}

/**
 * JavaScript twin of `tralked_search_name`: lower case, accents removed, apostrophes dropped,
 * any other run of non-letters/digits as one space.
 */
export function foldName(value: string): string {
  return (
    value
      // Latin accents only (unaccent leaves kana voicing marks alone).
      .normalize("NFD")
      .replace(/[̀-ͯ]+/g, "")
      .normalize("NFC")
      .toLowerCase()
      .replace(/æ/g, "ae")
      .replace(/œ/g, "oe")
      .replace(/ß/g, "ss")
      .replace(/ø/g, "o")
      .replace(/ł/g, "l")
      .replace(/['’`´]/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
  );
}

/** Whether `name` matches an already folded query (substring, like the catalog search). */
export function nameMatches(name: string, foldedQuery: string): boolean {
  return foldName(name).includes(foldedQuery);
}
