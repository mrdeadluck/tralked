/*
 * Tralked brand marks, vectorized from the approved logo (assets/brand/tralked-logo-source.png).
 * Pure path data so the page header, the footer, the wire cards and the social image (satori)
 * all draw the same shapes. Colours come from the caller: the emblem and the "K" take the accent,
 * the rest of the wordmark the text colour.
 */

/** Shield emblem with the T monogram and the chevron. */
export const EMBLEM = {
  width: 373,
  height: 378,
  d: "M102 153 102 200 180 279 261 201 261 154 181 231ZM363 38 284 113 284 226 189 315 189 377 333 243 333 135 363 106ZM8 38 8 106 37 136 37 244 175 377 175 315 86 227 86 113ZM0 1 59 62 149 62 149 172 179 202 211 173 211 62 311 62 372 1Z",
} as const;

/** "TRALKED" wordmark: `d` draws T R A L E D (even-odd, for the counters), `k` the accent K. */
export const WORDMARK = {
  width: 1451,
  height: 223,
  d: "M1257 0 1257 222 1401 222 1450 174 1450 42 1409 0ZM1319 53 1374 53 1384 63 1384 155 1374 164 1319 164ZM1086 0 1047 50 1047 171 1097 222 1235 222 1235 165 1109 165 1109 138 1110 135 1200 135 1236 82 1109 82 1109 54 1201 54 1239 0ZM664 0 664 132 709 222 829 222 829 164 725 164 725 0ZM515 0 431 168 456 204 471 220 547 57 583 136 527 136 508 178 602 178 623 222 689 222 583 0ZM227 0 227 54 361 54 361 87 227 87 227 222 289 222 289 140 301 143 370 222 445 222 377 140 389 140 430 100 430 42 390 0ZM40 0 0 54 78 54 78 222 139 222 139 54 177 54 218 0Z",
  k: "M842 0 842 222 902 222 902 149 907 144 985 222 1067 222 950 102 1055 0 981 0 903 75 903 0Z",
} as const;
