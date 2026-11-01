import type { PlatformId } from "@/lib/engine/trophies";
import type { LibraryGame } from "@/lib/library/queries";
import { compareNames, foldName } from "@/lib/search/fold";

/**
 * Filtering and ordering of a player's library for the profile's "Jogos" tab (Plano 4, F3). The
 * library is read whole (lib/library/queries.ts: one query plus one aggregate, bounded by the
 * player's game count) and shaped here, so these stay pure and testable.
 */

export const PROFILE_GAME_SORTS = ["horas", "recentes", "conclusao", "nome"] as const;
export type ProfileGameSort = (typeof PROFILE_GAME_SORTS)[number];

export const PROFILE_PLATFORMS: PlatformId[] = ["steam", "psn", "xbox", "retro"];

/** Played games, or the owned-but-never-played ones (their own section). */
export type LibrarySection = "jogados" | "nunca";

export type LibraryQuery = {
  platform?: PlatformId;
  /** Raw name query (folded here). */
  q?: string;
};

const byName = (a: LibraryGame, b: LibraryGame) => compareNames(a.name, b.name);
const time = (d: Date | null) => (d ? d.getTime() : -Infinity);

/** Games matching platform and name (both sections). */
export function filterLibrary(games: LibraryGame[], { platform, q }: LibraryQuery): LibraryGame[] {
  const folded = q ? foldName(q) : "";
  return games.filter(
    (g) =>
      (!platform || g.platforms.some((p) => p.platform === platform)) && (!folded || foldName(g.name).includes(folded)),
  );
}

export function splitSections(games: LibraryGame[]): Record<LibrarySection, LibraryGame[]> {
  return { jogados: games.filter((g) => g.played), nunca: games.filter((g) => !g.played) };
}

export function sortLibrary(games: LibraryGame[], sort: ProfileGameSort): LibraryGame[] {
  const list = [...games];
  switch (sort) {
    case "horas":
      return list.sort((a, b) => b.playtimeMin - a.playtimeMin || byName(a, b));
    case "recentes":
      return list.sort((a, b) => time(b.lastPlayedAt) - time(a.lastPlayedAt) || b.playtimeMin - a.playtimeMin || byName(a, b));
    case "conclusao":
      // Games without achievements last; then the most unlocks.
      return list.sort(
        (a, b) =>
          (b.completionPct ?? -1) - (a.completionPct ?? -1) || b.unlockedCount - a.unlockedCount || byName(a, b),
      );
    case "nome":
      return list.sort(byName);
  }
}

/** Platforms the player has games on, in the usual order. */
export function libraryPlatforms(games: LibraryGame[]): PlatformId[] {
  const present = new Set(games.flatMap((g) => g.platforms.map((p) => p.platform)));
  return PROFILE_PLATFORMS.filter((p) => present.has(p));
}

/** "1.234 h", "45 min", "—" for nothing. */
export function formatPlaytime(minutes: number): string {
  if (minutes <= 0) return "—";
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return `${(hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours)).toLocaleString("pt-BR")} h`;
}
