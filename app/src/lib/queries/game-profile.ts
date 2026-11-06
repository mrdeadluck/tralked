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
import { PLAYTIME_MILESTONES_H, playtimeSourceKey } from "@/lib/engine/playtime";
import { orderedGenres } from "@/lib/engine/genres";
import { applySkillPoints, skillNeed, skillPointsFor } from "@/lib/engine/skills";
import { trophyTierFromRarity, type PlatformId, type TrophyTier } from "@/lib/engine/trophies";
import { SKILLS, type SkillId } from "@/lib/engine/types";
import { platinumBonus, rarityTier, xpForAchievement } from "@/lib/engine/xp";
import { achievementTotal } from "@/lib/games/achievement-total";
import { platinumSourceKey } from "@/lib/progression/recompute";
import { skillPointTotals } from "@/lib/progression/skills-from-ledger";
import { timeAgo } from "@/lib/time-ago";
import { getGameVersions, getPlayerVersions, type GameVersion, type PlayerVersion } from "./game-versions";
import { gameTag } from "./games-cached";
import { loadTimeTo100, type TimeTo100 } from "./time-to-100";
import {
  artHues,
  articleStory,
  buildWireItems,
  categoryLabel,
  CATEGORIES,
  getArticlesForGame,
  getArticlesForStudio,
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

/** `thumbnail`: the video's own still (Steam movie thumbnail, YouTube's), never shared between videos. */
export type GameVideo =
  | { id: string; kind: "file"; url: string; thumbnail: string | null; title: string; source: string }
  | { id: string; kind: "youtube"; youtubeId: string; thumbnail: string; title: string; source: string };

/**
 * What the disc label prints. Never the cover nor the hero (they are already the case front and
 * the page background): a screenshot of the game, else its logo over a colour read from the art
 * (`tintFrom`, only sampled for its colour), else the generated art.
 */
export type DiscLabelArt =
  | { kind: "shot"; url: string }
  | { kind: "logo"; url: string; tintFrom: string | null }
  | { kind: "generated" };

/**
 * Muted gameplay loop behind the booklet (the game page's banner): a stored trailer file (Steam's
 * mp4, lighter 480p first), else a YouTube trailer (privacy-enhanced embed).
 */
export type BackdropVideo =
  | { kind: "file"; sources: string[]; poster: string | null }
  | { kind: "youtube"; youtubeId: string }
  | null;

export type GameShot = { id: string; url: string | null; seed: number; label: string };

export type SimilarGame = {
  slug: string;
  name: string;
  coverUrl: string | null;
  /** Cover fallbacks (lib/case-art). */
  steamAppId: number | null;
  heroUrl: string | null;
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
  art: { cover: string | null; hero: string | null; logo: string | null; disc: DiscLabelArt };
  hues: Hues;
  seed: number;
  /** Background loop of the booklet; null without any trailer. */
  backdrop: BackdropVideo;
  achievements: {
    /** Steam achievement count. */
    steam: number;
    /** Each platform with achievements, in PLATFORM_ORDER, with its own tiers (never summed). */
    byPlatform: CatalogPlatform[];
    /**
     * The platform the page headlines (ficha, disc, trophy grid): Steam when it has a count, else
     * the first platform with achievements. Null for a game without achievements.
     */
    main: CatalogPlatform | null;
  };
  /** The game's versions (Steam, each PSN console, each Xbox title, each RA set): rows and trophy tabs. */
  versions: GameVersion[];
  /** Hours to 100%: Tralked players who completed it, else IGDB (see `TimeTo100`). */
  timeTo100: TimeTo100 | null;
  /**
   * What a 100% on the main platform would give a new character (logged-out preview of "O que
   * este jogo deu ao seu personagem"), from the game's own achievements; null without any.
   */
  sample: GameAttributes | null;
  /** IGDB times to beat (minutes): rushed, main story, 100%; null when IGDB has none. */
  timesToBeat: { hastyMin: number | null; normalMin: number | null; completeMin: number | null } | null;
  /** Steam user reviews (all languages); null when not read yet or none. */
  steamReviews: { positive: number; total: number } | null;
  /** Published guide only. */
  guide: { missables: number } | null;
  videos: GameVideo[];
  shots: GameShot[];
  news: {
    wire: WireItem[];
    tabs: NewsTab[];
    mostRead: StoryCard[];
    count: number;
    /** While the game has no stories of its own: the newest ones about its studio's other games. */
    studio: { name: string; stories: StoryCard[] } | null;
  };
  gallery: { photos: PhotoCardView[]; total: number };
  similar: SimilarGame[];
};

/** Only https URLs (or same-site paths) reach `src`/`href`: no mixed content, no other schemes. */
export function safeMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  // Browsers strip tabs/newlines and read "\" as "/": refuse them anywhere rather than guess.
  // Control characters (U+0000..U+001F, U+007F), spaces and backslashes.
  if (/[\x00-\x20\x7f\\]/.test(url)) return null;
  // A same-site path; "//host" is read by browsers as another host.
  if (url.startsWith("/")) return url[1] === "/" ? null : url;
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
/** Genre skills, most specific first (lib/engine/genres): the first one is the game's genre. */
const genresOf = (skills: SkillId[]) => orderedGenres(skills);

// ---------- The game's numbers (one source for the ficha, the disc, the trophy grid, the guide) ----------

/** One platform's achievements in the catalog, with its trophies by tier. */
export type CatalogPlatform = {
  platform: PlatformId;
  total: number;
  /**
   * Its trophies by tier: native tier (PSN), else from the global rarity, an unknown rarity
   * counting as bronze (as the engine does). Gold + silver + bronze (+ a native platinum) add up
   * to `total`; on a platform without a native platinum, the 100% itself is its one platinum.
   */
  tiers: TierCounts;
  /** The platform has a platinum trophy of its own (PSN), counted in `total`. */
  nativePlatinum: boolean;
  /** Achievements unlocked by at most 3% of players (rarity "lendária"). */
  legendary: number;
};

type AchievementRow = { platform: string; globalPct: number | null; trophyTier: string | null };

/**
 * Per-platform achievements of a game, in PLATFORM_ORDER. Steam's total is the catalog count (its
 * rows may be partial: the missing ones have no known rarity, so they count as bronze).
 */
export function catalogPlatforms(rows: AchievementRow[], steamCount: number): CatalogPlatform[] {
  const out: CatalogPlatform[] = [];
  for (const platform of PLATFORM_ORDER) {
    const mine = rows.filter((r) => r.platform === platform);
    const total = achievementTotal(platform, steamCount, mine.length);
    if (total === 0) continue;
    const tiers = emptyTiers();
    for (const row of mine) tiers[tierOf(row)]++;
    // Rows Steam no longer lists (more rows than its count) come off the commonest tiers, so the
    // tiers always add up to `total`.
    let extra = mine.length - total;
    for (const tier of ["bronze", "silver", "gold"] as const) {
      const cut = Math.min(Math.max(0, extra), tiers[tier]);
      tiers[tier] -= cut;
      extra -= cut;
    }
    tiers.bronze += Math.max(0, total - mine.length);
    const nativePlatinum = tiers.platinum > 0;
    // Without a native platinum, the 100% is worth the Tralked platinum: shown apart ("+1"),
    // never added to the platform's achievements.
    if (!nativePlatinum) tiers.platinum = 1;
    out.push({
      platform,
      total,
      tiers,
      nativePlatinum,
      legendary: mine.filter((r) => r.globalPct !== null && rarityTier(r.globalPct) === "lendaria").length,
    });
  }
  return out;
}

/** The headline platform: Steam when it has achievements, else the first one (null: none). */
export function mainPlatform(list: CatalogPlatform[]): CatalogPlatform | null {
  return list.find((p) => p.platform === "steam") ?? list[0] ?? null;
}

export { timeTo100Label, type TimeTo100 } from "./time-to-100";

/**
 * What a 100% on `main` would give a character starting from scratch, by the same formulas as the
 * attribute recompute: XP of its achievements plus the platinum bonus, Vigor from the time to 100%,
 * Precisão from its rare ones, Glória from its trophies, Coleção for the 100%, and the levels of
 * its genre. Rows of other platforms are ignored; a Steam total larger than its rows counts the
 * missing ones at an unknown rarity.
 */
export function completionSample(
  main: CatalogPlatform | null,
  rows: AchievementRow[],
  minutes: number | null,
  genre: SkillId | null,
  /** Skills of the game sharing each achievement's points (as the recompute splits them). */
  skillCount = 1,
): GameAttributes | null {
  if (!main) return null;
  const mine = rows.filter((r) => r.platform === main.platform);
  const pcts = [...mine.map((r) => r.globalPct), ...Array.from({ length: main.total - mine.length }, () => null)];
  const xps = pcts.map((p) => xpForAchievement(p));
  const xp = xps.reduce((acc, v) => acc + v, 0) + platinumBonus(xps);
  const tiersList: TrophyTier[] = (["platinum", "gold", "silver", "bronze"] as const).flatMap((t) =>
    Array.from({ length: main.tiers[t] }, () => t),
  );
  let skill: GameAttributes["skill"] = null;
  if (genre) {
    const points = xps.reduce((acc, v) => acc + skillPointsFor(v, Math.max(1, skillCount)), 0);
    const { state, levelsGained } = applySkillPoints({ level: 1, points: 0 }, points);
    skill = { id: genre, name: skillName(genre), level: state.level, levelsFromGame: levelsGained };
  }
  return {
    xp,
    hours: minutes ? Math.max(1, Math.round(minutes / 60)) : 0,
    vigor: minutes ? vigorPoints([minutes]) : 0,
    precisao: precisaoPoints(pcts.map((globalPct) => ({ globalPct, hardcore: false }))),
    rareCount: pcts.filter((p) => p !== null && p <= 5).length,
    gloria: gloriaPoints(tiersList),
    colecao: colecaoPoints(1),
    completed: true,
    skill,
  };
}

const VIDEO_SOURCE: Record<string, string> = {
  steam: "Steam",
  igdb: "YouTube via IGDB",
  rawg: "RAWG",
  sgdb: "SteamGridDB",
  fixture: "Tralked",
};

type MediaRow = {
  id: string;
  kind: string;
  url: string | null;
  youtubeId: string | null;
  source: string;
  order: number;
  /** Videos: the source's title, when stored. */
  title?: string | null;
};

const STEAM_MOVIE = /^https:\/\/[a-z0-9.-]+\.steamstatic\.com\/(?:store_trailers|steam\/apps)\/(\d+)\/movie[\w.]*\.(?:mp4|webm)(?:\?|$)/;

/** Movie id of a Steam trailer file (`…/store_trailers/<id>/movie_max.mp4`, `…/steam/apps/<id>/movie480.mp4`). */
export function steamMovieId(url: string): string | null {
  return STEAM_MOVIE.exec(url)?.[1] ?? null;
}

/** The store's own still of a Steam trailer, at its unhashed path (the one the store page lists). */
export const steamMovieThumbnail = (movieId: string) =>
  `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${movieId}/movie.293x165.jpg`;

export const youtubeThumbnail = (youtubeId: string) => `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`;

/**
 * Playable videos only: an https file or a valid YouTube id. Fixture rows without either are
 * skipped. Each video gets its own thumbnail: Steam's still of that trailer, YouTube's, or else a
 * different screenshot per video (`stills`), never one picture repeated on every tile.
 */
export function playableVideos(rows: MediaRow[], stills: string[] = []): GameVideo[] {
  const videos: GameVideo[] = [];
  let spare = 0;
  for (const row of rows) {
    if (row.kind !== "video") continue;
    // The source's own title ("Launch Trailer", "Gameplay"); else "Trailer", "Trailer 2"…
    const title = row.title?.trim() || (videos.length === 0 ? "Trailer" : `Trailer ${videos.length + 1}`);
    const source = VIDEO_SOURCE[row.source] ?? row.source;
    const url = safeMediaUrl(row.url);
    if (url) {
      const movie = steamMovieId(url);
      const thumbnail = movie ? steamMovieThumbnail(movie) : (stills[spare++] ?? null);
      videos.push({ id: row.id, kind: "file", url, thumbnail, title, source });
    } else if (row.youtubeId && YOUTUBE_ID.test(row.youtubeId)) {
      videos.push({ id: row.id, kind: "youtube", youtubeId: row.youtubeId, thumbnail: youtubeThumbnail(row.youtubeId), title, source });
    }
  }
  return videos;
}

/** Disc label art (see `DiscLabelArt`): never the cover nor the hero. */
export function discLabelArt(
  rows: MediaRow[],
  art: { cover: string | null; hero: string | null; logo: string | null },
): DiscLabelArt {
  const banned = new Set([art.cover, art.hero].filter((u): u is string => u !== null));
  const shot = rows
    .filter((m) => m.kind === "screenshot")
    .sort((a, b) => a.order - b.order)
    .map((m) => safeMediaUrl(m.url))
    .find((u): u is string => u !== null && !banned.has(u));
  if (shot) return { kind: "shot", url: shot };
  if (art.logo && !banned.has(art.logo)) return { kind: "logo", url: art.logo, tintFrom: art.cover ?? art.hero };
  return { kind: "generated" };
}

/** The booklet's background loop: a stored trailer file first (Steam's 480p, then full size), else YouTube. */
export function backdropVideo(rows: MediaRow[]): BackdropVideo {
  const videos = rows.filter((m) => m.kind === "video").sort((a, b) => a.order - b.order);
  for (const row of videos) {
    const url = safeMediaUrl(row.url);
    if (!url) continue;
    const movie = steamMovieId(url);
    const light = movie ? url.replace(/movie_max\.mp4(?=\?|$)/, "movie480.mp4") : url;
    return { kind: "file", sources: light === url ? [url] : [light, url], poster: movie ? steamMovieThumbnail(movie) : null };
  }
  const youtube = videos.find((m) => m.youtubeId && YOUTUBE_ID.test(m.youtubeId));
  return youtube?.youtubeId ? { kind: "youtube", youtubeId: youtube.youtubeId } : null;
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
  const images = {
    cover: firstUrl("cover") ?? safeMediaUrl(game.coverUrl),
    hero: firstUrl("hero") ?? safeMediaUrl(game.heroUrl),
    logo: firstUrl("logo") ?? safeMediaUrl(game.logoUrl),
  };
  const art = { ...images, disc: discLabelArt(game.media, images) };
  const hues = artHues(slug, slug);

  const [achievementRows, versions, timeTo100, articles, external, gallery, similar] = await Promise.all([
    prisma.achievement.findMany({
      where: { gameId: game.id },
      select: { platform: true, globalPct: true, trophyTier: true },
    }),
    getGameVersions(game.id),
    loadTimeTo100(game.id, game.timeToBeatCompleteMin),
    getArticlesForGame(game.id, 12),
    getExternalHeadlines(8, [slug]),
    listPhotos({ gameSlug: slug, page: 1 }),
    loadSimilar(game.id, skills),
  ]);

  // Per-platform totals and tiers: Steam uses the catalog count (its rows may be partial).
  const byPlatform = catalogPlatforms(achievementRows, game.achievementCount);
  const main = mainPlatform(byPlatform);
  const genres = genresOf(skills);
  const sample = completionSample(
    main,
    achievementRows,
    timeTo100?.minutes ?? game.timeToBeatNormalMin ?? null,
    genres[0] ?? null,
    genres.length,
  );

  // Most viewed first (lifetime views: a game has few articles), then reader reactions, then newest.
  const mostRead = [...articles]
    .sort(
      (a, b) =>
        b.views - a.views ||
        b.likes + b.comments - (a.likes + a.comments) ||
        b.publishedAt.getTime() - a.publishedAt.getTime(),
    )
    .slice(0, 5)
    .map((a) => articleStory(a, now));

  const studioName = game.developer ?? game.publisher;
  const studioArticles =
    articles.length + external.length === 0 && studioName ? await getArticlesForStudio(studioName, game.id, 4) : [];

  const imageRows = game.media.filter((m) => m.kind === "screenshot" || m.kind === "artwork");
  // Generated illustrations stand in only for a game without any real image (seed fixtures);
  // once a sync brings real ones, the placeholders no longer mix with them.
  const hasRealImage = imageRows.some((m) => safeMediaUrl(m.url) !== null);
  const shots: GameShot[] = imageRows
    .filter((m) => !hasRealImage || safeMediaUrl(m.url) !== null)
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
    genres: genres.map(skillName),
    art,
    hues,
    seed: hashSeed(slug),
    achievements: { steam: game.achievementCount, byPlatform, main },
    versions,
    timeTo100,
    sample,
    timesToBeat:
      game.timeToBeatHastyMin || game.timeToBeatNormalMin || game.timeToBeatCompleteMin
        ? {
            hastyMin: game.timeToBeatHastyMin,
            normalMin: game.timeToBeatNormalMin,
            completeMin: game.timeToBeatCompleteMin,
          }
        : null,
    steamReviews:
      game.steamReviewTotal && game.steamReviewPositive !== null
        ? { positive: game.steamReviewPositive, total: game.steamReviewTotal }
        : null,
    guide: game.guide?.status === "published" ? { missables: game.guide.missables } : null,
    // Videos without a still of their own take a screenshot each, from the end of the list (the
    // first ones are the disc label and the start of "Imagens oficiais").
    videos: playableVideos(
      game.media,
      shots.flatMap((s) => (s.url ? [s.url] : [])).reverse(),
    ),
    shots,
    backdrop: backdropVideo(game.media),
    news: {
      wire: buildWireItems(articles, external, now, 10),
      tabs: buildGameNewsTabs(articles, external, now, art.hero),
      mostRead,
      count: articles.length + external.length,
      studio:
        studioName && studioArticles.length > 0
          ? { name: studioName, stories: studioArticles.map((a) => articleStory(a, now)) }
          : null,
    },
    gallery: { photos: gallery.photos.slice(0, 9), total: gallery.total },
    similar,
  };
}

/** At most this many games sharing a genre are ranked for "Na mesma estante". */
const SIMILAR_CANDIDATES = 60;

async function loadSimilar(gameId: string, skills: SkillId[]): Promise<SimilarGame[]> {
  const genres = genresOf(skills);
  if (genres.length === 0) return [];
  // Capped candidate set (the most played games sharing a genre), so the query does not grow
  // with the catalog; the Jaccard ranking then picks the 10 closest among them.
  const rows = await prisma.game.findMany({
    where: { id: { not: gameId }, skills: { some: { skill: { in: genres } } } },
    orderBy: [{ users: { _count: "desc" } }, { slug: "asc" }],
    take: SIMILAR_CANDIDATES,
    select: {
      slug: true,
      name: true,
      coverUrl: true,
      heroUrl: true,
      steamAppId: true,
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
    steamAppId: r.steamAppId,
    heroUrl: safeMediaUrl(r.heroUrl),
    hues: artHues(r.slug, r.slug),
    seed: hashSeed(r.slug),
    genre: skillName(genresOf(r.skills).find((s) => genres.includes(s)) ?? r.skills[0]),
    match: r.match,
  }));
}

/**
 * Cached public profile: tagged with the game, the news and the gallery so their updates show. The
 * versions (trophy lists and their trophies) are the game's own rows, so `gameTag` covers them too
 * (the RA list read and the admin game edits expire it).
 */
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

export type PlatformTrophies = TierCounts & { platinumOf: number };

/** One platform's slice of a player's progress in a game (the game page's platform tabs). */
export type PlatformBreakdown = PlatformProgress & {
  /**
   * Trophies unlocked on that platform by tier (native tier, else from rarity). `platinum` is the
   * platform's own platinum trophy when it has one (PSN), else the 100% itself; `platinumOf` 1.
   */
  trophies: PlatformTrophies;
  /** The platinum trophy itself was unlocked (PSN): the badge reads "Platina" instead of "100%". */
  platinumTrophy: boolean;
};

/** Every platform together: achievements summed, trophies pooled (`platinumOf` = platforms). */
export type CombinedProgress = {
  unlocked: number;
  total: number;
  pct: number;
  /** 100% on every platform played. */
  completed: boolean;
  trophies: PlatformTrophies;
};

/**
 * Splits a player's progress in one game by platform: each platform's achievements and trophies
 * (same tier and platinum rules as the attribute recompute), and the combined view. `unlocks` are
 * the valid (non-suspicious) unlocks of the game; unlocks of a platform without a library row
 * only count in the combined trophies.
 */
export function splitByPlatform(
  platforms: PlatformProgress[],
  unlocks: { platform: string; tier: TrophyTier }[],
): { byPlatform: PlatformBreakdown[]; combined: CombinedProgress } {
  const pooled = emptyTiers();
  const tiersOf = new Map<string, TierCounts>();
  for (const u of unlocks) {
    pooled[u.tier]++;
    const tiers = tiersOf.get(u.platform) ?? emptyTiers();
    tiers[u.tier]++;
    tiersOf.set(u.platform, tiers);
  }
  const byPlatform = platforms.map((p): PlatformBreakdown => {
    const tiers = tiersOf.get(p.platform) ?? emptyTiers();
    const platinumTrophy = tiers.platinum > 0;
    // A 100% without a platinum trophy (Steam, Xbox, RA, small PSN games) counts as the platinum.
    const completionPlatinum = p.completed && !platinumTrophy ? 1 : 0;
    if (completionPlatinum) pooled.platinum++;
    return {
      ...p,
      trophies: { ...tiers, platinum: tiers.platinum + completionPlatinum, platinumOf: 1 },
      platinumTrophy,
    };
  });
  const unlocked = platforms.reduce((acc, p) => acc + p.unlocked, 0);
  const total = platforms.reduce((acc, p) => acc + p.total, 0);
  const completed = platforms.length > 0 && platforms.every((p) => p.completed);
  const raw = total > 0 ? Math.round((unlocked / total) * 100) : 0;
  return {
    byPlatform,
    combined: {
      unlocked,
      total,
      pct: completed ? 100 : Math.min(99, raw),
      completed,
      trophies: { ...pooled, platinumOf: platforms.length },
    },
  };
}

export type GameUserProfile = {
  opened: boolean;
  /** The player's versions of the game (rows under the disc, marks in the trophy tabs). */
  versions: PlayerVersion[];
  /** Null when the user never played the game on any linked platform. */
  progress: {
    platforms: PlatformProgress[];
    /** Headline platform: a completed one, else the highest completion. */
    best: PlatformProgress;
    /** Each platform with its own trophies, in PLATFORM_ORDER (tabs on the game page). */
    byPlatform: PlatformBreakdown[];
    /** All platforms together (the "Todas" tab). */
    combined: CombinedProgress;
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

  const [opened, userGames, totalsByPlatform, unlocks, membership, versions] = await Promise.all([
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
    getPlayerVersions(gameId, userId),
  ]);

  const totalOf = achievementTotals(game.achievementCount, totalsByPlatform);

  const platforms = userGames
    .map((ug) => platformProgress(ug, totalOf(ug.platform)))
    .sort((a, b) => PLATFORM_ORDER.indexOf(a.platform) - PLATFORM_ORDER.indexOf(b.platform));
  const best = bestProgress(platforms);
  const playtimeMin = platforms.reduce((acc, p) => acc + p.playtimeMin, 0);
  const completed = platforms.some((p) => p.completed);

  // Trophies by platform and pooled (same rules as the attribute recompute).
  const valid = unlocks.filter((u) => !u.suspicious);
  const split = splitByPlatform(
    platforms,
    valid.map((u) => ({ platform: u.achievement.platform, tier: tierOf(u.achievement) })),
  );
  const completionPlatinums = split.byPlatform.filter((p) => p.completed && !p.platinumTrophy).length;

  // XP and skill points this game paid (voided entries never count).
  // Entries are keyed by any Achievement of the game (PSN: the canonical list's copy of a trophy,
  // which may not be the one the player unlocked) and platinums by gameId (Steam), the legacy
  // `${platform}:${gameId}` or any `<version>:${gameId}` (psn:<console>, <platform>:<externalId>).
  const gameAchievementIds = (await prisma.achievement.findMany({ where: { gameId }, select: { id: true } })).map((a) => a.id);
  const ledger = await prisma.xpLedgerEntry.findMany({
    where: {
      userId,
      voidedAt: null,
      OR: [
        { source: "achievement", sourceKey: { in: [...new Set([...gameAchievementIds, ...unlocks.map((u) => u.achievementId)])] } },
        {
          source: "platinum",
          OR: [
            { sourceKey: { in: PLATFORM_ORDER.map((p) => platinumSourceKey(p, gameId)) } },
            { sourceKey: { endsWith: `:${gameId}` } },
          ],
        },
        // Hours milestones of this game on every platform.
        {
          source: "playtime",
          sourceKey: {
            in: PLATFORM_ORDER.flatMap((p) => PLAYTIME_MILESTONES_H.map((h) => playtimeSourceKey(p, gameId, h))),
          },
        },
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
    versions,
    progress: best ? { platforms, best, byPlatform: split.byPlatform, combined: split.combined, playtimeMin, completed } : null,
    trophies: platforms.length > 0 ? split.combined.trophies : null,
    attributes,
    family: membership ? await familyPlayers(membership.familyId, userId, gameId, totalOf) : null,
  };
}

/** Achievements of the game on a platform (Steam: the catalog count when it has one). */
function achievementTotals(
  steamCount: number,
  totals: { platform: string; _count: { _all: number } }[],
): (platform: string) => number {
  return (platform) => achievementTotal(platform, steamCount, totals.find((t) => t.platform === platform)?._count._all ?? 0);
}

/** A player's progress in one game, by platform (the player's view of the game). */
export type PlayerGamePlatforms = {
  slug: string;
  name: string;
  byPlatform: PlatformBreakdown[];
  combined: CombinedProgress;
  /** The platform with the most progress (bestProgress). */
  best: PlatformId;
  /** The same progress by version (a PSN console, an Xbox title, ...); only when asked for. */
  versions?: PlayerVersion[];
};

/**
 * `userId`'s progress in the game `slug` split by platform; null when the game is unknown or the
 * player has it on no platform. The caller checks that the profile may be seen.
 */
export async function getPlayerGamePlatforms(
  slug: string,
  userId: string,
  /** `versions`: also the progress by version (an extra read; the conquistas page does without). */
  opts: { versions?: boolean } = {},
): Promise<PlayerGamePlatforms | null> {
  const game = await prisma.game.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true, achievementCount: true },
  });
  if (!game) return null;
  const [userGames, totals, unlocks, versions] = await Promise.all([
    prisma.userGame.findMany({ where: { userId, gameId: game.id } }),
    prisma.achievement.groupBy({ by: ["platform"], where: { gameId: game.id }, _count: { _all: true } }),
    prisma.userAchievement.findMany({
      where: { userId, suspicious: false, achievement: { gameId: game.id } },
      select: { achievement: { select: { platform: true, globalPct: true, trophyTier: true } } },
    }),
    opts.versions ? getPlayerVersions(game.id, userId) : null,
  ]);
  const totalOf = achievementTotals(game.achievementCount, totals);
  const platforms = userGames
    .map((ug) => platformProgress(ug, totalOf(ug.platform)))
    .sort((a, b) => PLATFORM_ORDER.indexOf(a.platform) - PLATFORM_ORDER.indexOf(b.platform));
  const best = bestProgress(platforms);
  if (!best) return null;
  const split = splitByPlatform(
    platforms,
    unlocks.map((u) => ({ platform: u.achievement.platform, tier: tierOf(u.achievement) })),
  );
  return { slug: game.slug, name: game.name, ...split, best: best.platform, ...(versions ? { versions } : {}) };
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
