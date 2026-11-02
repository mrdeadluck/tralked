/*
 * Tralked brand marks, built from the approved logo (assets/brand/tralked-logo-tlk-source.png):
 * every letter is the logo's own glyph, re-spaced with one constant gap (22 units) so no space is
 * wider than another.
 * Colours come from the caller: white parts take the text colour, the L the logo purple, the K the
 * accent.
 */

/** "TLK" monogram (approved 2026-11-02): white T in two pieces (`t`: top bar, 45° stroke), white L (`l`),
 * lime K in two pieces (`k`: top bar, 45° leg). Every gap between pieces is exactly 24 units, the
 * diagonal ones too (measured square to the edges, so 24·√2 along x); every slant is 45°. */
export const EMBLEM = {
  width: 830,
  height: 408,
  t: "M14 0H304V100H114ZM194 124H304V189L85 408H0V318Z",
  l: "M328 0H443V215H520L601 296H328Z",
  k: "M628 0H813L709 104H524ZM467 128H632L830 326V408H746.94L529.94 191H467Z",
} as const;

/** "TRALKED" wordmark: `d` draws T R A E D (even-odd, for the counters), `l` the L (white), `k` the lime K. */
export const WORDMARK = {
  width: 1391,
  height: 219,
  d: "M193 0 51 0 0 52 52 52 52 218 110 218 110 53 149 53ZM214 1 214 52 348 52 348 81 214 81 214 218 270 218 270 134 279 134 351 218 425 218 357 135 374 135 409 100 409 40 374 1ZM503 1 409 166 411 173 443 213 447 214 528 69 559 135 509 135 490 172 577 172 599 218 660 218 554 1ZM1031 0 986 41 986 171 1032 218 1171 218 1171 166 1048 166 1048 135 1135 135 1173 81 1048 81 1048 53 1139 53 1177 0ZM1199 0 1199 218 1345 218 1391 172 1391 42 1348 0ZM1261 52 1315 52 1328 65 1328 152 1314 165 1261 165Z",
  l: "M641 0 641 134 684 218 778 218 778 165 700 165 700 0Z",
  k: "M800 0 800 218 858 218 858 141 930 218 1009 218 897 102 1004 0 931 0 858 68 858 0Z",
} as const;
