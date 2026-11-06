import { prisma } from "@/lib/db";
import type { PlatformId, TrophyTier } from "@/lib/engine/trophies";
import { regionLabels, versionKey, versionLabel, versionRank } from "@/lib/trophies/lists";
import { catalogPlatforms, tierOf, type TierCounts } from "./game-profile";

/*
 * A game's versions: one per Steam, per PSN console, per Xbox title and per RA set. A version with
 * several regional lists counts once (its best list). `getGameVersions` is the public part (cached
 * with the game profile); `getPlayerVersions` is one player's progress, never cached.
 */

export type VersionList = { id: string; label: string | null; trophyCount: number };
export type VersionTrophy = {
  apiName: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  tier: TrophyTier;
  globalPct: number | null;
  hidden: boolean;
};
export type GameVersion = {
  key: string;
  platform: PlatformId;
  label: string;
  total: number;
  tiers: TierCounts;
  nativePlatinum: boolean;
  lists: VersionList[];
  /** The first list's trophies (what a visitor sees). */
  trophies: VersionTrophy[];
};
export type PlayerVersion = {
  key: string;
  /** Same as the GameVersion's (the per-user island draws its rows without the cached profile). */
  label: string;
  platform: PlatformId;
  nativePlatinum: boolean;
  unlocked: number;
  total: number;
  pct: number;
  platinum: boolean;
  lists: { id: string; label: string | null; complete: boolean; unlocked: number }[];
  /** "2 listas · conta 1" when the version has several lists. */
  countedNote: string | null;
  /** apiName -> labels of the lists it was earned in (only on a version with several lists). */
  earnedIn: Record<string, string[]>;
  // Added for B2 (not in the brief's interface):
  /** The version's best list (its unlocked/total/pct); null when the version has no list row. */
  bestListId: string | null;
  /** apiName -> when it was first earned, in any list of the version. */
  /** apiName -> when it was first earned (null: earned on an unknown date); absent = not earned. */
  unlockedAt: Record<string, Date | null>;
  /** Tiers of the trophies earned in the best list (the platinum also when only the 100% earns it). */
  tiersEarned: TierCounts;
  /** apiName -> the lists it was earned in, oldest unlock first (only on a version with several lists). */
  earnedAt: Record<string, { label: string; at: Date | null }[]>;
  /** apiName -> XP the ledger paid for it (entries not voided). */
  xp: Record<string, number>;
};

export type ListRow = {
  id: string;
  platform: string;
  console: string | null;
  externalId: string;
  region: string | null;
  createdAt: Date;
  trophyCount: number;
};
export type AchRow = {
  id: string;
  listId: string | null;
  platform: string;
  apiName: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  globalPct: number | null;
  hidden: boolean;
  trophyTier: string | null;
};
/** What the player side reads of each trophy row (no name, description nor icon). */
export type SlimAchRow = Pick<AchRow, "id" | "listId" | "platform" | "apiName" | "globalPct" | "trophyTier">;
export type PlayerInput = {
  lists: ListRow[];
  achievements: SlimAchRow[];
  steamCount: number;
  unlocks: { achievementId: string; unlockedAt: Date | null }[];
  userLists: { listId: string; unlockedCount: number; completedAt: Date | null }[];
  steamGame: { unlockedCount: number; completedAt: Date | null } | null;
  /** Achievement ledger entries of the game, not voided (sourceKey = an Achievement id). */
  ledger?: { sourceKey: string; xp: number }[];
};

const emptyTiers = (): TierCounts => ({ platinum: 0, gold: 0, silver: 0, bronze: 0 });

export { versionRank };

type Group<R extends SlimAchRow> = {
  key: string;
  platform: PlatformId;
  label: string;
  /** Oldest first ("Lista 1" first); empty for a Steam game without a list row. */
  lists: (ListRow & { label: string | null; rows: R[] })[];
  /** Rows of the first list (every Steam row for Steam). */
  rows: R[];
  total: number;
  tiers: TierCounts;
  nativePlatinum: boolean;
};

// Same order as canonicalList: oldest first, tie by externalId.
const oldestFirst = (a: ListRow, b: ListRow) =>
  a.createdAt.getTime() - b.createdAt.getTime() || (a.externalId < b.externalId ? -1 : a.externalId > b.externalId ? 1 : 0);
const numeric = (a: SlimAchRow, b: SlimAchRow) => a.apiName.localeCompare(b.apiName, undefined, { numeric: true });

function groupVersions<R extends SlimAchRow>(listRows: ListRow[], achievements: R[], steamCount: number): Group<R>[] {
  const byKey = new Map<string, ListRow[]>();
  for (const l of listRows) {
    const key = versionKey(l);
    byKey.set(key, [...(byKey.get(key) ?? []), l]);
  }
  const groups: Group<R>[] = [];
  // Steam has no trophy order of its own: the commonest first, as its store lists them.
  const steamRows = achievements
    .filter((a) => a.platform === "steam")
    .sort((a, b) => (b.globalPct ?? -1) - (a.globalPct ?? -1) || numeric(a, b));
  if (steamRows.length > 0 || steamCount > 0 || byKey.has("steam")) {
    if (!byKey.has("steam")) byKey.set("steam", []);
  }
  for (const [key, lists] of byKey) {
    const platform = (key === "steam" ? "steam" : lists[0].platform) as PlatformId;
    const ordered = [...lists].sort(oldestFirst);
    const labels = regionLabels(ordered);
    const withRows = ordered.map((l) => ({
      ...l,
      label: labels.get(l.id) ?? null,
      rows: platform === "steam" ? steamRows : achievements.filter((a) => a.listId === l.id).sort(numeric),
    }));
    const rows = platform === "steam" ? steamRows : (withRows[0]?.rows ?? []);
    const cat = catalogPlatforms(rows, platform === "steam" ? steamCount : 0)[0];
    if (!cat) continue; // no trophies known for this version
    groups.push({
      key,
      platform,
      label: versionLabel(platform === "steam" ? { platform, console: null } : lists[0]),
      lists: withRows,
      rows,
      total: cat.total,
      tiers: cat.tiers,
      nativePlatinum: cat.nativePlatinum,
    });
  }
  return groups.sort((a, b) => versionRank(a) - versionRank(b) || (a.key < b.key ? -1 : 1));
}

export function buildGameVersions(lists: ListRow[], achievements: AchRow[], steamCount: number): GameVersion[] {
  return groupVersions(lists, achievements, steamCount).map((g) => ({
    key: g.key,
    platform: g.platform,
    label: g.label,
    total: g.total,
    tiers: g.tiers,
    nativePlatinum: g.nativePlatinum,
    lists: g.lists.map((l) => ({ id: l.id, label: l.label, trophyCount: l.rows.length || l.trophyCount })),
    trophies: g.rows.map((a) => ({
      apiName: a.apiName,
      name: a.name,
      description: a.description,
      iconUrl: a.iconUrl,
      tier: tierOf(a),
      globalPct: a.globalPct,
      hidden: a.hidden,
    })),
  }));
}

export function buildPlayerVersions(input: PlayerInput): PlayerVersion[] {
  const unlockById = new Map(input.unlocks.map((u) => [u.achievementId, u.unlockedAt]));
  const progress = new Map(input.userLists.map((u) => [u.listId, u]));
  const paidByKey = new Map<string, number>();
  for (const e of input.ledger ?? []) paidByKey.set(e.sourceKey, (paidByKey.get(e.sourceKey) ?? 0) + e.xp);
  const out: PlayerVersion[] = [];

  for (const g of groupVersions(input.lists, input.achievements, input.steamCount)) {
    const isSteam = g.platform === "steam";
    const earnedRows = (rows: SlimAchRow[]) => rows.filter((a) => unlockById.has(a.id));

    // Steam keeps one row per game (UserGame); the other platforms one per list (UserTrophyList).
    type Entry = { id: string | null; label: string | null; total: number; unlocked: number; complete: boolean; rows: SlimAchRow[] };
    let entries: Entry[];
    if (isSteam) {
      const earned = earnedRows(g.rows);
      const unlocked = input.steamGame?.unlockedCount ?? earned.length;
      entries = [
        {
          id: g.lists[0]?.id ?? null,
          label: null,
          total: g.total,
          unlocked,
          complete: Boolean(input.steamGame?.completedAt) || (g.total > 0 && unlocked >= g.total),
          rows: g.rows,
        },
      ];
      if (!input.steamGame && earned.length === 0) continue;
    } else {
      entries = g.lists.map((l) => {
        const total = l.rows.length || l.trophyCount;
        const mine = progress.get(l.id);
        const unlocked = mine?.unlockedCount ?? earnedRows(l.rows).length;
        return {
          id: l.id,
          label: l.label,
          total,
          unlocked,
          complete: Boolean(mine?.completedAt) || (total > 0 && unlocked >= total),
          rows: l.rows,
        };
      });
      if (!entries.some((e) => progress.has(e.id!) || e.rows.some((a) => unlockById.has(a.id)))) continue;
    }

    const pctOf = (e: Entry) => (e.total > 0 ? e.unlocked / e.total : 0);
    const best = entries.reduce((b, e) => (pctOf(e) > pctOf(b) || (pctOf(e) === pctOf(b) && e.unlocked > b.unlocked) ? e : b));

    const earnedIn: Record<string, string[]> = {};
    const earnedAt: Record<string, { label: string; at: Date | null }[]> = {};
    const unlockedAt: Record<string, Date | null> = {};
    let platinumTrophy = false;
    for (const e of entries) {
      for (const a of earnedRows(e.rows)) {
        const when = unlockById.get(a.id) ?? null;
        // A dated unlock wins over an undated one; the dates of the version's lists: the oldest.
        const prev = unlockedAt[a.apiName];
        if (!(a.apiName in unlockedAt) || (when && (!prev || when < prev))) unlockedAt[a.apiName] = when;
        if (e.label) {
          (earnedIn[a.apiName] ??= []).push(e.label);
          (earnedAt[a.apiName] ??= []).push({ label: e.label, at: when });
        }
        if (tierOf(a) === "platinum") platinumTrophy = true;
      }
    }
    // Oldest first; the undated ones last.
    for (const dates of Object.values(earnedAt)) {
      dates.sort((x, y) => (x.at ? x.at.getTime() : Infinity) - (y.at ? y.at.getTime() : Infinity) || 0);
    }

    const xp: Record<string, number> = {};
    for (const e of entries) {
      for (const a of e.rows) {
        const paid = paidByKey.get(a.id);
        if (paid) xp[a.apiName] = (xp[a.apiName] ?? 0) + paid;
      }
    }

    const tiersEarned = emptyTiers();
    for (const a of earnedRows(best.rows)) tiersEarned[tierOf(a)]++;
    const complete = entries.some((e) => e.complete);
    // Any list of the version: its platinum trophy, or (no native platinum) its 100%.
    const platinum = g.nativePlatinum ? platinumTrophy : complete;
    // The grid agrees with the disc: the version's platinum counts even if another list earned it.
    if (platinum) tiersEarned.platinum = 1;

    out.push({
      key: g.key,
      label: g.label,
      platform: g.platform,
      nativePlatinum: g.nativePlatinum,
      unlocked: best.unlocked,
      total: best.total,
      pct: best.total > 0 ? Math.min(100, Math.round((best.unlocked / best.total) * 100)) : 0,
      platinum,
      lists: isSteam ? [] : entries.map((e) => ({ id: e.id!, label: e.label, complete: e.complete, unlocked: e.unlocked })),
      countedNote: !isSteam && entries.length > 1 ? `${entries.length} listas · conta 1` : null,
      earnedIn,
      bestListId: best.id,
      unlockedAt,
      tiersEarned,
      earnedAt,
      xp,
    });
  }
  return out;
}

const ACH_SELECT = {
  id: true,
  listId: true,
  platform: true,
  apiName: true,
  name: true,
  description: true,
  iconUrl: true,
  globalPct: true,
  hidden: true,
  trophyTier: true,
} as const;

const LIST_SELECT = {
  id: true,
  platform: true,
  console: true,
  externalId: true,
  region: true,
  createdAt: true,
  trophyCount: true,
} as const;
const SLIM_SELECT = { id: true, listId: true, platform: true, apiName: true, globalPct: true, trophyTier: true } as const;

async function loadGame<S extends typeof ACH_SELECT | typeof SLIM_SELECT>(gameId: string, select: S) {
  const [game, lists, achievements] = await Promise.all([
    prisma.game.findUnique({ where: { id: gameId }, select: { achievementCount: true } }),
    prisma.trophyList.findMany({ where: { gameId }, select: LIST_SELECT }),
    prisma.achievement.findMany({ where: { gameId }, select }),
  ]);
  return { steamCount: game?.achievementCount ?? 0, lists, achievements };
}

export async function getGameVersions(gameId: string): Promise<GameVersion[]> {
  const { steamCount, lists, achievements } = await loadGame(gameId, ACH_SELECT);
  return buildGameVersions(lists, achievements, steamCount);
}

/**
 * One version of the game `slug` (its full trophy list), reading only that version: its lists and
 * the rows of its first list (Steam: every Steam row). Null for an unknown game or version.
 */
export async function getGameVersion(slug: string, key: string): Promise<GameVersion | null> {
  const game = await prisma.game.findUnique({ where: { slug }, select: { id: true, achievementCount: true } });
  if (!game) return null;
  const lists = (await prisma.trophyList.findMany({ where: { gameId: game.id }, select: LIST_SELECT })).filter(
    (l) => versionKey(l) === key,
  );
  const steam = key === "steam";
  if (!steam && lists.length === 0) return null;
  const achievements = await prisma.achievement.findMany({
    where: steam ? { gameId: game.id, platform: "steam" } : { listId: [...lists].sort(oldestFirst)[0].id },
    select: ACH_SELECT,
  });
  return buildGameVersions(lists, achievements, steam ? game.achievementCount : 0).find((v) => v.key === key) ?? null;
}

/**
 * The version keys of the game `slug` (versionKey of each of its trophy lists; every Steam game has
 * its Steam list), read from the lists alone. Empty for an unknown game.
 */
export async function getGameVersionKeys(slug: string): Promise<string[]> {
  const lists = await prisma.trophyList.findMany({
    where: { game: { slug } },
    select: { platform: true, console: true, externalId: true },
  });
  return [...new Set(lists.map(versionKey))];
}

/** One player's versions of a game: reads only ids, tiers and rarity of the trophies (never their text). */
export async function getPlayerVersions(gameId: string, userId: string): Promise<PlayerVersion[]> {
  const [unlocks, userLists, steamGame] = await Promise.all([
    prisma.userAchievement.findMany({
      where: { userId, achievement: { gameId } },
      select: { achievementId: true, unlockedAt: true },
    }),
    prisma.userTrophyList.findMany({
      where: { userId, list: { gameId } },
      select: { listId: true, unlockedCount: true, completedAt: true },
    }),
    prisma.userGame.findUnique({
      where: { userId_gameId_platform: { userId, gameId, platform: "steam" } },
      select: { unlockedCount: true, completedAt: true },
    }),
  ]);
  // A player with nothing on this game has no version: skip the game's trophy rows altogether.
  if (unlocks.length === 0 && userLists.length === 0 && !steamGame) return [];
  const { steamCount, lists, achievements } = await loadGame(gameId, SLIM_SELECT);
  // Ledger keys of a PSN trophy may be another list's copy (the canonical one): read by every id.
  const ledger =
    unlocks.length === 0
      ? []
      : await prisma.xpLedgerEntry.findMany({
          where: { userId, source: "achievement", voidedAt: null, sourceKey: { in: achievements.map((a) => a.id) } },
          select: { sourceKey: true, xp: true },
        });
  return buildPlayerVersions({ lists, achievements, steamCount, unlocks, userLists, steamGame, ledger });
}
