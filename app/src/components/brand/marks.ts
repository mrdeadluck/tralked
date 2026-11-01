/*
 * Tralked brand marks, built from the approved logo (assets/brand/tralked-logo-tlk-source.png):
 * every letter is the logo's own glyph, re-spaced with one constant gap (22 units) so no space is
 * wider than another. The TLK monogram reuses the wordmark's T, L and K (same height, upright T).
 * Colours come from the caller: white parts take the text colour, the L the logo purple, the K the
 * accent.
 */

/** "TLK" monogram: white T (`t`), purple L (`l`), lime K (`k`). */
export const EMBLEM = {
  width: 583,
  height: 219,
  t: "M193 0 51 0 0 52 52 52 52 218 110 218 110 53 149 53Z",
  l: "M215 0 215 134 258 218 352 218 352 165 274 165 274 0Z",
  k: "M374 0 374 218 432 218 432 141 504 218 583 218 471 102 578 0 505 0 432 68 432 0Z",
} as const;

/** "TRALKED" wordmark: `d` draws T R A E D (even-odd, for the counters), `l` the purple L, `k` the lime K. */
export const WORDMARK = {
  width: 1391,
  height: 219,
  d: "M193 0 51 0 0 52 52 52 52 218 110 218 110 53 149 53ZM214 1 214 52 348 52 348 81 214 81 214 218 270 218 270 134 279 134 351 218 425 218 357 135 374 135 409 100 409 40 374 1ZM503 1 409 166 411 173 443 213 447 214 528 69 559 135 509 135 490 172 577 172 599 218 660 218 554 1ZM1031 0 986 41 986 171 1032 218 1171 218 1171 166 1048 166 1048 135 1135 135 1173 81 1048 81 1048 53 1139 53 1177 0ZM1199 0 1199 218 1345 218 1391 172 1391 42 1348 0ZM1261 52 1315 52 1328 65 1328 152 1314 165 1261 165Z",
  l: "M641 0 641 134 684 218 778 218 778 165 700 165 700 0Z",
  k: "M800 0 800 218 858 218 858 141 930 218 1009 218 897 102 1004 0 931 0 858 68 858 0Z",
} as const;
