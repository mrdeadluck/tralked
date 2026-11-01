/*
 * Tralked brand marks, built from the approved logo (assets/brand/tralked-logo-tlk-source.png):
 * every letter is the logo's own glyph, re-spaced with one constant gap (22 units) so no space is
 * wider than another.
 * Colours come from the caller: white parts take the text colour, the L the logo purple, the K the
 * accent.
 */

/** "TLK" monogram (the game-controller symbol): white T (`t`, bar tip pointing up), purple L (`l`),
 * lime K (`k`). Every gap between pieces is exactly 12 units; all pieces share the top line. */
export const EMBLEM = {
  width: 444,
  height: 235,
  t: "M4 0 142 0 142 55 59 55ZM142 67 91 67 91 93 0 184 0 235 53 235 142 133Z",
  l: "M154 0 154 158 305 158 305 146 274 109 212 109 212 0Z",
  k: "M224 0 224 97 280.7 97 394.3 235 444 235 444 182 342 73 283 73 283 0ZM443.8 -0.8 370.8 -0.8 309.8 61.2 348.8 61.2 355.8 69.2 374.8 69.2Z",
} as const;

/** "TRALKED" wordmark: `d` draws T R A E D (even-odd, for the counters), `l` the purple L, `k` the lime K. */
export const WORDMARK = {
  width: 1391,
  height: 219,
  d: "M193 0 51 0 0 52 52 52 52 218 110 218 110 53 149 53ZM214 1 214 52 348 52 348 81 214 81 214 218 270 218 270 134 279 134 351 218 425 218 357 135 374 135 409 100 409 40 374 1ZM503 1 409 166 411 173 443 213 447 214 528 69 559 135 509 135 490 172 577 172 599 218 660 218 554 1ZM1031 0 986 41 986 171 1032 218 1171 218 1171 166 1048 166 1048 135 1135 135 1173 81 1048 81 1048 53 1139 53 1177 0ZM1199 0 1199 218 1345 218 1391 172 1391 42 1348 0ZM1261 52 1315 52 1328 65 1328 152 1314 165 1261 165Z",
  l: "M641 0 641 134 684 218 778 218 778 165 700 165 700 0Z",
  k: "M800 0 800 218 858 218 858 141 930 218 1009 218 897 102 1004 0 931 0 858 68 858 0Z",
} as const;
