import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { validCompletions } from "@/lib/progression/completions";
import type { RarityTier } from "@/lib/engine/types";
import { versionKey } from "@/lib/trophies/lists";

/*
 * The player's headline counters, each computed in one place so the character sheet, the Troféus
 * card and the statistics page never disagree. Every platform counts, valid (non-suspicious)
 * unlocks only.
 */

type Db = Prisma.TransactionClient;

const key = (c: { gameId: string; platform: string }) => `${c.gameId}:${c.platform}`;
const nativeKey = (c: { gameId: string; platform: string; versionKey?: string }) =>
  `${key(c)}:${c.versionKey ?? ""}`;

/**
 * Platinums across every platform (Glória's rule): each native platinum trophy (PSN) once per
 * version (PS4 and PS5 are two, two regions of one console are one), plus each valid 100% on a
 * platform without one (Steam, Xbox, RetroAchievements, small PSN games). A game finished on two
 * platforms is two platinums; "Jogos 100%" counts it once.
 */
export function platinumCount(
  nativePlatinum: Iterable<{ gameId: string; platform: string; versionKey?: string }>,
  completions: { gameId: string; platform: string }[],
): number {
  const natives = [...nativePlatinum];
  const covered = new Set(natives.map(key));
  return new Set(natives.map(nativeKey)).size + completions.filter((c) => !covered.has(key(c))).length;
}

const listOf = { select: { platform: true, console: true, externalId: true } } as const;

/** Valid platinum unlocks with their list (list-less rows carry no list). */
function platinumUnlocks(userId: string, db: Db) {
  return db.userAchievement.findMany({
    where: { userId, suspicious: false, achievement: { trophyTier: "platinum" } },
    select: {
      unlockedAt: true,
      achievement: { select: { gameId: true, platform: true, listId: true, list: listOf } },
    },
  });
}

const versionOf = (a: { platform: string; list: { platform: string; console: string | null; externalId: string } | null }) =>
  a.list ? versionKey(a.list) : a.platform;

type PlatinumUnlock = Awaited<ReturnType<typeof platinumUnlocks>>[number];

function distinctNatives(unlocks: PlatinumUnlock[]) {
  const out = new Map<string, { gameId: string; platform: string; versionKey: string }>();
  for (const u of unlocks) {
    const row = { gameId: u.achievement.gameId, platform: u.achievement.platform, versionKey: versionOf(u.achievement) };
    out.set(nativeKey(row), row);
  }
  return [...out.values()];
}

function extrasOf(unlocks: PlatinumUnlock[]): number {
  const lists = new Map<string, Set<string>>();
  for (const u of unlocks) {
    const a = u.achievement;
    if (a.platform !== "psn" || !a.listId) continue;
    const k = nativeKey({ gameId: a.gameId, platform: a.platform, versionKey: versionOf(a) });
    lists.set(k, (lists.get(k) ?? new Set()).add(a.listId));
  }
  let extras = 0;
  for (const ids of lists.values()) extras += ids.size - 1;
  return extras;
}

/**
 * Game, platform and version of each native platinum trophy the player unlocked (valid unlocks),
 * distinct per (gameId, platform, versionKey): PS4 + PS5 = 2, two PS5 regions = 1.
 */
export async function nativePlatinums(userId: string, db: Db = prisma) {
  return distinctNatives(await platinumUnlocks(userId, db));
}

/**
 * PSN platinum trophies unlocked in lists beyond the first unlocked one of each version
 * ("Listas regionais extras": they are shown but earn no XP).
 */
export async function regionalExtras(userId: string, db: Db = prisma): Promise<number> {
  return extrasOf(await platinumUnlocks(userId, db));
}

/**
 * The profile header's "Platinas (contam no XP)" (platinumCount: one per version) and "Listas
 * regionais extras" (regionalExtras), from one read of the platinum unlocks.
 */
export async function platinumTally(userId: string, db: Db = prisma): Promise<{ platinums: number; regionalExtras: number }> {
  const [unlocks, completions] = await Promise.all([platinumUnlocks(userId, db), validCompletions(userId, db)]);
  return { platinums: platinumCount(distinctNatives(unlocks), completions), regionalExtras: extrasOf(unlocks) };
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
