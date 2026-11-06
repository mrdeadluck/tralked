import type { PlatformId } from "@/lib/engine/trophies";
import { versionBadgeLabel, versionKey, versionRank, XBOX_BASE_GAMERSCORE } from "@/lib/trophies/lists";

/*
 * The versions of a library game as the profile's cover grid shows them: one badge per version the
 * player has (a PSN console, an Xbox title, an RA set, Steam), with its best list's percentage, a
 * check for its platinum, 100% or (Xbox) the base game's 1000G, and how many of the player's
 * regional lists it groups. Pure (the
 * reads are in lib/library/queries.ts, batched for the whole library).
 */

export type LibraryVersion = {
  key: string;
  platform: PlatformId;
  /** The badge's short name: "PS5", "PC", "Xbox", "360", "SNES". */
  label: string;
  /** 0-100 of the version's best list; null when its trophies are not known. */
  pct: number | null;
  /** The platinum trophy, or 100% on a version without one (an Xbox list also at 1000G): the check. */
  platinum: boolean;
  /**
   * The version's completed lists (platinum, 100% or Xbox 1000G): 2+ is that many regional lists
   * (the badge's superscript; each list pays its own XP).
   */
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
  /** Xbox: the gamerscore earned with valid unlocks on this list (the base game's 1000G is Tralked). */
  gamerscore?: number;
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
    const completed = group.filter(
      (l) => l.completedAt !== null || l.platinumEarned || (l.platform === "xbox" && (l.gamerscore ?? 0) >= XBOX_BASE_GAMERSCORE),
    ).length;
    out.push({
      key,
      platform: group[0].platform as PlatformId,
      label: versionBadgeLabel(group[0]),
      pct: best,
      platinum: completed > 0,
      regions: completed,
    });
  }
  const withLists = new Set(lists.map((l) => l.platform));
  for (const p of platforms) {
    if (p.platform !== "steam" && withLists.has(p.platform)) continue;
    const pct = pctOf(p.unlockedCount, p.achievementTotal);
    const platinum = p.platform === "steam" ? p.completedAt !== null : p.completedAt !== null || pct === 100;
    out.push({
      key: p.platform === "steam" ? "steam" : p.platform,
      platform: p.platform,
      label: FALLBACK_LABEL[p.platform],
      pct,
      platinum,
      regions: platinum ? 1 : 0,
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
