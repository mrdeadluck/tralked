import { prisma } from "@/lib/db";
import type { PlatformId } from "@/lib/engine/trophies";
import { achievementTotal as platformTotal } from "@/lib/games/achievement-total";
import type { ArtAsset } from "@/lib/art/frame";
import { GAME_ART_SELECT, gameArtUrls } from "@/lib/queries/game-art";
import { libraryVersions, type LibraryVersion, type ListProgress } from "./versions";

/**
 * Read helpers of a player's library, wishlist and playtime (Plano 4, F1/F2) for the profile pages.
 * Database only (the syncs write these rows). They do not check visibility: callers decide whether
 * the profile may be shown (User.profilePublic, owner).
 */

const PLATFORMS: PlatformId[] = ["steam", "psn", "xbox", "retro"];
const asPlatform = (value: string): PlatformId =>
  (PLATFORMS as string[]).includes(value) ? (value as PlatformId) : "steam";

/** One platform's copy of a library game. */
export type LibraryPlatformEntry = {
  platform: PlatformId;
  /** The platform's own playtime (0: never played or not reported). */
  playtimeMin: number;
  /** Steam only: playtime of the last 2 weeks. */
  playtime2WeeksMin: number | null;
  lastPlayedAt: Date | null;
  unlockedCount: number;
  /** Achievements/trophies of the game on that platform (0: none known). */
  achievementTotal: number;
  completedAt: Date | null;
};

/** A game of the library, merged over the platforms the player has it on. */
export type LibraryGame = {
  gameId: string;
  slug: string;
  name: string;
  /** Portrait cover (Game.coverUrl, else the first cover media); null: draw generated art. */
  coverUrl: string | null;
  steamAppId: number | null;
  /** The Steam details were fetched (no Steam portrait to guess: lib/case-art `caseArt`). */
  portraitChecked: boolean;
  /** Name-only entry of the full Steam catalog (details not fetched yet). */
  stub: boolean;
  platforms: LibraryPlatformEntry[];
  /**
   * The player's versions of the game (lib/library/versions): one per PSN console, Xbox title and
   * RA set (their UserTrophyList rows) and Steam (its UserGame), each with its best list's progress.
   * Read only with `{ versions: true }` (the profile's cover grid).
   */
  versions?: LibraryVersion[];
  /** Sum over platforms. */
  playtimeMin: number;
  /** Most recent over platforms. */
  lastPlayedAt: Date | null;
  unlockedCount: number;
  achievementTotal: number;
  /** 0-100 over all platforms' achievements; null when the game has none. */
  completionPct: number | null;
  /** Playtime or at least one unlock on some platform. */
  played: boolean;
  /** 100% on some platform. */
  completed: boolean;
};

/**
 * Every game of the player's library (all platforms, never-played ones included), most played
 * first. Sorting/filtering for the UI (hours, recent, completion, name, platform, "never played")
 * is done on this list. Two reads whatever the library's size (the UserGame rows and one aggregate
 * of the trophy rows); `versions` adds two (the player's lists and their platinum unlocks).
 */
export async function getUserLibrary(userId: string, opts: { versions?: boolean } = {}): Promise<LibraryGame[]> {
  const rows = await prisma.userGame.findMany({
    where: { userId },
    select: {
      gameId: true,
      platform: true,
      playtimeMin: true,
      playtime2WeeksMin: true,
      lastPlayedAt: true,
      unlockedCount: true,
      completedAt: true,
      game: {
        select: {
          slug: true,
          name: true,
          coverUrl: true,
          steamAppId: true,
          stub: true,
          detailsSyncedAt: true,
          achievementCount: true,
          media: { where: { kind: "cover", url: { not: null } }, orderBy: { order: "asc" }, take: 1, select: { url: true } },
        },
      },
    },
  });
  if (rows.length === 0) return [];
  const [totals, userLists, platinumRows] = await Promise.all([
    prisma.achievement.groupBy({
      by: ["gameId", "platform", "listId"],
      where: { gameId: { in: [...new Set(rows.map((r) => r.gameId))] } },
      _count: { _all: true },
    }),
    opts.versions
      ? prisma.userTrophyList.findMany({
          where: { userId },
          select: {
            listId: true,
            unlockedCount: true,
            completedAt: true,
            list: { select: { gameId: true, platform: true, console: true, externalId: true, trophyCount: true } },
          },
        })
      : [],
    opts.versions
      ? prisma.userAchievement.findMany({
          where: { userId, suspicious: false, achievement: { trophyTier: "platinum" } },
          select: { achievement: { select: { listId: true } } },
        })
      : [],
  ]);
  const totalOf = new Map<string, number>();
  const listTotal = new Map<string, number>();
  for (const t of totals) {
    const key = `${t.gameId}:${t.platform}`;
    totalOf.set(key, (totalOf.get(key) ?? 0) + t._count._all);
    listTotal.set(t.listId, t._count._all);
  }
  const platinumLists = new Set(platinumRows.map((u) => u.achievement.listId));
  const listsOf = new Map<string, ListProgress[]>();
  for (const u of userLists) {
    const progress: ListProgress = {
      platform: u.list.platform,
      console: u.list.console,
      externalId: u.list.externalId,
      unlockedCount: u.unlockedCount,
      completedAt: u.completedAt,
      total: listTotal.get(u.listId) || u.list.trophyCount,
      platinumEarned: platinumLists.has(u.listId),
    };
    const lists = listsOf.get(u.list.gameId);
    if (lists) lists.push(progress);
    else listsOf.set(u.list.gameId, [progress]);
  }

  const games = new Map<string, LibraryGame>();
  for (const r of rows) {
    let game = games.get(r.gameId);
    if (!game) {
      game = {
        gameId: r.gameId,
        slug: r.game.slug,
        name: r.game.name,
        coverUrl: r.game.coverUrl ?? r.game.media[0]?.url ?? null,
        steamAppId: r.game.steamAppId,
        portraitChecked: r.game.detailsSyncedAt !== null,
        stub: r.game.stub,
        platforms: [],
        playtimeMin: 0,
        lastPlayedAt: null,
        unlockedCount: 0,
        achievementTotal: 0,
        completionPct: null,
        played: false,
        completed: false,
      };
      games.set(r.gameId, game);
    }
    const counted = totalOf.get(`${r.gameId}:${r.platform}`) ?? 0;
    const achievementTotal = platformTotal(r.platform, r.game.achievementCount, counted);
    game.platforms.push({
      platform: asPlatform(r.platform),
      playtimeMin: Math.max(0, r.playtimeMin),
      playtime2WeeksMin: r.playtime2WeeksMin,
      lastPlayedAt: r.lastPlayedAt,
      unlockedCount: r.unlockedCount,
      achievementTotal,
      completedAt: r.completedAt,
    });
    game.playtimeMin += Math.max(0, r.playtimeMin);
    if (r.lastPlayedAt && (!game.lastPlayedAt || r.lastPlayedAt > game.lastPlayedAt)) game.lastPlayedAt = r.lastPlayedAt;
    game.unlockedCount += r.unlockedCount;
    game.achievementTotal += achievementTotal;
    game.played ||= r.playtimeMin > 0 || r.unlockedCount > 0;
    game.completed ||= r.completedAt !== null;
  }
  for (const game of games.values()) {
    game.platforms.sort((a, b) => PLATFORMS.indexOf(a.platform) - PLATFORMS.indexOf(b.platform));
    game.completionPct =
      game.achievementTotal > 0 ? Math.min(100, Math.round((game.unlockedCount / game.achievementTotal) * 100)) : null;
    if (opts.versions) game.versions = libraryVersions(game.platforms, listsOf.get(game.gameId) ?? []);
  }
  return [...games.values()].sort((a, b) => b.playtimeMin - a.playtimeMin || a.name.localeCompare(b.name, "pt-BR"));
}

export type WishlistEntry = {
  gameId: string;
  slug: string;
  name: string;
  coverUrl: string | null;
  /** Wide art (hero, else official artwork or a screenshot): printed on the case without a cover. */
  heroUrl: string | null;
  steamAppId: number | null;
  /** Every image by kind and shape (lib/art/frame), for the 16:10 card. */
  art: ArtAsset[];
  stub: boolean;
  /** steam */
  platform: PlatformId;
  /** The player's order on the platform (0 = top); null when not set. */
  priority: number | null;
  addedAt: Date | null;
};

/** The player's wishlist (Steam), in the player's own order, then newest first. */
export async function getUserWishlist(userId: string): Promise<WishlistEntry[]> {
  const rows = await prisma.wishlistItem.findMany({
    where: { userId },
    orderBy: [{ priority: { sort: "asc", nulls: "last" } }, { addedAt: { sort: "desc", nulls: "last" } }],
    select: {
      gameId: true,
      platform: true,
      priority: true,
      addedAt: true,
      game: {
        select: { slug: true, name: true, stub: true, ...GAME_ART_SELECT },
      },
    },
  });
  return rows.map((r) => ({
    gameId: r.gameId,
    slug: r.game.slug,
    name: r.game.name,
    ...gameArtUrls(r.game),
    stub: r.game.stub,
    platform: asPlatform(r.platform),
    priority: r.priority,
    addedAt: r.addedAt,
  }));
}

export type PlaytimeTotals = {
  /** Every platform together (minutes). */
  totalMin: number;
  /** Per platform (minutes); platforms without a library are 0. */
  byPlatform: Record<PlatformId, number>;
  /** Steam `playtime_2weeks` summed (minutes). */
  last2WeeksMin: number;
  /** Distinct games (merged over platforms). */
  gamesOwned: number;
  gamesPlayed: number;
  gamesNeverPlayed: number;
  /** The game with the most playtime (all platforms added up). */
  mostPlayed: { gameId: string; slug: string; name: string; playtimeMin: number } | null;
};

/** Hours totals of the player (profile header, statistics, highscores "Horas jogadas"). */
export async function getPlaytimeTotals(userId: string): Promise<PlaytimeTotals> {
  const rows = await prisma.userGame.findMany({
    where: { userId },
    select: {
      gameId: true,
      platform: true,
      playtimeMin: true,
      playtime2WeeksMin: true,
      unlockedCount: true,
      game: { select: { slug: true, name: true } },
    },
  });
  const byPlatform: Record<PlatformId, number> = { steam: 0, psn: 0, xbox: 0, retro: 0 };
  const perGame = new Map<string, { slug: string; name: string; playtimeMin: number; played: boolean }>();
  let last2WeeksMin = 0;
  for (const r of rows) {
    const minutes = Math.max(0, r.playtimeMin);
    byPlatform[asPlatform(r.platform)] += minutes;
    last2WeeksMin += Math.max(0, r.playtime2WeeksMin ?? 0);
    const game = perGame.get(r.gameId) ?? { slug: r.game.slug, name: r.game.name, playtimeMin: 0, played: false };
    game.playtimeMin += minutes;
    game.played ||= minutes > 0 || r.unlockedCount > 0;
    perGame.set(r.gameId, game);
  }
  let mostPlayed: PlaytimeTotals["mostPlayed"] = null;
  for (const [gameId, g] of perGame) {
    if (g.playtimeMin > 0 && (!mostPlayed || g.playtimeMin > mostPlayed.playtimeMin)) {
      mostPlayed = { gameId, slug: g.slug, name: g.name, playtimeMin: g.playtimeMin };
    }
  }
  const gamesPlayed = [...perGame.values()].filter((g) => g.played).length;
  return {
    totalMin: Object.values(byPlatform).reduce((s, m) => s + m, 0),
    byPlatform,
    last2WeeksMin,
    gamesOwned: perGame.size,
    gamesPlayed,
    gamesNeverPlayed: perGame.size - gamesPlayed,
    mostPlayed,
  };
}

/** A game the player played lately (most recent platform first). */
export type RecentlyPlayedGame = {
  slug: string;
  name: string;
  coverUrl: string | null;
  /** Cover fallbacks (lib/case-art): Steam's portrait art, then the hero shown whole. */
  steamAppId: number | null;
  heroUrl: string | null;
  platform: PlatformId;
  playtimeMin: number;
  lastPlayedAt: Date;
};

/**
 * The player's last played games, newest first, one entry per game (its most recent platform):
 * read from UserGame.lastPlayedAt (Steam library, PSN and Xbox played lists), so as fresh as the
 * last sync. Reads only the newest rows, never the whole library.
 */
export async function getRecentlyPlayed(userId: string, limit = 6): Promise<RecentlyPlayedGame[]> {
  const rows = await prisma.userGame.findMany({
    where: { userId, lastPlayedAt: { not: null } },
    orderBy: { lastPlayedAt: "desc" },
    take: limit * 3,
    select: {
      platform: true,
      playtimeMin: true,
      lastPlayedAt: true,
      game: { select: { slug: true, name: true, stub: true, ...GAME_ART_SELECT } },
    },
  });
  const games = new Map<string, RecentlyPlayedGame>();
  for (const row of rows) {
    if (games.size >= limit) break;
    if (!row.lastPlayedAt || games.has(row.game.slug)) continue;
    games.set(row.game.slug, {
      slug: row.game.slug,
      name: row.game.name,
      ...gameArtUrls(row.game),
      platform: asPlatform(row.platform),
      playtimeMin: row.playtimeMin,
      lastPlayedAt: row.lastPlayedAt,
    });
  }
  return [...games.values()];
}
