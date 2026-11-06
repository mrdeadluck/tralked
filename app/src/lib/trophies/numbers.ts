import { prisma } from "@/lib/db";
import { platinumTally } from "@/lib/character/counts";

/**
 * Per-user totals checked before and after each phase of the trophy-list migration
 * (scripts/trophy-lists-snapshot.ts and the finish report). The Steam numbers must never change.
 */
export type UserNumbers = {
  userId: string;
  handle: string;
  /** Steam UserAchievement rows. */
  steamUnlocks: number;
  /** Valid Steam trophy XP: ledger `platform IS NULL`, source achievement/platinum, not voided. */
  steamXp: number;
  psnUnlocks: number;
  xboxUnlocks: number;
  retroUnlocks: number;
  /** "Platinas" as the header and the sheet count them (platinumCount: one per list). */
  platinums: number;
  /** The PSN platinum trophies among them (the header's "N na PSN"). */
  psnPlatinums: number;
  totalXp: number;
  level: number;
};

/** The numbers of these users (default: every user), by handle. */
export async function userNumbers(userIds?: string[]): Promise<UserNumbers[]> {
  const users = await prisma.user.findMany({
    where: userIds ? { id: { in: userIds } } : {},
    select: { id: true, handle: true, stats: { select: { totalXp: true, level: true } } },
    orderBy: { handle: "asc" },
  });
  const ids = users.map((u) => u.id);
  if (ids.length === 0) return [];
  const [unlocks, steamXp] = await Promise.all([
    prisma.$queryRaw<{ userId: string; platform: string; count: bigint }[]>`
      SELECT ua."userId", a.platform, COUNT(*) AS count
      FROM "UserAchievement" ua JOIN "Achievement" a ON a.id = ua."achievementId"
      WHERE ua."userId" = ANY(${ids}::text[])
      GROUP BY ua."userId", a.platform`,
    prisma.$queryRaw<{ userId: string; xp: bigint }[]>`
      SELECT "userId", COALESCE(SUM(xp), 0)::bigint AS xp
      FROM "XpLedgerEntry"
      WHERE "userId" = ANY(${ids}::text[]) AND platform IS NULL
        AND source IN ('achievement', 'platinum') AND "voidedAt" IS NULL
      GROUP BY "userId"`,
  ]);
  const count = (userId: string, platform: string) =>
    Number(unlocks.find((u) => u.userId === userId && u.platform === platform)?.count ?? 0);
  const out: UserNumbers[] = [];
  for (const u of users) {
    const tally = await platinumTally(u.id);
    out.push({
      userId: u.id,
      handle: u.handle,
      steamUnlocks: count(u.id, "steam"),
      steamXp: Number(steamXp.find((x) => x.userId === u.id)?.xp ?? 0),
      psnUnlocks: count(u.id, "psn"),
      xboxUnlocks: count(u.id, "xbox"),
      retroUnlocks: count(u.id, "retro"),
      platinums: tally.platinums,
      psnPlatinums: tally.psnPlatinums,
      totalXp: u.stats?.totalXp ?? 0,
      level: u.stats?.level ?? 1,
    });
  }
  return out;
}
