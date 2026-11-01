/*
 * Tralked brand marks, vectorized from the approved logo (assets/brand/tralked-logo-tlk-source.png).
 * Pure path data so the header, the footer, the wire cards and the social image (satori) all draw
 * the same shapes. Colours come from the caller: white parts take the text colour, the L the logo
 * purple, the K the accent.
 */

/** "TLK" monogram: white T (`t`), purple L (`l`), lime K (`k`). */
export const EMBLEM = {
  width: 445,
  height: 236,
  t: "M142 69 91 69 91 95 0 182 0 235 53 235 142 135ZM4 55 149 55 149 0 59 0Z",
  l: "M154 1 154 158 305 158 305 146 274 109 212 109 212 1Z",
  k: "M443 0 370 0 309 62 348 62 355 70 374 70ZM230 1 230 99 279 99 391 235 444 235 444 182 342 73 289 73 289 1Z",
} as const;

/** "TRALKED" wordmark: `d` draws T R A E D (even-odd, for the counters), `l` the purple L, `k` the lime K. */
export const WORDMARK = {
  width: 1366,
  height: 219,
  d: "M1173 0 1173 218 1319 218 1365 172 1365 42 1322 0ZM1235 52 1289 52 1302 65 1302 152 1288 165 1235 165ZM1013 0 968 41 968 171 1014 218 1153 218 1153 166 1030 166 1030 135 1117 135 1155 81 1030 81 1030 53 1121 53 1159 0ZM488 1 394 166 396 173 428 213 432 214 513 69 544 135 494 135 475 172 562 172 584 218 645 218 539 1ZM198 1 198 52 332 52 332 81 198 81 198 218 254 218 254 134 263 134 335 218 409 218 341 135 358 135 393 100 393 40 358 1ZM193 0 51 0 0 52 52 52 52 218 110 218 110 53 149 53Z",
  l: "M623 0 623 134 666 218 760 218 760 165 682 165 682 0Z",
  k: "M774 0 774 218 832 218 832 141 904 218 983 218 871 102 978 0 905 0 832 68 832 0Z",
} as const;
