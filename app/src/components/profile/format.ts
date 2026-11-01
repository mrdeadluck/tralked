const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

/** "12 de mar. de 2026". */
export const formatDate = (date: Date) => dateFormatter.format(date);

/** Whole hours, for headers and totals: "1.234 h". */
export const formatHours = (minutes: number) => `${Math.floor(Math.max(0, minutes) / 60).toLocaleString("pt-BR")} h`;

/** "0,4%", "12%": global unlock percentage. */
export function formatGlobalPct(pct: number): string {
  const rounded = pct < 10 ? Math.round(pct * 10) / 10 : Math.round(pct);
  return `${rounded.toLocaleString("pt-BR")}%`;
}
