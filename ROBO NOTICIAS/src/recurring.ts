import type { Recurring } from "./ai/triage.js";
import { localDay } from "./clock.js";

/**
 * The key of one recurring announcement, so each is covered once (spec "Itens recorrentes"):
 * - PS Plus: one a month, `ps-plus:YYYY-MM`;
 * - Game Pass: one a wave, about two a month, `game-pass:YYYY-MM-a` up to the 15th and `-b` after;
 * - Epic free game: one a week, `epic-gratis:YYYY-Www` (ISO week).
 * Days are São Paulo days.
 */
export function recurringKey(kind: Recurring, day: Date): string {
  const [y, m, d] = localDay(day).split("-").map(Number) as [number, number, number];
  const month = `${y}-${String(m).padStart(2, "0")}`;
  switch (kind) {
    case "ps-plus":
      return `ps-plus:${month}`;
    case "game-pass":
      return `game-pass:${month}-${d <= 15 ? "a" : "b"}`;
    case "epic-gratis": {
      const { year, week } = isoWeek(y, m, d);
      return `epic-gratis:${year}-W${String(week).padStart(2, "0")}`;
    }
  }
}

/** ISO 8601 week of a calendar date: the week (Monday first) holding that week's Thursday. */
function isoWeek(y: number, m: number, d: number): { year: number; week: number } {
  const date = new Date(Date.UTC(y, m - 1, d));
  const weekday = date.getUTCDay() || 7; // Monday 1 … Sunday 7
  date.setUTCDate(date.getUTCDate() + 4 - weekday); // that week's Thursday
  const year = date.getUTCFullYear();
  const week = Math.ceil(((date.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return { year, week };
}
