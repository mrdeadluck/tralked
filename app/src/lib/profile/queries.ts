import type { Prisma } from "@/generated/prisma/client";
import { platinumTally, rarityCounts } from "@/lib/character/counts";
import { prisma } from "@/lib/db";
import type { PlatformId } from "@/lib/engine/trophies";
import type { RarityTier } from "@/lib/engine/types";
import { rarityTier, xpForAchievement } from "@/lib/engine/xp";
import { getPlaytimeTotals, getUserLibrary, type PlaytimeTotals } from "@/lib/library/queries";
import { validCompletions } from "@/lib/progression/completions";
import { GAME_ART_SELECT, gameArtUrls } from "@/lib/queries/game-art";
import { PLATFORM_ORDER, type CharacterPlatform } from "@/lib/character/sheet";
import { BACKDROP_GAMES, pickBackdrops } from "./backdrops";

/**
 * Reads of the full profile (Plano 4, F3): header, achievements (paginated in the database),
 * rarest unlocks and statistics. Valid unlocks only, as the character sheet: suspicious unlocks
 * waiting for review and confirmed fraud never show. Callers check visibility (profilePublic or
 * owner) before calling these.
 */

const PLATFORMS: PlatformId[] = ["steam", "psn", "xbox", "retro"];
const asPlatform = (value: string): PlatformId =>
  (PLATFORMS as string[]).includes(value) ? (value as PlatformId) : "steam";

// ---------- Header ----------

export type ProfileSummary = {
  userId: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  level: number;
  vocation: string;
  /** Total XP (the level box of the header). */
  totalXp: number;
  /** Playtime over every platform (minutes). */
  playtimeMin: number;
  /** "Jogos": distinct games of the library, each once over its platforms (the Jogos tab count). */
  gamesCount: number;
  /** "Platinas (contam no XP)": one per version (PS4 and PS5 are two), as the sheet counts them. */
  platinums: number;
  /** "Listas regionais extras": platinum lists beyond the first of each version (no XP). */
  regionalExtras: number;
  /** Valid unlocks over every platform (the Conquistas tab count). */
  achievements: number;
  /** Games on the wishlist (the Lista de desejos tab count). */
  wishlist: number;
  /** Active connections, in the order Steam, PSN, Xbox, RetroAchievements. */
  platforms: CharacterPlatform[];
  /**
   * Art behind the header, taking turns: the wide art of the last games played (lib/profile/
   * backdrops.ts), at most BACKDROP_GAMES; empty when there is none.
   */
  backdropUrls: string[];
};

/** Playtime over every platform (minutes): the "Horas jogadas" of the profile header. */
export async function getTotalPlaytimeMin(userId: string): Promise<number> {
  const playtime = await prisma.userGame.aggregate({ where: { userId, playtimeMin: { gt: 0 } }, _sum: { playtimeMin: true } });
  return playtime._sum.playtimeMin ?? 0;
}

/** The header of every profile tab (avatar, level, XP, platforms, hours, counters, tab counts). */
export async function getProfileSummary(userId: string): Promise<ProfileSummary | null> {
  const [user, playtimeMin, owned, achievements, wishlist, accounts, recent, top, tally] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        handle: true,
        displayName: true,
        avatarUrl: true,
        stats: { select: { level: true, vocation: true, totalXp: true } },
      },
    }),
    getTotalPlaytimeMin(userId),
    prisma.userGame.groupBy({ by: ["gameId"], where: { userId } }),
    prisma.userAchievement.count({ where: { userId, suspicious: false } }),
    prisma.wishlistItem.count({ where: { userId } }),
    prisma.linkedAccount.findMany({
      where: { userId, linkedAt: { not: null } },
      select: { platform: true, handle: true, verifiedAt: true },
    }),
    // The last games played (rows per platform: a few more than needed, one per game is kept).
    prisma.userGame.findMany({
      where: { userId, lastPlayedAt: { not: null } },
      orderBy: { lastPlayedAt: "desc" },
      take: BACKDROP_GAMES * 4,
      select: { gameId: true, game: { select: GAME_ART_SELECT } },
    }),
    // The most played games (their biggest platform copy), else the ones with most unlocks.
    prisma.userGame.findMany({
      where: { userId, OR: [{ playtimeMin: { gt: 0 } }, { unlockedCount: { gt: 0 } }] },
      orderBy: [{ playtimeMin: "desc" }, { unlockedCount: "desc" }],
      take: BACKDROP_GAMES * 2,
      select: { gameId: true, game: { select: GAME_ART_SELECT } },
    }),
    platinumTally(userId),
  ]);
  if (!user) return null;
  const byPlatform = new Map(accounts.map((a) => [a.platform, a]));
  const withArt = (rows: typeof recent) => rows.map((r) => ({ gameId: r.gameId, art: gameArtUrls(r.game) }));
  return {
    userId,
    handle: user.handle,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    level: user.stats?.level ?? 1,
    vocation: user.stats?.vocation ?? "Recruta",
    totalXp: user.stats?.totalXp ?? 0,
    playtimeMin,
    gamesCount: owned.length,
    platinums: tally.platinums,
    regionalExtras: tally.regionalExtras,
    achievements,
    wishlist,
    platforms: PLATFORM_ORDER.flatMap((platform) => {
      const account = byPlatform.get(platform);
      return account ? [{ platform, handle: account.handle, verified: account.verifiedAt !== null }] : [];
    }),
    backdropUrls: pickBackdrops(withArt(recent), withArt(top)),
  };
}

// ---------- Achievements ----------

export const ACHIEVEMENT_SORTS = ["recentes", "raras", "antigas"] as const;
export type AchievementSort = (typeof ACHIEVEMENT_SORTS)[number];

export const RARITY_TIERS: RarityTier[] = ["lendaria", "epica", "rara", "incomum", "comum"];

/**
 * Global-percentage band of a rarity tier (same thresholds as `rarityTier`; an unknown percentage
 * counts as 50%, i.e. "incomum").
 */
export function rarityWhere(tier: RarityTier): Prisma.AchievementWhereInput {
  switch (tier) {
    case "lendaria":
      return { globalPct: { lte: 3 } };
    case "epica":
      return { globalPct: { gt: 3, lte: 8 } };
    case "rara":
      return { globalPct: { gt: 8, lte: 20 } };
    case "incomum":
      return { OR: [{ globalPct: { gt: 20, lte: 50 } }, { globalPct: null }] };
    case "comum":
      return { globalPct: { gt: 50 } };
  }
}

export type AchievementFilter = {
  platform?: PlatformId;
  rarity?: RarityTier;
  /** Game slug. */
  game?: string;
};

export type ProfileAchievement = {
  id: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  platform: PlatformId;
  globalPct: number | null;
  rarity: RarityTier;
  xp: number;
  /** PSN: bronze | silver | gold | platinum. */
  trophyTier: string | null;
  /** Null: earned on a date the platform does not know ("data desconhecida"). */
  unlockedAt: Date | null;
  game: { slug: string; name: string };
};

const ACHIEVEMENT_SELECT = {
  unlockedAt: true,
  achievement: {
    select: {
      id: true,
      name: true,
      description: true,
      iconUrl: true,
      platform: true,
      globalPct: true,
      trophyTier: true,
      game: { select: { slug: true, name: true } },
    },
  },
} satisfies Prisma.UserAchievementSelect;

type AchievementRow = Prisma.UserAchievementGetPayload<{ select: typeof ACHIEVEMENT_SELECT }>;

function toProfileAchievement(row: AchievementRow): ProfileAchievement {
  const a = row.achievement;
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    iconUrl: a.iconUrl,
    platform: asPlatform(a.platform),
    globalPct: a.globalPct,
    rarity: rarityTier(a.globalPct ?? 50),
    xp: xpForAchievement(a.globalPct),
    trophyTier: a.trophyTier,
    unlockedAt: row.unlockedAt,
    game: a.game,
  };
}

// Unlocks of unknown date come last in every order (Postgres would put them first in `desc`).
const ORDER: Record<AchievementSort, Prisma.UserAchievementOrderByWithRelationInput[]> = {
  recentes: [{ unlockedAt: { sort: "desc", nulls: "last" } }, { achievementId: "asc" }],
  antigas: [{ unlockedAt: { sort: "asc", nulls: "last" } }, { achievementId: "asc" }],
  raras: [
    { achievement: { globalPct: { sort: "asc", nulls: "last" } } },
    { unlockedAt: { sort: "desc", nulls: "last" } },
    { achievementId: "asc" },
  ],
};

/** One page of the player's valid unlocks, filtered and ordered in the database. */
export async function listUserAchievements(
  userId: string,
  filter: AchievementFilter,
  opts: { sort?: AchievementSort; page?: number; perPage?: number } = {},
): Promise<{ items: ProfileAchievement[]; total: number; page: number }> {
  const perPage = opts.perPage ?? 40;
  const achievement: Prisma.AchievementWhereInput = {
    ...(filter.platform ? { platform: filter.platform } : {}),
    ...(filter.game ? { game: { slug: filter.game } } : {}),
    ...(filter.rarity ? rarityWhere(filter.rarity) : {}),
  };
  const where: Prisma.UserAchievementWhereInput = { userId, suspicious: false, achievement };
  const total = await prisma.userAchievement.count({ where });
  const page = Math.min(Math.max(1, Math.floor(opts.page ?? 1)), Math.max(1, Math.ceil(total / perPage)));
  if (total === 0) return { items: [], total, page };
  const rows = await prisma.userAchievement.findMany({
    where,
    orderBy: ORDER[opts.sort ?? "recentes"],
    skip: (page - 1) * perPage,
    take: perPage,
    select: ACHIEVEMENT_SELECT,
  });
  return { items: rows.map(toProfileAchievement), total, page };
}

/** The player's rarest valid unlocks (known global percentage only). */
export async function getRarestAchievements(userId: string, limit = 6): Promise<ProfileAchievement[]> {
  const rows = await prisma.userAchievement.findMany({
    where: { userId, suspicious: false, achievement: { globalPct: { not: null } } },
    orderBy: ORDER.raras,
    take: limit,
    select: ACHIEVEMENT_SELECT,
  });
  return rows.map(toProfileAchievement);
}

export type AchievementGameOption = { slug: string; name: string; unlocks: number };

/** Games the player has valid unlocks in (the "jogo" filter), by name. One aggregate query. */
export async function getAchievementGameOptions(userId: string): Promise<AchievementGameOption[]> {
  return prisma.$queryRaw<AchievementGameOption[]>`
    SELECT g.slug, g.name, count(*)::int AS unlocks
    FROM "UserAchievement" ua
    JOIN "Achievement" a ON a.id = ua."achievementId"
    JOIN "Game" g ON g.id = a."gameId"
    WHERE ua."userId" = ${userId} AND ua.suspicious = false
    GROUP BY g.slug, g.name
    ORDER BY g.name`;
}

// ---------- Statistics ----------

export type ProfileStats = {
  playtime: PlaytimeTotals;
  /** Distinct games with a valid 100% on any platform (as "Jogos 100%" on the sheet). */
  perfectGames: number;
  /** Mean completion of the played games that have achievements (0-100); null when none. */
  averageCompletion: number | null;
  /** Games started (some unlock) and with achievements: the base of the mean. */
  startedGames: number;
  achievements: number;
  achievementsByPlatform: { platform: PlatformId; count: number }[];
  /** Oldest year first; unlocks of unknown date are in no year. */
  achievementsByYear: { year: number; count: number }[];
  rarityCounts: Record<RarityTier, number>;
};

export async function getProfileStats(userId: string): Promise<ProfileStats> {
  const [playtime, library, completions, byPlatform, byYear, rarity] = await Promise.all([
    getPlaytimeTotals(userId),
    getUserLibrary(userId),
    validCompletions(userId),
    prisma.$queryRaw<{ platform: string; count: number }[]>`
      SELECT a.platform, count(*)::int AS count
      FROM "UserAchievement" ua JOIN "Achievement" a ON a.id = ua."achievementId"
      WHERE ua."userId" = ${userId} AND ua.suspicious = false
      GROUP BY a.platform`,
    prisma.$queryRaw<{ year: number; count: number }[]>`
      SELECT extract(year FROM ua."unlockedAt" AT TIME ZONE 'America/Sao_Paulo')::int AS year, count(*)::int AS count
      FROM "UserAchievement" ua
      WHERE ua."userId" = ${userId} AND ua.suspicious = false AND ua."unlockedAt" IS NOT NULL
      GROUP BY 1 ORDER BY 1`,
    // The sheet's "Lendárias" reads the same function (lib/character/counts).
    rarityCounts(userId),
  ]);

  const started = library.filter((g) => g.completionPct !== null && g.unlockedCount > 0);
  const averageCompletion =
    started.length > 0 ? Math.round(started.reduce((sum, g) => sum + (g.completionPct ?? 0), 0) / started.length) : null;
  const platformCount = new Map(byPlatform.map((r) => [r.platform, r.count]));

  return {
    playtime,
    perfectGames: new Set(completions.map((c) => c.gameId)).size,
    averageCompletion,
    startedGames: started.length,
    achievements: byPlatform.reduce((sum, r) => sum + r.count, 0),
    achievementsByPlatform: PLATFORMS.filter((p) => (platformCount.get(p) ?? 0) > 0).map((platform) => ({
      platform,
      count: platformCount.get(platform)!,
    })),
    achievementsByYear: byYear,
    rarityCounts: rarity,
  };
}
