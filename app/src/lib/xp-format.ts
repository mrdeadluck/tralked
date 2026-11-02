/**
 * Short XP numbers for pt-BR: "9.876", "12,3 mil", "3,4 mi", "118 mi". Totals in the millions say
 * little at a glance; the level and the progress inside it carry the story, so the raw total is
 * abbreviated wherever it is not the point (the exact value goes in a title/tooltip).
 */
const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

/** Below 10.000 the full number reads fine; above, "12,3 mil", "3,4 mi". */
export function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  // Intl uses a no-break space before "mil"/"mi": keeps "1,2 mil" on one line.
  return Math.abs(n) < 10_000 ? Math.round(n).toLocaleString("pt-BR") : compact.format(n);
}

/** Exact pt-BR number for titles and screen readers: "118.204.551". */
export const formatExact = (n: number) => Math.round(n).toLocaleString("pt-BR");

/** "+5 XP", "+12,3 mil XP". */
export const formatXpGain = (xp: number) => `+${formatCompact(xp)} XP`;
