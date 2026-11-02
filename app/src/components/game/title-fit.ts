import type { CSSProperties } from "react";

/*
 * Game titles are set in Archivo 900 at font-stretch 125%, uppercase, and break only between
 * words (never inside one). To keep the longest word on one line, the title's font size is capped
 * so that word fits its box: CSS divides the box width by `--longest`, the word's width in em.
 *
 * Advance widths (em) measured in Chromium with the app's Archivo (weight 900, stretch 125%,
 * letter-spacing 0). Negative letter-spacing in the titles only makes words narrower, so the cap
 * stays safe. Accented letters use their base letter; anything unknown counts as 1.25 em (the
 * widest measured glyph), so an unexpected script can be too small but never overflow.
 */
const ADVANCE_EM: Record<string, number> = {
  A: 0.954, B: 0.93, C: 0.939, D: 0.933, E: 0.86, F: 0.807, G: 1.012, H: 1.009, I: 0.395, J: 0.764,
  K: 0.988, L: 0.786, M: 1.178, N: 1.007, O: 1.008, P: 0.865, Q: 1.008, R: 0.943, S: 0.882, T: 0.877,
  U: 0.989, V: 0.938, W: 1.23, X: 0.961, Y: 0.966, Z: 0.877,
  "0": 0.811, "1": 0.731, "2": 0.809, "3": 0.813, "4": 0.819, "5": 0.813, "6": 0.815, "7": 0.746,
  "8": 0.828, "9": 0.815,
  "'": 0.324, "’": 0.324, ":": 0.371, "-": 0.416, "–": 0.625, "—": 1.25, ".": 0.381, ",": 0.381,
  "!": 0.391, "?": 0.743, "&": 1.065, "+": 0.75, "/": 0.309, "(": 0.389, ")": 0.389, "#": 0.773,
  "%": 1.166, "Ø": 1.008, Æ: 1.25, Œ: 1.25, ß: 0.9,
};
const UNKNOWN_EM = 1.25;
/** Rounding, kerning and the fallback font while Archivo loads. */
const SAFETY = 1.04;

function charEm(char: string): number {
  const upper = char.toUpperCase();
  const known = ADVANCE_EM[upper] ?? ADVANCE_EM[upper.normalize("NFD").replace(/\p{M}+/gu, "")];
  return known ?? UNKNOWN_EM;
}

/** Width (em) of the title's longest word, uppercase, as the titles render it. */
export function longestWordEm(title: string): number {
  const words = title.split(/\s+/).filter(Boolean);
  const widest = Math.max(0, ...words.map((w) => [...w].reduce((sum, c) => sum + charEm(c), 0)));
  return Math.ceil(widest * SAFETY * 100) / 100;
}

const SPACE_EM = 0.26;

/**
 * Largest font size, in `cqw` (hundredths of the box width), at which `title` fits a region of
 * `widthFrac` × `heightFrac` of a box `ratio` tall per unit of width, breaking only between words
 * (greedy, as the browser wraps) at `lineHeight`. For titles set on art: a long name ("Tom Clancy's
 * Splinter Cell: Pandora Tomorrow") gets smaller instead of climbing out of its area.
 */
export function titleBoxFit(
  title: string,
  { ratio, widthFrac, heightFrac, lineHeight = 0.95 }: { ratio: number; widthFrac: number; heightFrac: number; lineHeight?: number },
): number {
  const words = title
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => [...w].reduce((sum, c) => sum + charEm(c), 0) * SAFETY);
  if (words.length === 0) return 10;
  const longest = Math.max(...words);
  const maxHeight = ratio * heightFrac;
  // From the size where the longest word just fits the width, down in 2% steps.
  for (let f = widthFrac / longest; f > 0.01; f *= 0.98) {
    let lines = 1;
    let line = 0;
    for (const w of words) {
      const next = line === 0 ? w : line + SPACE_EM + w;
      if (next * f > widthFrac && line > 0) {
        lines += 1;
        line = w;
      } else {
        line = next;
      }
    }
    if (lines * lineHeight * f <= maxHeight) return Math.floor(f * 1000) / 10;
  }
  return 1;
}

/** Inline style carrying `--longest` for a title (see the CSS of each title spot). */
export function titleFitStyle(title: string): CSSProperties {
  return { "--longest": Math.max(1, longestWordEm(title)) } as CSSProperties;
}
