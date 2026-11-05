import { prisma } from "@/lib/db";
import type { PlatformId, TrophyTier } from "@/lib/engine/trophies";
import { regionLabels, versionKey, versionLabel } from "@/lib/trophies/lists";
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
  unlockedAt: Record<string, Date>;
  /** Tiers of the trophies earned in the best list (the platinum also when only the 100% earns it). */
  tiersEarned: TierCounts;
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
export type PlayerInput = {
  lists: ListRow[];
  achievements: AchRow[];
  steamCount: number;
  unlocks: { achievementId: string; unlockedAt: Date }[];
  userLists: { listId: string; unlockedCount: number; completedAt: Date | null }[];
  steamGame: { unlockedCount: number; completedAt: Date | null } | null;
};

const PSN_RANK: Record<string, number> = { PS5: 0, PS4: 1, PS3: 2, PSVITA: 3, PSPC: 4 };
const PLATFORM_BASE: Record<string, number> = { steam: 0, psn: 100, xbox: 200, retro: 300 };
const emptyTiers = (): TierCounts => ({ platinum: 0, gold: 0, silver: 0, bronze: 0 });

/** Display order: Steam, PSN (PS5, PS4, PS3, Vita), Xbox, RA. */
export function versionRank(v: { key: string; platform: string }): number {
  const base = PLATFORM_BASE[v.platform] ?? 400;
  if (v.platform !== "psn") return base;
  const codes = v.key.slice("psn:".length).split("+");
  const best = Math.min(...codes.map((c) => PSN_RANK[c] ?? 9));
  return base + best * 10 + (codes.length - 1);
}

type Group = {
  key: string;
  platform: PlatformId;
  label: string;
  /** Oldest first ("Lista 1" first); empty for a Steam game without a list row. */
  lists: (ListRow & { label: string | null; rows: AchRow[] })[];
  /** Rows of the first list (every Steam row for Steam). */
  rows: AchRow[];
  total: number;
  tiers: TierCounts;
  nativePlatinum: boolean;
};

// Same order as canonicalList: oldest first, tie by externalId.
const oldestFirst = (a: ListRow, b: ListRow) =>
  a.createdAt.getTime() - b.createdAt.getTime() || (a.externalId < b.externalId ? -1 : a.externalId > b.externalId ? 1 : 0);
const numeric = (a: AchRow, b: AchRow) => a.apiName.localeCompare(b.apiName, undefined, { numeric: true });

function groupVersions(listRows: ListRow[], achievements: AchRow[], steamCount: number): Group[] {
  const byKey = new Map<string, ListRow[]>();
  for (const l of listRows) {
    const key = versionKey(l);
    byKey.set(key, [...(byKey.get(key) ?? []), l]);
  }
  const groups: Group[] = [];
  const steamRows = achievements.filter((a) => a.platform === "steam");
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
  const out: PlayerVersion[] = [];

  for (const g of groupVersions(input.lists, input.achievements, input.steamCount)) {
    const isSteam = g.platform === "steam";
    const earnedRows = (rows: AchRow[]) => rows.filter((a) => unlockById.has(a.id));

    // Steam keeps one row per game (UserGame); the other platforms one per list (UserTrophyList).
    type Entry = { id: string | null; label: string | null; total: number; unlocked: number; complete: boolean; rows: AchRow[] };
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
    const unlockedAt: Record<string, Date> = {};
    for (const e of entries) {
      for (const a of earnedRows(e.rows)) {
        const when = unlockById.get(a.id)!;
        if (!unlockedAt[a.apiName] || when < unlockedAt[a.apiName]) unlockedAt[a.apiName] = when;
        if (e.label) (earnedIn[a.apiName] ??= []).push(e.label);
      }
    }

    const tiersEarned = emptyTiers();
    for (const a of earnedRows(best.rows)) tiersEarned[tierOf(a)]++;
    const complete = entries.some((e) => e.complete);
    if (!g.nativePlatinum && complete) tiersEarned.platinum = 1;

    out.push({
      key: g.key,
      unlocked: best.unlocked,
      total: best.total,
      pct: best.total > 0 ? Math.min(100, Math.round((best.unlocked / best.total) * 100)) : 0,
      platinum: g.nativePlatinum ? tiersEarned.platinum > 0 || complete : complete,
      lists: isSteam ? [] : entries.map((e) => ({ id: e.id!, label: e.label, complete: e.complete, unlocked: e.unlocked })),
      countedNote: !isSteam && entries.length > 1 ? `${entries.length} listas · conta 1` : null,
      earnedIn,
      bestListId: best.id,
      unlockedAt,
      tiersEarned,
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

async function loadGame(gameId: string) {
  const [game, lists, achievements] = await Promise.all([
    prisma.game.findUnique({ where: { id: gameId }, select: { achievementCount: true } }),
    prisma.trophyList.findMany({
      where: { gameId },
      select: { id: true, platform: true, console: true, externalId: true, region: true, createdAt: true, trophyCount: true },
    }),
    prisma.achievement.findMany({ where: { gameId }, select: ACH_SELECT }),
  ]);
  return { steamCount: game?.achievementCount ?? 0, lists, achievements };
}

export async function getGameVersions(gameId: string): Promise<GameVersion[]> {
  const { steamCount, lists, achievements } = await loadGame(gameId);
  return buildGameVersions(lists, achievements, steamCount);
}

export async function getPlayerVersions(gameId: string, userId: string): Promise<PlayerVersion[]> {
  const [{ steamCount, lists, achievements }, unlocks, userLists, steamGame] = await Promise.all([
    loadGame(gameId),
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
  return buildPlayerVersions({ lists, achievements, steamCount, unlocks, userLists, steamGame });
}
