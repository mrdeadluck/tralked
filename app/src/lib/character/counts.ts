import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { RarityTier } from "@/lib/engine/types";

/*
 * The player's headline counters, each computed in one place so the character sheet, the Troféus
 * card and the statistics page never disagree. Every platform counts, valid (non-suspicious)
 * unlocks only.
 */

type Db = Prisma.TransactionClient;

const key = (c: { gameId: string; platform: string }) => `${c.gameId}:${c.platform}`;

/**
 * Platinums across every platform (Glória's rule): each native platinum trophy (PSN), plus each
 * valid 100% on a platform without one (Steam, Xbox, RetroAchievements, small PSN games). A game
 * finished on two platforms is two platinums; "Jogos 100%" counts it once.
 */
export function platinumCount(
  nativePlatinum: Iterable<{ gameId: string; platform: string }>,
  completions: { gameId: string; platform: string }[],
): number {
  const native = new Set([...nativePlatinum].map(key));
  return native.size + completions.filter((c) => !native.has(key(c))).length;
}

/** Game and platform of each native platinum trophy the player unlocked (valid unlocks). */
export function nativePlatinums(userId: string, db: Db = prisma) {
  return db.$queryRaw<{ gameId: string; platform: string }[]>`
    SELECT DISTINCT a."gameId", a.platform
    FROM "UserAchievement" ua JOIN "Achievement" a ON a.id = ua."achievementId"
    WHERE ua."userId" = ${userId} AND ua.suspicious = false AND a."trophyTier" = 'platinum'`;
}

/**
 * Valid unlocks by rarity tier (same thresholds as `rarityTier`; an unknown percentage counts as
 * 50%, "incomum"). "Lendárias" on the sheet is `lendaria` here.
 */
export async function rarityCounts(userId: string, db: Db = prisma): Promise<Record<RarityTier, number>> {
  const rows = await db.$queryRaw<{ tier: RarityTier; count: number }[]>`
    SELECT CASE
        WHEN coalesce(a."globalPct", 50) <= 3 THEN 'lendaria'
        WHEN coalesce(a."globalPct", 50) <= 8 THEN 'epica'
        WHEN coalesce(a."globalPct", 50) <= 20 THEN 'rara'
        WHEN coalesce(a."globalPct", 50) <= 50 THEN 'incomum'
        ELSE 'comum' END AS tier,
      count(*)::int AS count
    FROM "UserAchievement" ua JOIN "Achievement" a ON a.id = ua."achievementId"
    WHERE ua."userId" = ${userId} AND ua.suspicious = false
    GROUP BY 1`;
  const counts: Record<RarityTier, number> = { comum: 0, incomum: 0, rara: 0, epica: 0, lendaria: 0 };
  for (const r of rows) counts[r.tier] = r.count;
  return counts;
}
