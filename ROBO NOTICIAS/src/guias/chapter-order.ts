import { normalizeName } from "./match.js";

/**
 * How the primary script orders its own pages and chapters, read from what it says (no model): the position a
 * region page states ("Crimson Forest is the 2nd region"), revisit chapters ("Clean Up Visits", "Second Visit",
 * "Crimson Forest Cleanup #3") and the place a revisit names.
 */

const ORDINAL = /\bis\s+the\s+(\d{1,3})(?:st|nd|rd|th)\b(?:\s+and\s+(?:the\s+)?(?:final|last))?\s+(?:region|area|chapter|zone|level|act|world|location|map)\b/i;

/** The position a page states for itself in the game ("is the 8th region"), from its first lines; or undefined. */
export function statedSequence(text: string): number | undefined {
  const found = ORDINAL.exec(text.slice(0, 3000));
  const n = found ? Number(found[1]) : NaN;
  return Number.isInteger(n) && n >= 1 ? n : undefined;
}

const REVISIT = /\b(?:clean ?ups?|(?:second|third|fourth|fifth|return|later|final) visits?|revisits?|revisiting|backtrack\w*)\b/;
const REVISIT_WORDS = /\b(?:clean ?ups?|visits?|first|second|third|fourth|fifth|return|later|final|revisits?|revisiting|backtrack\w*|\d+)\b/g;

/** A chapter that goes back to a place already visited. */
export function isRevisit(title: string): boolean {
  return REVISIT.test(normalizeName(title));
}

/** The place a revisit title names ("Crimson Forest Cleanup #3" -> "crimson forest"); "" when it names none. */
export function revisitPlace(title: string): string {
  return normalizeName(title).replace(REVISIT_WORDS, " ").replace(/\s+/g, " ").trim();
}

/** "PowerPyx (Crimson Forest)" -> "Crimson Forest": the label of one page of a multi-page guide. */
export function pageLabel(sourceName: string): string | undefined {
  return /\(([^()]+)\)\s*$/.exec(sourceName)?.[1]?.trim() || undefined;
}
