/**
 * Normalizes a game title for matching across sources (platform title lists, IGDB, RSS):
 * lowercase ASCII words, without accents, trademark signs and punctuation.
 * `Hollow Knight™: Voidheart Edition` -> `hollow knight voidheart edition`.
 */
export function normalizeTitle(title: string): string {
  return title
    // Before NFKD, which would turn ™ into "TM".
    .replace(/[™®©]/g, "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Platform title lists append these to the game's name (`Hades (PS5)`, `RE4 PS4 & PS5`). */
const PLATFORM_SUFFIX = /(\s+(and\s+)?(ps3|ps4|ps5|vita|psvita|xbox one|xbox series x s|xbox series|xbox 360|pc|windows|trophies|trophy set)\b)+$/;

/** `normalizeTitle` without trailing platform tags. */
export function normalizePlatformTitle(title: string): string {
  return normalizeTitle(title).replace(PLATFORM_SUFFIX, "").trim();
}

/**
 * Store editions a platform list may add to the game's name (`… Digital Deluxe Edition`,
 * `… - Game of the Year`). Only the usual store tiers: a named edition (`Voidheart Edition`) or a
 * Director's Cut is another catalog entry and stays as is. Without the word "Edition" only GOTY
 * counts: `Pokémon Gold` is a game of its own.
 */
const EDITION_SUFFIX =
  /[\s:\-–—]+(?:(?:digital\s+)?(?:deluxe|standard|ultimate|gold|complete|definitive|premium|special|launch|cross[\s-]?gen|collector['’]?s)\s+edition|digital\s+deluxe|(?:game\s+of\s+the\s+year|goty)(?:\s+edition)?)\s*$/i;

/**
 * The game's name without a trailing store edition (and trademark signs or a trailing platform
 * tag in parentheses), or null when the name has no such edition.
 * `Marvel’s Spider-Man 2 Digital Deluxe Edition (PS5)` -> `Marvel’s Spider-Man 2`.
 */
export function withoutEdition(title: string): string | null {
  const plain = title
    .replace(/[™®©]/g, "")
    .replace(/\s*\((?:ps[345]|ps vita|xbox[^)]*|pc|windows)\)\s*$/i, "")
    .trim();
  const base = plain.replace(EDITION_SUFFIX, "").trim();
  return base && base !== plain ? base : null;
}
