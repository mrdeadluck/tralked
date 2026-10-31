export type StreakResult = {
  current: number;
  best: number;
  shields: number;
  activeToday: boolean;
};

const MAX_SHIELDS = 2;
const DAYS_PER_SHIELD = 7;
const TIME_ZONE = "America/Sao_Paulo";

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Calendar day ('YYYY-MM-DD') of an instant in America/Sao_Paulo. */
export function toLocalDay(date: Date): string {
  const parts = dayFormatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Streak over a set of active days ('YYYY-MM-DD', America/Sao_Paulo).
 * One shield is earned per 7 consecutive active days (max 2); each shield
 * covers one inactive day. Covered days keep the streak but do not add to it.
 * Today without activity yet never breaks the streak.
 */
export function computeStreak(activeDays: string[], today: string): StreakResult {
  const active = new Set(activeDays.filter((d) => d <= today));
  const activeToday = active.has(today);
  if (active.size === 0) {
    return { current: 0, best: 0, shields: 0, activeToday };
  }

  let current = 0;
  let best = 0;
  let shields = 0;
  let run = 0; // consecutive active days toward the next shield

  const first = [...active].sort()[0];
  for (let day = first; day <= today; day = nextDay(day)) {
    if (active.has(day)) {
      current++;
      run++;
      best = Math.max(best, current);
      if (run === DAYS_PER_SHIELD) {
        shields = Math.min(MAX_SHIELDS, shields + 1);
        run = 0;
      }
    } else if (day !== today) {
      run = 0;
      if (shields > 0) shields--;
      else current = 0;
    }
  }

  return { current, best, shields, activeToday };
}
