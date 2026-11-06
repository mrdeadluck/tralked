import type { PlatformId } from "@/lib/engine/trophies";
import { versionBadgeLabel, versionKey, versionRank } from "@/lib/trophies/lists";

/*
 * The versions of a library game as the profile's cover grid shows them: one badge per version the
 * player has (a PSN console, an Xbox title, an RA set, Steam), with its best list's percentage, a
 * check for its platinum or 100%, and how many of the player's regional lists it groups. Pure (the
 * reads are in lib/library/queries.ts, batched for the whole library).
 */

export type LibraryVersion = {
  key: string;
  platform: PlatformId;
  /** The badge's short name: "PS5", "PC", "Xbox", "360", "SNES". */
  label: string;
  /** 0-100 of the version's best list; null when its trophies are not known. */
  pct: number | null;
  /** The platinum trophy, or 100% on a version without one. */
  platinum: boolean;
  /** The player's lists of the version (2+: regional lists, counted once). */
  regions: number;
};

/** One of the player's trophy lists of the game (UserTrophyList with its TrophyList). */
export type ListProgress = {
  platform: string;
  console: string | null;
  externalId: string;
  unlockedCount: number;
  completedAt: Date | null;
  /** Trophies of the list (0: unknown). */
  total: number;
  /** A valid platinum trophy earned in this list. */
  platinumEarned: boolean;
};

/** A platform copy of the game (UserGame): Steam's version, and the fallback of a platform without lists. */
export type PlatformProgressRow = {
  platform: PlatformId;
  unlockedCount: number;
  achievementTotal: number;
  completedAt: Date | null;
};

const FALLBACK_LABEL: Record<PlatformId, string> = { steam: "PC", psn: "PS", xbox: "Xbox", retro: "Retrô" };

const pctOf = (unlocked: number, total: number) => (total > 0 ? Math.min(100, Math.round((unlocked / total) * 100)) : null);

/**
 * The player's versions of one game, in the game page's order (PSN PS5, PS4, PS3, Vita; Xbox;
 * Steam; RA). Steam reads its UserGame row; the other platforms their lists, grouped by versionKey;
 * a non-Steam platform copy without any list yet (not read for this player) is one version.
 */
export function libraryVersions(platforms: PlatformProgressRow[], lists: ListProgress[]): LibraryVersion[] {
  const out: LibraryVersion[] = [];
  const byKey = new Map<string, ListProgress[]>();
  for (const l of lists) {
    if (l.platform === "steam") continue;
    const key = versionKey(l);
    byKey.set(key, [...(byKey.get(key) ?? []), l]);
  }
  for (const [key, group] of byKey) {
    let best: number | null = null;
    for (const l of group) {
      const pct = pctOf(l.unlockedCount, l.total);
      if (pct !== null && (best === null || pct > best)) best = pct;
    }
    const played = group.filter((l) => l.unlockedCount > 0 || l.completedAt).length;
    out.push({
      key,
      platform: group[0].platform as PlatformId,
      label: versionBadgeLabel(group[0]),
      pct: best,
      platinum: group.some((l) => l.completedAt !== null || l.platinumEarned),
      regions: Math.max(1, played),
    });
  }
  const withLists = new Set(lists.map((l) => l.platform));
  for (const p of platforms) {
    if (p.platform !== "steam" && withLists.has(p.platform)) continue;
    const pct = pctOf(p.unlockedCount, p.achievementTotal);
    out.push({
      key: p.platform === "steam" ? "steam" : p.platform,
      platform: p.platform,
      label: FALLBACK_LABEL[p.platform],
      pct,
      platinum: p.completedAt !== null || pct === 100,
      regions: 1,
    });
  }
  return out.sort((a, b) => versionRank(a) - versionRank(b) || (a.key < b.key ? -1 : 1));
}

/** The cover's progress bar: the best version (a platinum is full); null without any known. */
export function bestVersionPct(versions: LibraryVersion[]): number | null {
  let best: number | null = null;
  for (const v of versions) {
    const pct = v.platinum ? 100 : v.pct;
    if (pct !== null && (best === null || pct > best)) best = pct;
  }
  return best;
}
