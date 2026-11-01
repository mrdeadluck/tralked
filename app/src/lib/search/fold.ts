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
 * Separators folded to one space: the same explicit list as `tralked_search_name` (migration
 * 20261102110000_game_search_fold_v2), so letters of any script are kept whatever the locale.
 */
const SEPARATORS = /[\s 　!"#$%&()*+,./:;<=>?@^_{|}~[\]\\\-–—‐‒…·•“”„«»‹›¿¡™®©°・「」『』【】、。：！？（）／～]+/g;

/** Sorts names the Portuguese way (accents and case after the base letter). */
export const compareNames = new Intl.Collator("pt-BR").compare;

/**
 * JavaScript twin of `tralked_search_name`: lower case, accents removed, apostrophes dropped,
 * punctuation and whitespace runs as one space.
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
      // unaccent writes these as "(C)" and "(R)" ("Six® Siege" -> "six r siege").
      .replace(/©/g, "(c)")
      .replace(/®/g, "(r)")
      .replace(/['’`´]/g, "")
      .replace(SEPARATORS, " ")
      .trim()
  );
}

/** Whether `name` matches an already folded query (substring, like the catalog search). */
export function nameMatches(name: string, foldedQuery: string): boolean {
  return foldName(name).includes(foldedQuery);
}
