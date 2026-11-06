import { cache } from "react";
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

/** One of the player's trophy lists (UserTrophyList) as the counters read it. */
export type PlatinumList = {
  listId: string;
  gameId: string;
  platform: string;
  versionKey: string;
  /** UserTrophyList.completedAt is set. */
  completed: boolean;
  /** The player has a suspicious unlock in this list (it counts for nothing). */
  tainted: boolean;
  /** Xbox: the gamerscore earned with valid unlocks on this list (Achievement.points); absent elsewhere. */
  gamerscore?: number;
};

/** An Xbox list whose earned gamerscore reaches this is Tralked even with DLC missing (the base game's 1000G). */
export const XBOX_BASE_GAMERSCORE = 1000;

/** A valid platinum trophy the player earned, with its list. */
export type NativePlatinum = { gameId: string; platform: string; listId: string; versionKey: string };

export type PlatinumCounts = {
  /** "Platinas": the valid PSN platinum trophies earned, on every list (never a Steam/Xbox/RA completion). */
  platinums: number;
  /** Equal to `platinums` (only PSN has platinum trophies); kept for the readers that say "na PSN". */
  psnPlatinums: number;
  /** The platinums counted once per version (game, platform, versionKey): the rule before every regional list counted, for the migration reports. */
  perVersion: number;
  /** `platinums` by platform (only `psn`). */
  byPlatform: Record<string, number>;
  /** "Tralked": lists/versions completed at 100% on any platform (see platinumCount). */
  tralked: number;
  /** `tralked` by platform (steam, psn, xbox, retro): the highscores "Tralked" scopes. */
  tralkedByPlatform: Record<string, number>;
};

/**
 * The two headline counters.
 *
 * "Platinas": the valid PSN platinum trophies earned, one per list whatever the list's % (two
 * regional PSN lists of one console are two).
 *
 * "Tralked": one per list/version finished at 100% on any platform, valid unlocks only:
 * - a list with `completedAt` and no suspicious unlock (a platinated PSN list counts only once it
 *   reaches 100% with its DLC), plus an Xbox list whose earned gamerscore reaches 1000 (the base
 *   game's 1000G, DLC missing) and holds no suspicious unlock;
 * - a valid 100% (UserGame.completedAt, `completions`) of a non-Steam game and platform where the
 *   player has no list yet (legacy key), and a valid Steam 100%.
 * A game finished on two platforms is two; "Jogos 100%" counts it once.
 */
export function platinumCount(
  natives: NativePlatinum[],
  lists: PlatinumList[],
  completions: { gameId: string; platform: string }[],
): PlatinumCounts {
  // Platinums by list (`list:<id>`).
  const plat = new Map<string, { platform: string; version: string }>();
  // Tralked by list, or by game and platform for the legacy completions.
  const tral = new Map<string, string>();
  const withLists = new Set<string>();
  for (const l of lists) {
    if (l.platform === "steam") continue;
    withLists.add(key(l));
    const done = l.completed || (l.platform === "xbox" && (l.gamerscore ?? 0) >= XBOX_BASE_GAMERSCORE);
    if (done && !l.tainted) tral.set(`list:${l.listId}`, l.platform);
  }
  for (const n of natives) {
    if (n.platform !== "psn") continue;
    plat.set(`list:${n.listId}`, { platform: n.platform, version: versionedKey(n) });
  }
  for (const c of completions) {
    if (c.platform === "steam" || !withLists.has(key(c))) tral.set(versionedKey({ ...c, versionKey: c.platform }), c.platform);
  }
  const byPlatform: Record<string, number> = {};
  for (const i of plat.values()) byPlatform[i.platform] = (byPlatform[i.platform] ?? 0) + 1;
  const tralkedByPlatform: Record<string, number> = {};
  for (const platform of tral.values()) tralkedByPlatform[platform] = (tralkedByPlatform[platform] ?? 0) + 1;
  return {
    platinums: plat.size,
    psnPlatinums: plat.size,
    perVersion: new Set([...plat.values()].map((i) => i.version)).size,
    byPlatform,
    tralked: tral.size,
    tralkedByPlatform,
  };
}

const listOf = { select: { platform: true, console: true, externalId: true } } as const;

/** Valid platinum unlocks with their list. */
function platinumUnlocks(userId: string, db: Db) {
  return db.userAchievement.findMany({
    where: { userId, suspicious: false, achievement: { trophyTier: "platinum" } },
    select: {
      achievement: { select: { gameId: true, platform: true, listId: true, list: listOf } },
    },
  });
}

/** The player's trophy lists, completed or not, each marked when it holds a suspicious unlock. */
async function platinumLists(userId: string, db: Db): Promise<PlatinumList[]> {
  const [rows, suspicious, scores] = await Promise.all([
    db.userTrophyList.findMany({
      where: { userId },
      select: { listId: true, completedAt: true, list: { select: { gameId: true, platform: true, console: true, externalId: true } } },
    }),
    db.userAchievement.findMany({
      where: { userId, suspicious: true },
      select: { achievement: { select: { listId: true } } },
    }),
    // Xbox: the gamerscore earned per list (valid unlocks; Achievement.points is the gamerscore).
    db.$queryRaw<{ listId: string; score: number }[]>`
      SELECT a."listId", COALESCE(SUM(a.points), 0)::int AS score
      FROM "UserAchievement" ua JOIN "Achievement" a ON a.id = ua."achievementId"
      WHERE ua."userId" = ${userId} AND ua.suspicious = false AND a.platform = 'xbox'
      GROUP BY a."listId"`,
  ]);
  const tainted = new Set(suspicious.map((s) => s.achievement.listId));
  const score = new Map(scores.map((r) => [r.listId, r.score]));
  return rows.map((r) => ({
    listId: r.listId,
    gameId: r.list.gameId,
    platform: r.list.platform,
    versionKey: versionKey(r.list),
    completed: r.completedAt !== null,
    tainted: tainted.has(r.listId),
    gamerscore: score.get(r.listId) ?? 0,
  }));
}

/**
 * "Platinas" and "Tralked" (platinumCount): the profile header, the sheet's Troféus card and the
 * migration snapshots read these. Read now (never the per-request memo): writers that store it (the highscores totals
 * in a recompute) must not take a value read before their own changes.
 */
export async function platinumTallyOf(userId: string, db: Db = prisma): Promise<PlatinumCounts> {
  const [unlocks, lists, completions] = await Promise.all([
    platinumUnlocks(userId, db),
    platinumLists(userId, db),
    validCompletions(userId, db),
  ]);
  const natives = unlocks.map((u) => ({
    gameId: u.achievement.gameId,
    platform: u.achievement.platform,
    listId: u.achievement.listId,
    versionKey: versionKey(u.achievement.list),
  }));
  return platinumCount(natives, lists, completions);
}

/** Per request, the same tally is read once (the profile header and the sheet both ask for it). */
const tallyOfRequest = cache((userId: string) => platinumTallyOf(userId, prisma));

export function platinumTally(userId: string, db: Db = prisma): Promise<PlatinumCounts> {
  // Inside a transaction (migrations, tests) the read must see the transaction: no memo.
  return db === prisma ? tallyOfRequest(userId) : platinumTallyOf(userId, db);
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
