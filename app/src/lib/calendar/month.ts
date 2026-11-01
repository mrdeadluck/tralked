/**
 * Calendar months and days (Plano 4, F8). Days are calendar days in Brasília time
 * (America/Sao_Paulo): an article published at 23:30 there belongs to that day, not to the next
 * UTC day. Release dates are already calendar days (stored as UTC midnight) and are read as is.
 */

export const CALENDAR_TZ = "America/Sao_Paulo";

/** Months the calendar serves (`/calendario/AAAA-MM`): anything else is a 404. */
export const FIRST_YEAR = 1980;
export const LAST_YEAR = 2040;

export type Month = { year: number; month: number };

/** "2026-10" → { 2026, 10 }; null when malformed or out of range. */
export function parseMonth(value: string | undefined | null): Month | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12 || year < FIRST_YEAR || year > LAST_YEAR) return null;
  return { year, month };
}

export const monthParam = ({ year, month }: Month) => `${year}-${String(month).padStart(2, "0")}`;

export function addMonths({ year, month }: Month, delta: number): Month {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export const inRange = ({ year }: Month) => year >= FIRST_YEAR && year <= LAST_YEAR;

const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: CALENDAR_TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/** Brasília calendar day of an instant: "2026-10-31". */
export function dayKey(instant: Date): string {
  return dayFormat.format(instant);
}

/** Calendar day stored as UTC midnight (release dates): "2026-10-31". */
export const utcDayKey = (date: Date) => date.toISOString().slice(0, 10);

export function monthOf(instant: Date): Month {
  const [year, month] = dayKey(instant).split("-").map(Number);
  return { year, month };
}

export const daysInMonth = ({ year, month }: Month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Day key of a day of the month. */
export const keyOf = ({ year, month }: Month, day: number) =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

/** UTC midnight bounds of the month's calendar days (for date-only columns): [start, end). */
export function utcBounds({ year, month }: Month): { start: Date; end: Date } {
  return { start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 1)) };
}

/**
 * Instants that surely cover the month in Brasília time (UTC−3, and −2 in old summer times),
 * with a day of slack on each side: callers keep the rows whose dayKey falls inside the month.
 */
export function instantBounds(month: Month): { start: Date; end: Date } {
  const { start, end } = utcBounds(month);
  return { start: new Date(start.getTime() - 86_400_000), end: new Date(end.getTime() + 86_400_000) };
}

/** Weeks of the month grid, Sunday first (as Brazilian calendars): day numbers, null outside. */
export function monthWeeks(month: Month): (number | null)[][] {
  const first = new Date(Date.UTC(month.year, month.month - 1, 1)).getUTCDay();
  const total = daysInMonth(month);
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export const MONTH_NAMES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
export const WEEKDAYS = [
  { short: "dom", long: "domingo" },
  { short: "seg", long: "segunda-feira" },
  { short: "ter", long: "terça-feira" },
  { short: "qua", long: "quarta-feira" },
  { short: "qui", long: "quinta-feira" },
  { short: "sex", long: "sexta-feira" },
  { short: "sáb", long: "sábado" },
];

/** "outubro de 2026". */
export const monthLabel = ({ year, month }: Month) => `${MONTH_NAMES[month - 1]} de ${year}`;

/** "sábado, 31 de outubro" for a day key. */
export function dayLabel(key: string, withYear = false): string {
  const [year, month, day] = key.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()].long;
  return `${weekday}, ${day} de ${MONTH_NAMES[month - 1]}${withYear ? ` de ${year}` : ""}`;
}
