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
const versionedKey = (c: { gameId: string; platform: string; versionKey: string }) => `${key(c)}:${c.versionKey}`;

/** One of the player's trophy lists (UserTrophyList) as the platinum rule reads it. */
export type PlatinumList = {
  gameId: string;
  platform: string;
  versionKey: string;
  /** UserTrophyList.completedAt is set. */
  completed: boolean;
  /** The player has a suspicious unlock in this list (it pays no platinum). */
  tainted: boolean;
};

/** A valid platinum trophy the player earned, by version (list-less rows: versionKey = platform). */
export type NativePlatinum = { gameId: string; platform: string; versionKey: string };

/**
 * "Platinas (contam no XP)": at most one per version (game, platform, versionKey), each paid in the
 * ledger once per version (lib/progression/list-xp):
 * - a version where the player earned a valid native platinum trophy, whatever the list's % (DLC
 *   short of 100%): the trophy is paid once per version through its canonical key;
 * - a version without one that is complete: a completed list holding no suspicious unlock (PSN,
 *   Xbox, RA; the `platinum` bonus), a valid 100% (UserGame.completedAt, `completions`) of a
 *   non-Steam game and platform where the player has no list yet (legacy key), or a valid Steam 100%.
 * PS4 and PS5 are two, two regions of one console are one, two Xbox titleIds are two, and one
 * console never covers another. A game finished on two platforms is two; "Jogos 100%" counts it once.
 */
export function platinumCount(
  natives: NativePlatinum[],
  lists: PlatinumList[],
  completions: { gameId: string; platform: string }[],
): number {
  const out = new Set<string>();
  const withLists = new Set<string>();
  for (const l of lists) {
    if (l.platform === "steam") continue;
    withLists.add(key(l));
    if (l.completed && !l.tainted) out.add(versionedKey(l));
  }
  for (const n of natives) {
    // A list-less row (from before the lists) stands for its game and platform only until they have lists.
    if (n.versionKey === n.platform && withLists.has(key(n))) continue;
    out.add(versionedKey(n));
  }
  for (const c of completions) {
    if (c.platform === "steam" || !withLists.has(key(c))) out.add(versionedKey({ ...c, versionKey: c.platform }));
  }
  return out.size;
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

/**
 * "Listas regionais extras": PSN platinum trophies unlocked in lists beyond the first unlocked one
 * of each version (shown, but they earn no XP).
 */
function extrasOf(unlocks: PlatinumUnlock[]): number {
  const lists = new Map<string, Set<string>>();
  for (const u of unlocks) {
    const a = u.achievement;
    if (a.platform !== "psn" || !a.listId) continue;
    const k = versionedKey({ gameId: a.gameId, platform: a.platform, versionKey: versionOf(a) });
    lists.set(k, (lists.get(k) ?? new Set()).add(a.listId));
  }
  let extras = 0;
  for (const ids of lists.values()) extras += ids.size - 1;
  return extras;
}

/** The player's trophy lists, completed or not, each marked when it holds a suspicious unlock. */
async function platinumLists(userId: string, db: Db): Promise<PlatinumList[]> {
  const [rows, suspicious] = await Promise.all([
    db.userTrophyList.findMany({
      where: { userId },
      select: { listId: true, completedAt: true, list: { select: { gameId: true, platform: true, console: true, externalId: true } } },
    }),
    db.userAchievement.findMany({
      where: { userId, suspicious: true, achievement: { listId: { not: null } } },
      select: { achievement: { select: { listId: true } } },
    }),
  ]);
  const tainted = new Set(suspicious.map((s) => s.achievement.listId));
  return rows.map((r) => ({
    gameId: r.list.gameId,
    platform: r.list.platform,
    versionKey: versionKey(r.list),
    completed: r.completedAt !== null,
    tainted: tainted.has(r.listId),
  }));
}

/**
 * "Platinas (contam no XP)" (platinumCount) and "Listas regionais extras" (regionalExtras): the
 * profile header, the sheet's Troféus card and the migration snapshots read these.
 */
export async function platinumTally(userId: string, db: Db = prisma): Promise<{ platinums: number; regionalExtras: number }> {
  const [unlocks, lists, completions] = await Promise.all([
    platinumUnlocks(userId, db),
    platinumLists(userId, db),
    validCompletions(userId, db),
  ]);
  const natives = unlocks.map((u) => ({
    gameId: u.achievement.gameId,
    platform: u.achievement.platform,
    versionKey: versionOf(u.achievement),
  }));
  return { platinums: platinumCount(natives, lists, completions), regionalExtras: extrasOf(unlocks) };
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
