import { cacheLife, cacheTag } from "next/cache";
import { GALLERY_TAG } from "@/lib/community/cached";
import { listPhotos, type PhotoCardView } from "@/lib/community/gallery";
import { prisma } from "@/lib/db";
import {
  colecaoPoints,
  gloriaPoints,
  precisaoPoints,
  vigorPoints,
} from "@/lib/engine/attributes";
import { applySkillPoints, skillNeed } from "@/lib/engine/skills";
import { trophyTierFromRarity, type PlatformId, type TrophyTier } from "@/lib/engine/trophies";
import { SKILLS, type SkillId } from "@/lib/engine/types";
import { rarityTier } from "@/lib/engine/xp";
import { platinumSourceKey } from "@/lib/progression/recompute";
import { skillPointTotals } from "@/lib/progression/skills-from-ledger";
import { timeAgo } from "@/lib/time-ago";
import { gameTag } from "./games-cached";
import {
  artHues,
  articleStory,
  buildWireItems,
  categoryLabel,
  CATEGORIES,
  getArticlesForGame,
  getExternalHeadlines,
  hashSeed,
  NEWS_TAG,
  type ArticleCard,
  type ExternalHeadline,
  type Hues,
  type NewsTab,
  type StoryCard,
  type WireItem,
} from "./news";

/*
 * Game profile page data. `getGameProfile` is the public part (cached, same for everyone, part of
 * the static shell); `getGameProfileForUser` is the visitor's own progress, rendered in dynamic
 * islands. Plain loaders (`loadGameProfile`) stay testable without the Next cache.
 */

export const PLATFORM_ORDER: PlatformId[] = ["steam", "psn", "xbox", "retro"];
export const PLATFORM_NAME: Record<PlatformId, string> = {
  steam: "Steam",
  psn: "PSN",
  xbox: "Xbox",
  retro: "RetroAchievements",
};

export type TierCounts = Record<TrophyTier, number>;

export type GameVideo =
  | { id: string; kind: "file"; url: string; poster: string | null; title: string; source: string }
  | { id: string; kind: "youtube"; youtubeId: string; title: string; source: string };

export type GameShot = { id: string; url: string | null; seed: number; label: string };

export type SimilarGame = {
  slug: string;
  name: string;
  coverUrl: string | null;
  hues: Hues;
  seed: number;
  genre: string;
  /** Share of skills in common (0-100). */
  match: number;
};

export type GameProfile = {
  id: string;
  slug: string;
  name: string;
  summary: string | null;
  developer: string | null;
  publisher: string | null;
  releaseYear: number | null;
  criticScore: number | null;
  /** Catalog platforms (PC | PLAYSTATION | XBOX | NINTENDO). */
  platforms: string[];
  skills: SkillId[];
  genres: string[];
  art: { cover: string | null; hero: string | null; logo: string | null };
  hues: Hues;
  seed: number;
  achievements: {
    /** Steam achievement count (the catalog headline). */
    steam: number;
    byPlatform: { platform: PlatformId; total: number }[];
    /** Steam achievements unlocked by at most 3% of players. */
    legendary: number;
    /** Every trophy of the game by tier (native tier, else from rarity; one platinum per platform). */
    tiers: TierCounts;
  };
  /** Hours to 100%: Tralked players who completed it, else the catalog estimate. */
  timeTo100: { minutes: number; players: number } | null;
  /** Published guide only. */
  guide: { missables: number } | null;
  videos: GameVideo[];
  shots: GameShot[];
  news: { wire: WireItem[]; tabs: NewsTab[]; mostRead: StoryCard[]; count: number };
  gallery: { photos: PhotoCardView[]; total: number };
  similar: SimilarGame[];
};

/** Only https URLs (or same-site paths) reach `src`/`href`: no mixed content, no other schemes. */
export function safeMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  // A same-site path; "//host" and "/\host" are read by browsers as another host.
  if (url.startsWith("/")) return url[1] === "/" || url[1] === "\\" ? null : url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

const TIERS: TrophyTier[] = ["platinum", "gold", "silver", "bronze"];
const TIER_SET = new Set<string>(TIERS);
const emptyTiers = (): TierCounts => ({ platinum: 0, gold: 0, silver: 0, bronze: 0 });

/** Native tier (PSN) when there is one, otherwise the tier from the global rarity (as recompute). */
export function tierOf(a: { trophyTier: string | null; globalPct: number | null }): TrophyTier {
  return a.trophyTier && TIER_SET.has(a.trophyTier) ? (a.trophyTier as TrophyTier) : trophyTierFromRarity(a.globalPct);
}

const skillName = (id: SkillId) => SKILLS.find((s) => s.id === id)?.name ?? id;
const genresOf = (skills: SkillId[]) => skills.filter((s) => s !== "sabio");

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

const VIDEO_SOURCE: Record<string, string> = {
  steam: "Steam",
  igdb: "YouTube via IGDB",
  rawg: "RAWG",
  sgdb: "SteamGridDB",
  fixture: "Tralked",
};

type MediaRow = { id: string; kind: string; url: string | null; youtubeId: string | null; source: string; order: number };

/** Playable videos only: an https file or a valid YouTube id. Fixture rows without either are skipped. */
export function playableVideos(rows: MediaRow[], poster: string | null): GameVideo[] {
  const videos: GameVideo[] = [];
  for (const row of rows) {
    if (row.kind !== "video") continue;
    const title = videos.length === 0 ? "Trailer" : `Vídeo ${videos.length + 1}`;
    const source = VIDEO_SOURCE[row.source] ?? row.source;
    const url = safeMediaUrl(row.url);
    if (url) videos.push({ id: row.id, kind: "file", url, poster, title, source });
    else if (row.youtubeId && YOUTUBE_ID.test(row.youtubeId)) {
      videos.push({ id: row.id, kind: "youtube", youtubeId: row.youtubeId, title, source });
    }
  }
  return videos;
}

/** "Últimas" (editorial + press), one tab per category that has stories, and "Na imprensa". */
export function buildGameNewsTabs(
  articles: ArticleCard[],
  external: ExternalHeadline[],
  now: Date,
  heroUrl: string | null,
): NewsTab[] {
  const pressStory = (h: ExternalHeadline): StoryCard => ({
    id: `x:${h.id}`,
    href: h.url,
    external: true,
    kicker: "Imprensa",
    title: h.title,
    source: `Fonte externa: ${h.source}`,
    when: timeAgo(h.publishedAt, now),
    imageUrl: heroUrl,
    seed: hashSeed(h.url),
    hues: artHues(h.game?.slug, h.url),
  });
  const dated = [
    ...articles.map((a) => ({ at: a.publishedAt, story: articleStory(a, now) })),
    ...external.map((h) => ({ at: h.publishedAt, story: pressStory(h) })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  const tabs: NewsTab[] = [{ id: "ultimas", label: "Últimas", stories: dated.map((d) => d.story) }];
  for (const c of CATEGORIES) {
    const stories = articles.filter((a) => a.category === c.id).map((a) => articleStory(a, now));
    if (stories.length > 0) tabs.push({ id: c.slug, label: categoryLabel(c.id), stories });
  }
  if (external.length > 0) tabs.push({ id: "imprensa", label: "Na imprensa", stories: external.map(pressStory) });
  return tabs;
}

/** Similar games: share of skills in common (Jaccard), best first; ties by name. */
export function rankSimilar<T extends { skills: SkillId[]; name: string }>(
  skills: SkillId[],
  candidates: T[],
): (T & { match: number })[] {
  const mine = new Set(genresOf(skills));
  return candidates
    .map((c) => {
      const theirs = new Set(genresOf(c.skills));
      const shared = [...theirs].filter((s) => mine.has(s)).length;
      const union = new Set([...mine, ...theirs]).size;
      return { ...c, match: union ? Math.round((shared / union) * 100) : 0 };
    })
    .filter((c) => c.match > 0)
    .sort((a, b) => b.match - a.match || a.name.localeCompare(b.name, "pt-BR"));
}

/** Public profile of a game (no per-user data). Null for an unknown slug. */
export async function loadGameProfile(slug: string, now: Date = new Date()): Promise<GameProfile | null> {
  const game = await prisma.game.findUnique({
    where: { slug },
    include: {
      skills: true,
      media: { orderBy: [{ kind: "asc" }, { order: "asc" }] },
      guide: { select: { status: true, missables: true } },
    },
  });
  if (!game) return null;

  const skills = game.skills.map((s) => s.skill as SkillId);
  const firstUrl = (kind: string) => game.media.filter((m) => m.kind === kind).map((m) => safeMediaUrl(m.url)).find(Boolean) ?? null;
  const art = {
    cover: firstUrl("cover") ?? safeMediaUrl(game.coverUrl),
    hero: firstUrl("hero") ?? safeMediaUrl(game.heroUrl),
    logo: firstUrl("logo") ?? safeMediaUrl(game.logoUrl),
  };
  const hues = artHues(slug, slug);

  const [achievementRows, completions, articles, external, gallery, similar] = await Promise.all([
    prisma.achievement.findMany({
      where: { gameId: game.id },
      select: { platform: true, globalPct: true, trophyTier: true },
    }),
    prisma.userGame.findMany({
      where: { gameId: game.id, completedAt: { not: null }, playtimeMin: { gt: 0 } },
      select: { userId: true, playtimeMin: true },
    }),
    getArticlesForGame(game.id, 12),
    getExternalHeadlines(8, [slug]),
    listPhotos({ gameSlug: slug, page: 1 }),
    loadSimilar(game.id, skills),
  ]);

  // Per-platform totals: Steam uses the catalog count (its rows may be partial), others their rows.
  const counts = new Map<PlatformId, number>();
  for (const row of achievementRows) {
    const p = row.platform as PlatformId;
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  if (game.achievementCount > 0) counts.set("steam", game.achievementCount);
  const byPlatform = PLATFORM_ORDER.filter((p) => (counts.get(p) ?? 0) > 0).map((platform) => ({
    platform,
    total: counts.get(platform)!,
  }));

  const tiers = emptyTiers();
  const nativePlatinum = new Set<string>();
  for (const row of achievementRows) {
    const tier = tierOf(row);
    tiers[tier]++;
    if (tier === "platinum") nativePlatinum.add(row.platform);
  }
  for (const { platform } of byPlatform) if (!nativePlatinum.has(platform)) tiers.platinum++;

  // One time per player: the fastest completed platform.
  const bestByUser = new Map<string, number>();
  for (const c of completions) bestByUser.set(c.userId, Math.min(bestByUser.get(c.userId) ?? Infinity, c.playtimeMin));
  const times = [...bestByUser.values()];
  const timeTo100 = times.length
    ? { minutes: median(times), players: times.length }
    : game.timeToBeatCompleteMin
      ? { minutes: game.timeToBeatCompleteMin, players: 0 }
      : null;

  const mostRead = [...articles]
    .sort((a, b) => b.likes + b.comments - (a.likes + a.comments) || b.publishedAt.getTime() - a.publishedAt.getTime())
    .slice(0, 5)
    .map((a) => articleStory(a, now));

  const poster = art.hero ?? firstUrl("screenshot");
  const shots: GameShot[] = game.media
    .filter((m) => m.kind === "screenshot" || m.kind === "artwork")
    .sort((a, b) => (a.kind === b.kind ? a.order - b.order : a.kind === "screenshot" ? -1 : 1))
    .map((m, i) => ({
      id: m.id,
      url: safeMediaUrl(m.url),
      seed: hashSeed(m.id),
      label: `${m.kind === "artwork" ? "Arte oficial" : "Captura oficial"} ${i + 1} de ${game.name}`,
    }));

  return {
    id: game.id,
    slug: game.slug,
    name: game.name,
    summary: game.summary,
    developer: game.developer,
    publisher: game.publisher,
    releaseYear: game.releaseDate ? game.releaseDate.getUTCFullYear() : null,
    criticScore: game.criticScore,
    platforms: game.platforms,
    skills,
    genres: genresOf(skills).map(skillName),
    art,
    hues,
    seed: hashSeed(slug),
    achievements: {
      steam: game.achievementCount,
      byPlatform,
      legendary: achievementRows.filter(
        (a) => a.platform === "steam" && a.globalPct !== null && rarityTier(a.globalPct) === "lendaria",
      ).length,
      tiers,
    },
    timeTo100,
    guide: game.guide?.status === "published" ? { missables: game.guide.missables } : null,
    videos: playableVideos(game.media, poster),
    shots,
    news: {
      wire: buildWireItems(articles, external, now, 10),
      tabs: buildGameNewsTabs(articles, external, now, art.hero),
      mostRead,
      count: articles.length + external.length,
    },
    gallery: { photos: gallery.photos.slice(0, 9), total: gallery.total },
    similar,
  };
}

async function loadSimilar(gameId: string, skills: SkillId[]): Promise<SimilarGame[]> {
  const genres = genresOf(skills);
  if (genres.length === 0) return [];
  const rows = await prisma.game.findMany({
    where: { id: { not: gameId }, skills: { some: { skill: { in: genres } } } },
    select: {
      slug: true,
      name: true,
      coverUrl: true,
      skills: { select: { skill: true } },
      media: { where: { kind: "cover", url: { not: null } }, orderBy: { order: "asc" }, take: 1, select: { url: true } },
    },
  });
  const ranked = rankSimilar(
    skills,
    rows.map((r) => ({ ...r, skills: r.skills.map((s) => s.skill as SkillId) })),
  );
  return ranked.slice(0, 10).map((r) => ({
    slug: r.slug,
    name: r.name,
    coverUrl: safeMediaUrl(r.media[0]?.url) ?? safeMediaUrl(r.coverUrl),
    hues: artHues(r.slug, r.slug),
    seed: hashSeed(r.slug),
    genre: skillName(genresOf(r.skills).find((s) => genres.includes(s)) ?? r.skills[0]),
    match: r.match,
  }));
}

/** Cached public profile: tagged with the game, the news and the gallery so their updates show. */
export async function getGameProfile(slug: string): Promise<GameProfile | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(gameTag(slug), NEWS_TAG, GALLERY_TAG);
  return loadGameProfile(slug);
}

// ---------- Per-user ----------

export type PlatformProgress = {
  platform: PlatformId;
  unlocked: number;
  total: number;
  /** 0-100; 100 only when the platform reports the game complete or every achievement is unlocked. */
  pct: number;
  playtimeMin: number;
  completed: boolean;
};

export type GameAttributes = {
  xp: number;
  hours: number;
  vigor: number;
  precisao: number;
  rareCount: number;
  gloria: number;
  colecao: number;
  completed: boolean;
  skill: { id: SkillId; name: string; level: number; levelsFromGame: number } | null;
};

export type FamilyPlayer = { handle: string; me: boolean; platform: PlatformId; playtimeMin: number; pct: number };

export type GameUserProfile = {
  opened: boolean;
  /** Null when the user never played the game on any linked platform. */
  progress: {
    platforms: PlatformProgress[];
    /** Headline platform: a completed one, else the highest completion. */
    best: PlatformProgress;
    playtimeMin: number;
    completed: boolean;
  } | null;
  /** Unlocked trophies by tier, pooled across platforms; `platinumOf` = platforms played. */
  trophies: (TierCounts & { platinumOf: number }) | null;
  attributes: GameAttributes | null;
  /** Null when the user has no family; otherwise members who played it (public profiles + self). */
  family: FamilyPlayer[] | null;
};

export function platformProgress(row: { platform: string; unlockedCount: number; playtimeMin: number; completedAt: Date | null }, total: number): PlatformProgress {
  const unlocked = Math.max(0, row.unlockedCount);
  const completed = row.completedAt !== null || (total > 0 && unlocked >= total);
  const raw = total > 0 ? Math.round((unlocked / total) * 100) : 0;
  return {
    platform: row.platform as PlatformId,
    unlocked,
    total,
    pct: completed ? 100 : Math.min(99, raw),
    playtimeMin: Math.max(0, row.playtimeMin),
    completed,
  };
}

/** Completed beats incomplete, then the higher percentage, then more unlocks. */
export function bestProgress(list: PlatformProgress[]): PlatformProgress | null {
  return (
    [...list].sort(
      (a, b) => Number(b.completed) - Number(a.completed) || b.pct - a.pct || b.unlocked - a.unlocked,
    )[0] ?? null
  );
}

/** Total skill points behind a SkillProgress row (levels start at 1 with 0 points). */
function skillTotal(level: number, points: number): number {
  let total = points;
  for (let l = 1; l < level; l++) total += skillNeed(l);
  return total;
}

export async function getGameProfileForUser(slug: string, userId: string): Promise<GameUserProfile | null> {
  const game = await prisma.game.findUnique({
    where: { slug },
    select: { id: true, achievementCount: true, skills: { select: { skill: true } } },
  });
  if (!game) return null;
  const gameId = game.id;

  const [opened, userGames, totalsByPlatform, unlocks, membership] = await Promise.all([
    prisma.gameOpen.findUnique({ where: { userId_gameId: { userId, gameId } }, select: { userId: true } }),
    prisma.userGame.findMany({ where: { userId, gameId } }),
    prisma.achievement.groupBy({ by: ["platform"], where: { gameId }, _count: { _all: true } }),
    prisma.userAchievement.findMany({
      where: { userId, achievement: { gameId } },
      select: {
        achievementId: true,
        suspicious: true,
        hardcore: true,
        achievement: { select: { platform: true, globalPct: true, trophyTier: true } },
      },
    }),
    prisma.familyMember.findUnique({ where: { userId }, select: { familyId: true } }),
  ]);

  const totalOf = (platform: string) => {
    if (platform === "steam" && game.achievementCount > 0) return game.achievementCount;
    return totalsByPlatform.find((t) => t.platform === platform)?._count._all ?? 0;
  };

  const platforms = userGames
    .map((ug) => platformProgress(ug, totalOf(ug.platform)))
    .sort((a, b) => PLATFORM_ORDER.indexOf(a.platform) - PLATFORM_ORDER.indexOf(b.platform));
  const best = bestProgress(platforms);
  const playtimeMin = platforms.reduce((acc, p) => acc + p.playtimeMin, 0);
  const completed = platforms.some((p) => p.completed);

  // Trophies, pooled across platforms (same rules as the attribute recompute).
  const valid = unlocks.filter((u) => !u.suspicious);
  const trophies = emptyTiers();
  const nativePlatinum = new Set<string>();
  for (const u of valid) {
    const tier = tierOf(u.achievement);
    trophies[tier]++;
    if (tier === "platinum") nativePlatinum.add(u.achievement.platform);
  }
  let completionPlatinums = 0;
  for (const p of platforms) {
    if (p.completed && !nativePlatinum.has(p.platform)) completionPlatinums++;
  }
  trophies.platinum += completionPlatinums;

  // XP and skill points this game paid (voided entries never count).
  const ledger = await prisma.xpLedgerEntry.findMany({
    where: {
      userId,
      voidedAt: null,
      OR: [
        { source: "achievement", sourceKey: { in: unlocks.map((u) => u.achievementId) } },
        { source: "platinum", sourceKey: { in: PLATFORM_ORDER.map((p) => platinumSourceKey(p, gameId)) } },
      ],
    },
    select: { xp: true, skills: true, skillPoints: true },
  });
  const xp = ledger.reduce((acc, e) => acc + e.xp, 0);

  const genre = genresOf(game.skills.map((s) => s.skill as SkillId))[0] ?? null;
  let skill: GameAttributes["skill"] = null;
  if (genre) {
    const fromGame = skillPointTotals(
      ledger.map((e) => ({ xp: e.xp, skills: e.skills, skillPoints: (e.skillPoints as Record<string, number> | null) ?? null })),
    )[genre];
    const row = await prisma.skillProgress.findUnique({ where: { userId_skill: { userId, skill: genre } } });
    const level = row?.level ?? 1;
    const before = applySkillPoints({ level: 1, points: 0 }, Math.max(0, skillTotal(level, row?.points ?? 0) - fromGame)).state.level;
    skill = { id: genre, name: skillName(genre), level, levelsFromGame: Math.max(0, level - before) };
  }

  const tiersList = [
    ...valid.map((u) => tierOf(u.achievement)),
    ...Array.from({ length: completionPlatinums }, () => "platinum" as const),
  ];
  const attributes: GameAttributes | null =
    platforms.length > 0 || valid.length > 0
      ? {
          xp,
          hours: Math.round(playtimeMin / 60),
          vigor: vigorPoints([playtimeMin]),
          precisao: precisaoPoints(valid.map((u) => ({ globalPct: u.achievement.globalPct, hardcore: u.hardcore }))),
          rareCount: valid.filter((u) => u.achievement.globalPct !== null && u.achievement.globalPct <= 5).length,
          gloria: gloriaPoints(tiersList),
          colecao: colecaoPoints(completed ? 1 : 0),
          completed,
          skill,
        }
      : null;

  return {
    opened: opened !== null,
    progress: best ? { platforms, best, playtimeMin, completed } : null,
    trophies: platforms.length > 0 ? { ...trophies, platinumOf: platforms.length } : null,
    attributes,
    family: membership ? await familyPlayers(membership.familyId, userId, gameId, totalOf) : null,
  };
}

async function familyPlayers(
  familyId: string,
  userId: string,
  gameId: string,
  totalOf: (platform: string) => number,
): Promise<FamilyPlayer[]> {
  const members = await prisma.familyMember.findMany({
    where: { familyId, OR: [{ userId }, { user: { profilePublic: true } }] },
    select: { userId: true, user: { select: { handle: true } } },
  });
  const rows = await prisma.userGame.findMany({ where: { gameId, userId: { in: members.map((m) => m.userId) } } });
  const players: FamilyPlayer[] = [];
  for (const m of members) {
    const list = rows.filter((r) => r.userId === m.userId).map((r) => platformProgress(r, totalOf(r.platform)));
    const best = bestProgress(list);
    if (!best) continue;
    players.push({
      handle: m.user.handle,
      me: m.userId === userId,
      platform: best.platform,
      playtimeMin: list.reduce((acc, p) => acc + p.playtimeMin, 0),
      pct: best.pct,
    });
  }
  return players.sort((a, b) => Number(b.me) - Number(a.me) || b.pct - a.pct || a.handle.localeCompare(b.handle));
}
