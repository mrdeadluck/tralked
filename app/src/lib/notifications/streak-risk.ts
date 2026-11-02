import { prisma } from "@/lib/db";
import { toLocalDay } from "@/lib/engine/streak";
import type { Db } from "@/lib/highscores/queries";

const DAY_MS = 86_400_000;
/** A streak this short is not worth a nudge. */
export const STREAK_RISK_MIN_DAYS = 2;
/** Most nudges one run writes (the daily cron stays one bounded insert). */
export const STREAK_RISK_MAX_PER_RUN = 1000;

/** The day before `day` ('YYYY-MM-DD'). */
function dayBefore(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * "Sua sequência de 5 dias acaba hoje": players with an active streak (at least
 * STREAK_RISK_MIN_DAYS days, no shield left to cover a miss) whose last valid unlock was yesterday
 * (America/Sao_Paulo), so today without an unlock ends it. Run by the daily `notifications` cron,
 * early in the Brazilian day. At most one per player per day; cheap: two indexed reads and one
 * insert for the whole batch.
 */
export async function notifyStreakRisk(now: Date = new Date(), db: Db = prisma): Promise<{ processed: number }> {
  const today = toLocalDay(now);
  const yesterday = dayBefore(today);
  const candidates = await db.userStats.findMany({
    where: { streakCurrent: { gte: STREAK_RISK_MIN_DAYS }, shields: 0 },
    select: { userId: true, streakCurrent: true, user: { select: { handle: true } } },
    orderBy: { streakCurrent: "desc" },
    take: STREAK_RISK_MAX_PER_RUN * 2,
  });
  if (candidates.length === 0) return { processed: 0 };

  const ids = candidates.map((c) => c.userId);
  const [latest, already] = await Promise.all([
    db.userAchievement.groupBy({
      by: ["userId"],
      where: { userId: { in: ids }, suspicious: false, unlockedAt: { gte: new Date(now.getTime() - 3 * DAY_MS) } },
      _max: { unlockedAt: true },
    }),
    db.notification.findMany({
      where: { userId: { in: ids }, kind: "streak_risk", createdAt: { gte: new Date(now.getTime() - DAY_MS / 2) } },
      select: { userId: true },
    }),
  ]);
  const lastDay = new Map(latest.map((r) => [r.userId, r._max.unlockedAt ? toLocalDay(r._max.unlockedAt) : null]));
  const notified = new Set(already.map((n) => n.userId));

  const data = candidates
    .filter((c) => lastDay.get(c.userId) === yesterday && !notified.has(c.userId))
    .slice(0, STREAK_RISK_MAX_PER_RUN)
    .map((c) => ({
      userId: c.userId,
      kind: "streak_risk",
      title: `Sua sequência de ${c.streakCurrent} dias acaba hoje`,
      body: "Desbloqueie uma conquista até a meia-noite para mantê-la viva.",
      href: `/jogador/${encodeURIComponent(c.user.handle)}`,
      createdAt: now,
    }));
  if (data.length === 0) return { processed: 0 };
  const { count } = await db.notification.createMany({ data });
  return { processed: count };
}
