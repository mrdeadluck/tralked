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

/** One of the player's trophy lists (UserTrophyList) as the platinum rule reads it. */
export type PlatinumList = {
  listId: string;
  gameId: string;
  platform: string;
  versionKey: string;
  /** UserTrophyList.completedAt is set. */
  completed: boolean;
  /** The player has a suspicious unlock in this list (it pays no platinum). */
  tainted: boolean;
};

/** A valid platinum trophy the player earned, with its list (list-less rows: listId null, versionKey = platform). */
export type NativePlatinum = { gameId: string; platform: string; listId: string | null; versionKey: string; apiName?: string };

export type PlatinumCounts = {
  /** "Platinas": one per list (see platinumCount). */
  platinums: number;
  /** The PSN platinum trophies among them ("520 na PSN", as Sony counts them). */
  psnPlatinums: number;
  /** The same platinums counted once per version (game, platform, versionKey): the rule before every regional list counted, for the migration reports. */
  perVersion: number;
  /** `platinums` by platform (steam, psn, xbox, retro): the highscores "Platinas e 100%" scopes. */
  byPlatform: Record<string, number>;
};

/**
 * "Platinas", one per list, each paid in the ledger (lib/progression/list-xp):
 * - every valid platinum trophy of every list, whatever the list's % (DLC short of 100%): two
 *   regional PSN lists of one console are two;
 * - a list without one that is complete and holds no suspicious unlock (PSN without a platinum
 *   trophy, every Xbox titleId, RA set; the `platinum` bonus);
 * - a valid 100% (UserGame.completedAt, `completions`) of a non-Steam game and platform where the
 *   player has no list yet (legacy key, one with its list-less platinum trophy), and a valid Steam 100%.
 * A list-less platinum trophy (from before the lists) counts until a valid unlock of the same
 * trophy on a list row of its game and platform takes over. A game finished on two platforms is
 * two; "Jogos 100%" counts it once.
 */
export function platinumCount(
  natives: NativePlatinum[],
  lists: PlatinumList[],
  completions: { gameId: string; platform: string }[],
): PlatinumCounts {
  // Each platinum by its list (`list:<id>`), or by game and platform where it has no list.
  const out = new Map<string, { platform: string; version: string; psn: boolean }>();
  const add = (k: string, c: { gameId: string; platform: string; versionKey: string }, psn = false) => {
    const seen = out.get(k);
    out.set(k, { platform: c.platform, version: versionedKey(c), psn: psn || Boolean(seen?.psn) });
  };
  const withLists = new Set<string>();
  for (const l of lists) {
    if (l.platform === "steam") continue;
    withLists.add(key(l));
    if (l.completed && !l.tainted) add(`list:${l.listId}`, l);
  }
  // The trophies a list row already holds validly, by game and platform (apiName "" when unknown).
  const onLists = new Map<string, Set<string>>();
  for (const n of natives) {
    if (!n.listId) continue;
    onLists.set(key(n), (onLists.get(key(n)) ?? new Set()).add(n.apiName ?? ""));
  }
  for (const n of natives) {
    if (!n.listId) {
      // As the ledger (list-xp keyOf): a list-less row keeps being paid until a valid unlock of the
      // same trophy on a list row of its game and platform takes over.
      const held = onLists.get(key(n));
      if (held && (held.has(n.apiName ?? "") || n.apiName === undefined || held.has(""))) continue;
    }
    add(n.listId ? `list:${n.listId}` : versionedKey(n), n, n.platform === "psn");
  }
  for (const c of completions) {
    if (c.platform === "steam" || !withLists.has(key(c))) {
      const legacy = { ...c, versionKey: c.platform };
      add(versionedKey(legacy), legacy);
    }
  }
  const items = [...out.values()];
  const byPlatform: Record<string, number> = {};
  for (const i of items) byPlatform[i.platform] = (byPlatform[i.platform] ?? 0) + 1;
  return {
    platinums: items.length,
    psnPlatinums: items.filter((i) => i.psn).length,
    perVersion: new Set(items.map((i) => i.version)).size,
    byPlatform,
  };
}

const listOf = { select: { platform: true, console: true, externalId: true } } as const;

/** Valid platinum unlocks with their list (list-less rows carry no list). */
function platinumUnlocks(userId: string, db: Db) {
  return db.userAchievement.findMany({
    where: { userId, suspicious: false, achievement: { trophyTier: "platinum" } },
    select: {
      achievement: { select: { gameId: true, platform: true, apiName: true, listId: true, list: listOf } },
    },
  });
}

const versionOf = (a: { platform: string; list: { platform: string; console: string | null; externalId: string } | null }) =>
  a.list ? versionKey(a.list) : a.platform;

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
    listId: r.listId,
    gameId: r.list.gameId,
    platform: r.list.platform,
    versionKey: versionKey(r.list),
    completed: r.completedAt !== null,
    tainted: tainted.has(r.listId),
  }));
}

/** "Platinas" (platinumCount): the profile header, the sheet's Troféus card and the migration snapshots read these. */
/**
 * The same, read now (never the per-request memo): writers that store it (the highscores totals
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
    versionKey: versionOf(u.achievement),
    apiName: u.achievement.apiName,
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
