import { toLocalDay } from "@/lib/engine/streak";

/** ISO week ('YYYY-Www') of a calendar day ('YYYY-MM-DD'). */
export function isoWeekKey(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  const thursday = new Date(Date.UTC(year, month - 1, date));
  // The ISO year/week of a date are those of the Thursday of its Monday-based week.
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
  const isoYear = thursday.getUTCFullYear();
  const dayOfYear = (thursday.getTime() - Date.UTC(isoYear, 0, 1)) / 86_400_000;
  const week = Math.floor(dayOfYear / 7) + 1;
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/** Mission periodKey of the day containing `date` (America/Sao_Paulo): 'YYYY-MM-DD'. */
export const dailyPeriodKey = (date: Date): string => toLocalDay(date);

/** Mission periodKey of the ISO week containing `date` (America/Sao_Paulo): 'YYYY-Www'. */
export const weeklyPeriodKey = (date: Date): string => isoWeekKey(toLocalDay(date));
