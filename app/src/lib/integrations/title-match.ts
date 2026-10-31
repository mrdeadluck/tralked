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
