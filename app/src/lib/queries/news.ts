import { artAssets, pickArt, type ArtAsset } from "@/lib/art/frame";
import { prisma } from "@/lib/db";
import {
  achievementKey,
  blocksExcerpt,
  clip,
  parseStoredBlocks,
  stripInline,
  type AchievementCardData,
  type AchievementPlatform,
  type ContentBlock,
} from "@/lib/content/schema";
import { isSafeHttpUrl, safeImageUrl } from "@/lib/content/url";
import { NEWS_FEED_AREA_LABEL, type NewsFeedArea } from "@/lib/news/areas";
import { namesGame, pressSourceName } from "@/lib/news/press";
import { mostViewedArticleIds } from "@/lib/news/views";
import { timeAgo } from "@/lib/time-ago";

import { companyArt, pickIndex, wideArt, withCompanyArt } from "./company-art";

// Plain, testable queries. Caching is applied by the calling components ("use cache").

/** Cache tags: every public news view uses NEWS_TAG; an article page also uses its own tag. */
export const NEWS_TAG = "news";
export const articleTag = (slug: string) => `article:${slug}`;

export type ArticleCategory = "GAMES" | "GUIAS" | "COMUNIDADE" | "MERCADO" | "ENTRETENIMENTO" | "TECNOLOGIA";
export type ArticlePlatform = "PC" | "PLAYSTATION" | "XBOX" | "NINTENDO";

export const CATEGORIES: { id: ArticleCategory; slug: string; label: string }[] = [
  { id: "GAMES", slug: "games", label: "Games" },
  { id: "GUIAS", slug: "guias", label: "Guias" },
  { id: "COMUNIDADE", slug: "comunidade", label: "Comunidade" },
  { id: "MERCADO", slug: "mercado", label: "Mercado" },
  { id: "ENTRETENIMENTO", slug: "entretenimento", label: "Entretenimento" },
  { id: "TECNOLOGIA", slug: "tecnologia", label: "Tecnologia" },
];

export const categoryLabel = (id: ArticleCategory) => CATEGORIES.find((c) => c.id === id)?.label ?? id;
export const categoryFromSlug = (slug: string | undefined): ArticleCategory | null =>
  CATEGORIES.find((c) => c.slug === slug)?.id ?? null;

export type ArticleCard = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  /** Card/metadata summary: `excerpt`, else subtitle, else the first paragraph of the body. */
  excerpt: string | null;
  category: ArticleCategory;
  platforms: ArticlePlatform[];
  imageLabel: string;
  /** First image block, else the related game's hero/cover. Null: cards draw generated art. */
  imageUrl: string | null;
  /**
   * Landscape art only (image block, game hero or screenshot, a company game's hero): what a wide
   * box such as the home headline may stretch. Null when the only art is a portrait cover.
   */
  wideImageUrl?: string | null;
  /**
   * The related game's images by kind and shape (lib/art/frame), when the article has no picture of
   * its own: each box then picks the one made for its shape instead of cropping `imageUrl`.
   */
  art?: ArtAsset[] | null;
  /** Game images already shown by stories above on the same page (`spreadArt`): skipped here. */
  artExclude?: string[];
  /** Without the leading "@". */
  authorHandle: string;
  /** How the byline reads: "@handle" for people, "Equipe Tralked" for bot articles. */
  authorLabel: string;
  /** Written by a robot through the API (Article.source = "bot"). */
  bot: boolean;
  /** 0 = list, 1 = side highlight, 2 = main highlight */
  featured: number;
  likes: number;
  comments: number;
  /** Lifetime counted views (Article.views). */
  views: number;
  humanAuthored: boolean;
  publishedAt: Date;
  /** First related game (kept for the Plan 1 cards). */
  game: { slug: string; name: string } | null;
};

export type RelatedGame = {
  slug: string;
  name: string;
  hasGuide: boolean;
  /** Catalog cover (Plan 4 F12). Null for games without art (stubs): show the name only. */
  coverUrl: string | null;
  /** Catalog platforms (PC, PLAYSTATION, XBOX, NINTENDO); absent on older cached cards. */
  platforms?: ArticlePlatform[];
  /** Achievements the catalog knows for the game (Steam count, else its achievement rows); 0 = none yet. */
  achievementCount?: number;
  /** The PlayStation list has a platinum trophy. */
  hasPlatinum?: boolean;
};

export type ExternalHeadline = {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: Date;
  game: { slug: string; name: string } | null;
  /** Wire only: real art of the linked game (hero or screenshot), when the catalog has any. */
  imageUrl?: string | null;
};

export type ArticleFull = ArticleCard & {
  /** Legacy Markdown, rendered when `blocks` is empty or invalid. */
  body: string;
  /** Validated ContentBlock[]; empty when the article only has the legacy body. */
  blocks: ContentBlock[];
  /** editorial | bot */
  source: string | null;
  /** An editor approved it (Article.reviewedAt): bot articles then read "revisado pela redação". */
  reviewed: boolean;
  /** Related game's hero/cover for the article header (null: generated art). */
  heroUrl: string | null;
  /** The related game's images for the 21:9 header (lib/art/frame), and the body's pictures to skip. */
  heroArt?: ArtAsset[] | null;
  heroExclude?: string[];
  game: RelatedGame | null;
  games: RelatedGame[];
  /** Resolved `achievement` blocks, keyed by `achievementKey(platform, apiName)`. */
  achievements: Record<string, AchievementCardData>;
  /** Headlines from external feeds about the related games. */
  externalNews: ExternalHeadline[];
};

export type HomeNews = {
  /** Null only when nothing is published at all. */
  hero: ArticleCard | null;
  side: ArticleCard[];
  latest: ArticleCard[];
};

export type NewsIndexPage = {
  articles: ArticleCard[];
  category: ArticleCategory | null;
  page: number;
  pageCount: number;
  total: number;
};

export type TopPlayer = { handle: string; displayName: string; avatarUrl: string | null; level: number; totalXp: number };

const PUBLISHED = { status: "published" } as const;

/**
 * A game's images for news boxes: its cover, wide art and first screenshots (articles of one game
 * take turns among them), with their sizes, so each box picks by its shape (lib/art/frame).
 */
const SCENE_MEDIA = {
  where: { kind: { in: ["cover", "capsule", "hero", "artwork", "screenshot"] }, url: { not: null } },
  orderBy: [{ kind: "asc" as const }, { order: "asc" as const }],
  take: 14,
  select: { url: true as const, kind: true as const, width: true as const, height: true as const },
};

const gameSelect = { slug: true, name: true, heroUrl: true, coverUrl: true, media: SCENE_MEDIA } as const;

const cardSelect = {
  id: true,
  slug: true,
  title: true,
  subtitle: true,
  excerpt: true,
  body: true,
  blocks: true,
  category: true,
  platforms: true,
  imageLabel: true,
  featured: true,
  likes: true,
  comments: true,
  views: true,
  humanAuthored: true,
  publishedAt: true,
  source: true,
  author: { select: { handle: true } },
  game: { select: gameSelect },
  games: { select: { game: { select: gameSelect } }, orderBy: { gameId: "asc" } },
} as const;

export type GameRow = {
  slug: string;
  name: string;
  heroUrl: string | null;
  coverUrl: string | null;
  media: { url: string | null; kind: string; width?: number | null; height?: number | null }[];
};

/**
 * Stories of one game in a row on a page each get a different picture: in page order, every card
 * claims the scene it would show (pickArt, `scene`), and the cards after it skip what was claimed
 * (`artExclude`; a card falls back to a claimed image only when its game has nothing else).
 */
export function spreadArt<T extends { slug: string; art?: ArtAsset[] | null }>(
  cards: T[],
): (T & { artExclude?: string[] })[] {
  const used: string[] = [];
  return cards.map((card): T & { artExclude?: string[] } => {
    if (!card.art?.length) return card;
    const claim = pickArt(card.art, 1.75, { mode: "scene", seed: card.slug, exclude: new Set(used) });
    const out = { ...card, artExclude: [...used] };
    if (claim) used.push(claim.url);
    return out;
  });
}

/** One image under two URLs: an IGDB size token or a Steam `?t=` version does not make it another. */
function imageKey(url: string): string {
  const igdb = url.match(/images\.igdb\.com\/igdb\/image\/upload\/t_[a-z0-9_]+\/([A-Za-z0-9]+)\./);
  return igdb ? `igdb:${igdb[1]}` : url.replace(/[?#].*$/, "");
}

/**
 * Art for a card whose article opens with `firstImageUrl`: the game's images when that picture is
 * one of them (the robot inserts the catalog's art after the lede), so the card still picks by its
 * shape; null when the article brings a picture of its own (shown as it is).
 */
export function cardArt(games: GameRow[], firstImageUrl: string | null): ArtAsset[] | null {
  const art = gamesArt(games);
  if (!firstImageUrl || !art) return art;
  const key = imageKey(firstImageUrl);
  const all = games.flatMap((g) => [g.coverUrl, g.heroUrl, ...g.media.map((m) => m.url)]);
  return all.some((url) => url && imageKey(url) === key) ? art : null;
}

/** The images of the first related game that has any (lib/art/frame), or null. */
export function gamesArt(games: GameRow[]): ArtAsset[] | null {
  for (const g of games) {
    const art = artAssets({ coverUrl: g.coverUrl, heroUrl: g.heroUrl, media: g.media });
    if (art.length > 0) return art;
  }
  return null;
}

/**
 * Wide art of an article's first game that has any: its hero or one of its screenshots, picked by
 * the article slug, so three stories of the same game do not all show the same image. Portrait
 * cover only when there is nothing wide. Images in `exclude` (already in the article body) are
 * skipped while another one is left, so the page does not show the same picture twice.
 */
export function gameScene(
  games: GameRow[],
  seed: string,
  exclude: ReadonlySet<string> = new Set(),
  { wideOnly = false }: { wideOnly?: boolean } = {},
): string | null {
  for (const g of games) {
    const all = [g.heroUrl, ...g.media.filter((m) => m.kind === "screenshot").map((m) => m.url)].filter(
      (url): url is string => Boolean(url && url.startsWith("https://")),
    );
    const fresh = all.filter((url) => !exclude.has(wideArt(url)) && !exclude.has(url));
    const wide = fresh.length > 0 ? fresh : all;
    if (wide.length > 0) return wideArt(wide[pickIndex(seed, wide.length)]);
    if (g.coverUrl && !wideOnly) return wideArt(g.coverUrl);
  }
  return null;
}

type CardRow = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  excerpt: string | null;
  body: string;
  blocks: unknown;
  category: string;
  platforms: string[];
  imageLabel: string;
  featured: number;
  likes: number;
  comments: number;
  views: number;
  humanAuthored: boolean;
  publishedAt: Date;
  source: string | null;
  author: { handle: string };
  game: GameRow | null;
  games: { game: GameRow }[];
};

/** Related games: ArticleGame links first, then the legacy single game if it is not among them. */
function relatedGames(row: Pick<CardRow, "game" | "games">): GameRow[] {
  const games = row.games.map((g) => g.game);
  if (row.game && !games.some((g) => g.slug === row.game!.slug)) games.push(row.game);
  return games;
}

/**
 * Public byline of robot articles (Lucas, 02/11/2026: the team's name, not "Robô Tralked"). What
 * tells them apart from articles people wrote is the "Autoria humana" badge, which robot articles
 * never get (Termos de uso, "Conteúdo de robôs"). The internal author handle stays "Robô <key name>".
 */
export const BOT_BYLINE = "Equipe Tralked";

/** Byline: robot articles are signed "Equipe Tralked"; people get the "@" of their handle. */
export function authorLabel(source: string | null, handle: string): string {
  return source === "bot" ? BOT_BYLINE : `@${handle}`;
}

/** First paragraph of a Markdown body, without markup. */
function markdownExcerpt(body: string, max = 180): string | null {
  const paragraph = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p && !/^(#|>|[-*]\s|\d+\.\s|-{3,})/.test(p));
  return paragraph ? clip(stripInline(paragraph.replace(/\n/g, " ")), max) : null;
}

function toCard(row: CardRow): ArticleCard {
  const blocks = parseStoredBlocks(row.blocks) ?? [];
  const games = relatedGames(row);
  const firstImage = blocks.find((b) => b.type === "image");
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle,
    excerpt: row.excerpt ?? row.subtitle ?? blocksExcerpt(blocks) ?? markdownExcerpt(row.body),
    category: row.category as ArticleCategory,
    platforms: row.platforms as ArticlePlatform[],
    imageLabel: row.imageLabel,
    imageUrl:
      (firstImage?.type === "image" ? firstImage.url : null) ??
      gameScene(games, row.slug) ??
      null,
    wideImageUrl:
      (firstImage?.type === "image" ? firstImage.url : null) ?? gameScene(games, row.slug, undefined, { wideOnly: true }),
    art: cardArt(games, firstImage?.type === "image" ? firstImage.url : null),
    authorHandle: row.author.handle,
    authorLabel: authorLabel(row.source, row.author.handle),
    bot: row.source === "bot",
    featured: row.featured,
    likes: row.likes,
    comments: row.comments,
    views: row.views,
    humanAuthored: row.humanAuthored,
    publishedAt: row.publishedAt,
    game: games[0] ? { slug: games[0].slug, name: games[0].name } : null,
  };
}

export async function getHomeNews(): Promise<HomeNews> {
  const [main, side, latest] = await Promise.all([
    prisma.article.findFirst({
      where: { ...PUBLISHED, featured: 2 },
      orderBy: { publishedAt: "desc" },
      select: cardSelect,
    }),
    // Highlights pool: the last week's articles (any level), ranked below by engagement and recency.
    prisma.article.findMany({
      where: { ...PUBLISHED, publishedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
      orderBy: { publishedAt: "desc" },
      take: 60,
      select: cardSelect,
    }),
    prisma.article.findMany({
      where: { ...PUBLISHED, featured: 0 },
      orderBy: { publishedAt: "desc" },
      take: 24,
      select: cardSelect,
    }),
  ]);
  // No main highlight (unfeatured or archived by the newsroom): the newest article takes its place.
  const hero = main ?? latest[0] ?? side[0] ?? null;
  // Four highlights next to the main one: the two with most engagement (likes, comments) of the
  // week, then the most recent ones.
  const pool = side.filter((a) => a.id !== hero?.id);
  const engagement = (a: (typeof pool)[number]) => a.likes * 3 + a.comments * 5;
  const picked = new Map<string, (typeof pool)[number]>();
  for (const a of [...pool].sort((x, y) => engagement(y) - engagement(x)).slice(0, 2)) {
    if (engagement(a) > 0) picked.set(a.id, a);
  }
  for (const a of pool) {
    if (picked.size >= 4) break;
    picked.set(a.id, a);
  }
  const [heroCards, sideCards, latestCards] = await Promise.all([
    withCompanyArt(hero ? [toCard(hero)] : []),
    withCompanyArt([...picked.values()].map(toCard)),
    withCompanyArt(latest.filter((a) => a.id !== hero?.id).map(toCard)),
  ]);
  return { hero: heroCards[0] ?? null, side: sideCards, latest: latestCards };
}

/** Latest published articles (any highlight level). */
export async function getLatestArticles(limit: number): Promise<ArticleCard[]> {
  const rows = await prisma.article.findMany({
    where: PUBLISHED,
    orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
    take: limit,
    select: cardSelect,
  });
  return withCompanyArt(rows.map(toCard));
}

/** Latest published articles about one game (ArticleGame links or the legacy single game). */
export async function getArticlesForGame(gameId: string, limit: number): Promise<ArticleCard[]> {
  const rows = await prisma.article.findMany({
    where: { ...PUBLISHED, OR: [{ gameId }, { games: { some: { gameId } } }] },
    orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
    take: limit,
    select: cardSelect,
  });
  return withCompanyArt(rows.map(toCard));
}

/**
 * Stories about other games of the same studio (the game page's fallback while a game has no news
 * of its own). One indexed query on the game links, newest first.
 */
export async function getArticlesForStudio(developer: string, excludeGameId: string, limit: number): Promise<ArticleCard[]> {
  const studio = { developer, id: { not: excludeGameId } };
  const rows = await prisma.article.findMany({
    where: { ...PUBLISHED, OR: [{ game: studio }, { games: { some: { game: studio } } }] },
    orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
    take: limit,
    select: cardSelect,
  });
  return withCompanyArt(rows.map(toCard));
}

/** "Mais lidas" by reader reactions (likes + comments): the fallback before there are views. */
export async function getMostRead(limit: number): Promise<ArticleCard[]> {
  const rows = await prisma.article.findMany({
    where: PUBLISHED,
    orderBy: [{ likes: "desc" }, { comments: "desc" }, { publishedAt: "desc" }],
    take: limit,
    select: cardSelect,
  });
  return withCompanyArt(rows.map(toCard));
}

/**
 * "Mais visualizadas": published articles by views in the last 7 local days (lib/news/views.ts),
 * most viewed first. Articles nobody opened in the window are left out.
 */
export async function getMostViewed(limit: number, now: Date = new Date()): Promise<ArticleCard[]> {
  const ranked = await mostViewedArticleIds(limit, now);
  if (ranked.length === 0) return [];
  const rows = await prisma.article.findMany({
    where: { ...PUBLISHED, id: { in: ranked.map((r) => r.articleId) } },
    select: cardSelect,
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = ranked.flatMap((r) => {
    const row = byId.get(r.articleId);
    return row ? [row] : [];
  });
  return withCompanyArt(ordered.map(toCard));
}

/** At least this many articles with views in the window before the home ranks by views. */
export const MOST_VIEWED_MIN = 3;

/**
 * The home's ranking: "Mais visualizadas" once enough articles have views this week; until then
 * (a new counter, a quiet week) "Mais lidas" by reactions, as before.
 */
export async function getHomeRanking(
  limit: number,
  now: Date = new Date(),
): Promise<{ title: string; articles: ArticleCard[] }> {
  const viewed = await getMostViewed(limit, now);
  if (viewed.length >= MOST_VIEWED_MIN) return { title: "Mais visualizadas", articles: viewed };
  return { title: "Mais lidas", articles: await getMostRead(limit) };
}

/**
 * Latest external headlines. Feed URLs are untrusted: only absolute http(s) links are returned
 * (prefix filter in SQL, then a real URL parse), so a `javascript:` or `data:` link never reaches a page.
 */
export async function getExternalHeadlines(limit: number, gameSlugs?: string[]): Promise<ExternalHeadline[]> {
  const rows = await prisma.externalNews.findMany({
    where: {
      ...(gameSlugs ? { game: { slug: { in: gameSlugs } } } : {}),
      OR: [{ url: { startsWith: "https://" } }, { url: { startsWith: "http://" } }],
    },
    orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
    take: limit,
    select: {
      id: true,
      title: true,
      url: true,
      source: true,
      publishedAt: true,
      game: { select: { slug: true, name: true } },
    },
  });
  return rows.filter((row) => isSafeHttpUrl(row.url));
}

/** Paginated index (`/noticias?categoria=&pagina=`). Out-of-range pages clamp to the last one. */
export async function getNewsIndex(input: {
  category: ArticleCategory | null;
  page: number;
  pageSize: number;
}): Promise<NewsIndexPage> {
  const where = input.category ? { ...PUBLISHED, category: input.category } : PUBLISHED;
  const total = await prisma.article.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / input.pageSize));
  const page = Math.min(Math.max(1, Math.floor(input.page) || 1), pageCount);
  const rows = await prisma.article.findMany({
    where,
    orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
    skip: (page - 1) * input.pageSize,
    take: input.pageSize,
    select: cardSelect,
  });
  return { articles: await withCompanyArt(rows.map(toCard)), category: input.category, page, pageCount, total };
}

/** A related game on the article page: art, guide, platforms and what there is to hunt. */
const articleGameSelect = {
  ...gameSelect,
  id: true,
  guide: { select: { status: true } },
  platforms: true,
  achievementCount: true,
  achievements: { where: { platform: "psn", trophyTier: "platinum" }, select: { id: true }, take: 1 },
  _count: { select: { achievements: true } },
} as const;

/** The first cover image of a game's media (Plan 4 F12: chips and cards of the article page). */
export async function getArticle(slug: string): Promise<ArticleFull | null> {
  const row = await prisma.article.findUnique({
    // Drafts, articles in review and archived ones are not public.
    where: { slug, ...PUBLISHED },
    select: {
      ...cardSelect,
      source: true,
      reviewedAt: true,
      game: { select: articleGameSelect },
      games: { select: { game: { select: articleGameSelect } }, orderBy: { gameId: "asc" } },
    },
  });
  if (!row) return null;

  const blocks = parseStoredBlocks(row.blocks) ?? [];
  const gameRows = relatedGames(row) as (GameRow & {
    id: string;
    guide: { status: string } | null;
    media: { url: string | null }[];
    platforms: string[];
    achievementCount: number;
    achievements: { id: string }[];
    _count: { achievements: number };
  })[];
  const games: RelatedGame[] = gameRows.map((g) => ({
    slug: g.slug,
    name: g.name,
    hasGuide: g.guide?.status === "published",
    // The catalog's cover art (as on the game page): media cover first, then Game.coverUrl.
    coverUrl: safeImageUrl(g.media.find((m) => m.kind === "cover")?.url) ?? safeImageUrl(g.coverUrl),
    platforms: g.platforms.filter((p): p is ArticlePlatform => ["PC", "PLAYSTATION", "XBOX", "NINTENDO"].includes(p)),
    achievementCount: g.achievementCount > 0 ? g.achievementCount : g._count.achievements,
    hasPlatinum: g.achievements.length > 0,
  }));

  const [achievements, externalNews] = await Promise.all([
    resolveAchievements(blocks, gameRows),
    games.length > 0 ? getExternalHeadlines(5, games.map((g) => g.slug)) : Promise.resolve([]),
  ]);

  return {
    ...toCard(row),
    body: row.body,
    blocks,
    source: row.source,
    reviewed: row.reviewedAt !== null,
    heroUrl:
      gameScene(gameRows, row.slug, new Set(blocks.flatMap((b) => (b.type === "image" ? [b.url] : [])))) ??
      (await companyArt(`${row.title} ${row.subtitle ?? ""}`)),
    heroArt: gamesArt(gameRows),
    heroExclude: blocks.flatMap((b) => (b.type === "image" ? [b.url] : [])),
    game: games[0] ?? null,
    games,
    achievements,
    externalNews,
  };
}

/** Looks up the `achievement` blocks among the related games' achievements (per platform). */
async function resolveAchievements(
  blocks: ContentBlock[],
  games: { id: string; name: string }[],
): Promise<Record<string, AchievementCardData>> {
  const refs = blocks.flatMap((b) => (b.type === "achievement" ? [b] : []));
  if (refs.length === 0 || games.length === 0) return {};
  const rows = await prisma.achievement.findMany({
    where: {
      gameId: { in: games.map((g) => g.id) },
      OR: refs.map((r) => ({ platform: r.platform, apiName: r.apiName })),
    },
    select: { apiName: true, platform: true, name: true, description: true, globalPct: true, gameId: true },
  });
  const out: Record<string, AchievementCardData> = {};
  for (const a of rows) {
    const key = achievementKey(a.platform as AchievementPlatform, a.apiName);
    // Several related games may share an apiName: the first related game wins.
    if (out[key]) continue;
    out[key] = {
      name: a.name,
      description: a.description,
      globalPct: a.globalPct,
      gameName: games.find((g) => g.id === a.gameId)?.name ?? "",
    };
  }
  return out;
}

/** How many article pages the build prerenders; older ones render on first request. */
export const PRERENDER_ARTICLES = 200;

/** Slugs of the most recent published articles (generateStaticParams), capped. */
export async function getAllArticleSlugs(limit = PRERENDER_ARTICLES): Promise<string[]> {
  const rows = await prisma.article.findMany({
    where: PUBLISHED,
    select: { slug: true },
    orderBy: [{ publishedAt: "desc" }, { slug: "asc" }],
    take: limit,
  });
  return rows.map((r) => r.slug);
}

export async function getTopPlayers(limit: number): Promise<TopPlayer[]> {
  const rows = await prisma.userStats.findMany({
    where: { user: { profilePublic: true } },
    orderBy: { totalXp: "desc" },
    take: limit,
    select: { totalXp: true, level: true, user: { select: { handle: true, displayName: true, avatarUrl: true } } },
  });
  return rows.map((r) => ({
    handle: r.user.handle,
    displayName: r.user.displayName,
    avatarUrl: r.user.avatarUrl,
    level: r.level,
    totalXp: r.totalXp,
  }));
}

// ---------- View models for the wire and the tabs (pure) ----------

export type Hues = [number, number];

export type WireVariant = "paper" | "block" | "newp" | "portrait" | "dark";

export type WireItem = {
  id: string;
  href: string;
  /** External link (ExternalNews): opens in a new tab with rel="noopener noreferrer". */
  external?: boolean;
  variant: WireVariant;
  kicker: string;
  title: string;
  source: string;
  when: string;
  imageUrl?: string | null;
  /** The article's game images (lib/art/frame), picked by the card's shape. */
  art?: ArtAsset[] | null;
  seed: number;
  hues?: Hues;
  /** `block` variant: short agenda rows. */
  items?: { label: string; date: string }[];
  /** `newp` variant: the thin two-line word ("novo////\nguia"). */
  thin?: string;
  /** `portrait` variant: the giant word over the art. */
  giant?: string;
  /** The title's language when it is not Portuguese (an English press headline). */
  lang?: "en";
};

export type StoryCard = {
  id: string;
  href: string;
  external?: boolean;
  kicker: string;
  title: string;
  excerpt?: string | null;
  source: string;
  when: string;
  imageUrl?: string | null;
  /** The article's game images (lib/art/frame), picked by the card's shape. */
  art?: ArtAsset[] | null;
  /** Images stories above already show (`spreadArt`). */
  artExclude?: string[];
  seed: number;
  hues?: Hues;
};

export type NewsTab = { id: string; label: string; stories: StoryCard[]; moreHref?: string };

/** Palettes from the approved preview, by game slug. */
const GAME_HUES: Record<string, Hues> = {
  "hollow-knight": [218, 250],
  celeste: [318, 268],
  "ori-and-the-will-of-the-wisps": [188, 150],
  "dead-cells": [8, 340],
  hades: [352, 22],
  "elden-ring": [42, 18],
  blasphemous: [0, 30],
  "hollow-knight-silksong": [345, 300],
};

/** Stable 32-bit hash (FNV-1a) used as the art seed. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function artHues(gameSlug: string | null | undefined, fallbackKey: string): Hues {
  if (gameSlug && GAME_HUES[gameSlug]) return GAME_HUES[gameSlug];
  const h1 = hashSeed(gameSlug ?? fallbackKey) % 360;
  return [h1, (h1 + 32) % 360];
}

const NEWP_WORDS: Record<ArticleCategory | "EXTERNAL", string> = {
  GAMES: "nova////\nnotícia",
  GUIAS: "novo////\nguia",
  COMUNIDADE: "da////\ncomunidade",
  MERCADO: "do////\nmercado",
  ENTRETENIMENTO: "de////\nentretenimento",
  TECNOLOGIA: "de////\ntecnologia",
  EXTERNAL: "na////\nimprensa",
};

const EDITORIAL_SOURCE = "Redação Tralked";
const externalSource = (source: string) => `Fonte externa: ${pressSourceName(source)}`;

const SHORT_DATE = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  timeZone: "America/Sao_Paulo",
});
const shortDate = (date: Date) => SHORT_DATE.format(date).replace(" de ", " ").replace(".", "");

export function articleStory(article: ArticleCard, now: Date): StoryCard {
  return {
    id: article.id,
    href: `/noticias/${article.slug}`,
    kicker: categoryLabel(article.category),
    title: article.title,
    excerpt: article.excerpt,
    source: article.authorLabel,
    when: timeAgo(article.publishedAt, now),
    imageUrl: article.imageUrl,
    art: article.art ?? null,
    artExclude: article.artExclude,
    seed: hashSeed(article.slug),
    hues: artHues(article.game?.slug, article.slug),
  };
}

/** Variant rhythm of the approved preview (the `block` card is inserted separately). */
const VARIANT_CYCLE: WireVariant[] = ["paper", "newp", "portrait", "dark", "paper", "newp", "dark"];

/**
 * Wire items: editorial articles and external headlines merged by date, plus one `block`
 * "Guias da semana" card (second position) when there are at least two guides.
 */
export function buildWireItems(
  articles: ArticleCard[],
  external: ExternalHeadline[],
  now: Date,
  limit = 10,
): WireItem[] {
  type Entry = { at: Date; article?: ArticleCard; headline?: ExternalHeadline };
  const english = (e: Entry) => (e.headline && isEnglishHeadline(e.headline.title) ? 1 : 0);
  const entries: Entry[] = [
    ...articles.map((article) => ({ at: article.publishedAt, article })),
    // Untrusted feed URLs: drop anything that is not an absolute http(s) link. A press headline
    // without real art is left out: the wire never dresses someone else's story in generated art.
    ...external
      .filter((h) => isSafeHttpUrl(h.url) && Boolean(h.imageUrl))
      .map((headline) => ({ at: headline.publishedAt, headline })),
  ]
    // Portuguese first (English headlines only fill the rest), newest first within each.
    .sort((a, b) => english(a) - english(b) || b.at.getTime() - a.at.getTime())
    .slice(0, limit);

  const items: WireItem[] = entries.map((entry, i) => {
    const variant = VARIANT_CYCLE[i % VARIANT_CYCLE.length];
    if (entry.article) {
      const a = entry.article;
      return {
        id: `a:${a.id}`,
        href: `/noticias/${a.slug}`,
        variant,
        kicker: categoryLabel(a.category),
        title: a.title,
        // A robot's article is credited to the robot, never to the newsroom.
        source: a.bot ? a.authorLabel : EDITORIAL_SOURCE,
        when: timeAgo(a.publishedAt, now),
        imageUrl: a.imageUrl,
        art: a.art ?? null,
        seed: hashSeed(a.slug),
        hues: artHues(a.game?.slug, a.slug),
        thin: NEWP_WORDS[a.category] ?? NEWP_WORDS.GAMES,
        giant: a.game?.name ?? categoryLabel(a.category),
      };
    }
    const h = entry.headline!;
    return {
      id: `x:${h.id}`,
      href: h.url,
      external: true,
      variant,
      kicker: h.game?.name ?? "Imprensa",
      title: h.title,
      lang: isEnglishHeadline(h.title) ? "en" : undefined,
      source: externalSource(h.source),
      when: timeAgo(h.publishedAt, now),
      imageUrl: h.imageUrl ?? null,
      seed: hashSeed(h.url),
      hues: artHues(h.game?.slug, h.url),
      thin: NEWP_WORDS.EXTERNAL,
      giant: h.game?.name ?? pressSourceName(h.source),
    };
  });

  const guides = articles.filter((a) => a.category === "GUIAS").slice(0, 2);
  if (guides.length === 2 && items.length >= 2) {
    items.splice(1, 0, {
      id: "block:guias",
      href: "/noticias?categoria=guias#todas",
      variant: "block",
      kicker: "Guias",
      title: "Guias da semana",
      source: EDITORIAL_SOURCE,
      when: "esta semana",
      seed: hashSeed("guias-da-semana"),
      items: guides.map((g) => ({ label: g.game?.name ?? clip(g.title, 36), date: shortDate(g.publishedAt) })),
    });
  }
  return items;
}

/** Tabs "Últimas" + one per category, each linking to its page of the index. */
export function buildNewsTabs(articles: ArticleCard[], now: Date): NewsTab[] {
  const stories = (list: ArticleCard[]) => list.map((a) => articleStory(a, now));
  return [
    { id: "ultimas", label: "Últimas", stories: stories(articles), moreHref: "/noticias#todas" },
    ...CATEGORIES.map((c) => ({
      id: c.slug,
      label: c.label,
      stories: stories(articles.filter((a) => a.category === c.id)),
      moreHref: `/noticias?categoria=${c.slug}#todas`,
    })),
  ];
}

// ---------- External headlines per area (Plan 4 F7) ----------

/** Areas whose external headlines join their category tab and archive filter. */
export const PRESS_AREAS = ["ENTRETENIMENTO", "TECNOLOGIA"] as const satisfies readonly NewsFeedArea[];
export type PressArea = (typeof PRESS_AREAS)[number];

export const isPressArea = (category: ArticleCategory | null): category is PressArea =>
  (PRESS_AREAS as readonly string[]).includes(category ?? "");

const headlineSelect = {
  id: true,
  title: true,
  url: true,
  source: true,
  publishedAt: true,
  game: { select: { slug: true, name: true } },
} as const;

/** Absolute https link (feed URLs are untrusted; plain http is not linked from the press lists). */
const isHttpsUrl = (url: string) => isSafeHttpUrl(url) && url.startsWith("https://");

/** Latest external headlines of one feed area, newest first. Only https links. */
export async function getAreaHeadlines(area: NewsFeedArea, limit: number): Promise<ExternalHeadline[]> {
  const rows = await prisma.externalNews.findMany({
    where: { area, url: { startsWith: "https://" } },
    orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
    take: limit,
    select: headlineSelect,
  });
  return rows.filter((row) => isHttpsUrl(row.url));
}

const EN_WORDS = new Set(
  "the of and to in for with is are on new its it's your from at how why what this that will gets reveals announced trailer update release releases launches coming first game games gameplay review".split(" "),
);
const PT_WORDS = new Set(
  "de do da dos das o os as e em no na nos nas para com um uma que ganha chega novo nova sobre mais pelo pela vai tem jogo jogos recebe anuncia revela lança confirma terá será".split(" "),
);

/**
 * Whether a headline reads as English (feeds mix Portuguese and English press). Accents count
 * for Portuguese; otherwise the common words of each language are counted, and a tie stays
 * Portuguese (a Portuguese headline is never pushed out by mistake).
 */
export function isEnglishHeadline(title: string): boolean {
  const text = title.toLowerCase();
  if (/[ãõçáéíóúâêôà]/.test(text)) return false;
  const words = text.split(/[^a-z']+/).filter(Boolean);
  let en = 0;
  let pt = 0;
  for (const w of words) {
    if (EN_WORDS.has(w)) en++;
    if (PT_WORDS.has(w)) pt++;
  }
  return en > pt;
}

const SAME_STORY_MS = 48 * 3_600_000;

/**
 * The wire's headlines: Portuguese first. An English headline about a game that a Portuguese
 * headline also covered within two days is left out (the Portuguese one tells it); the rest of
 * the English ones only fill the wire when there are not enough Portuguese headlines. Newest
 * first.
 */
export function pickWireHeadlines(rows: ExternalHeadline[], limit: number): ExternalHeadline[] {
  const pt = rows.filter((h) => !isEnglishHeadline(h.title));
  const told = (h: ExternalHeadline) =>
    h.game !== null &&
    pt.some((p) => p.game?.slug === h.game!.slug && Math.abs(p.publishedAt.getTime() - h.publishedAt.getTime()) <= SAME_STORY_MS);
  const en = rows.filter((h) => isEnglishHeadline(h.title) && !told(h));
  return [...pt.slice(0, limit), ...en.slice(0, Math.max(0, limit - pt.length))].sort(
    (a, b) => b.publishedAt.getTime() - a.publishedAt.getTime(),
  );
}

/**
 * Headlines for the "Em circulação" wire ("da imprensa de games"): the Games feeds, plus
 * Entretenimento/Tecnologia headlines only when they are linked to a catalog game. General tech
 * and entertainment news stays in its own tab. Same URL guard as getExternalHeadlines. Three
 * times `limit` are read so Portuguese headlines can be preferred (pickWireHeadlines), and a
 * headline about a catalog game carries that game's real art.
 */
export async function getWireHeadlines(limit: number): Promise<ExternalHeadline[]> {
  const rows = await prisma.externalNews.findMany({
    where: {
      AND: [
        { OR: [{ area: "GAMES" }, { gameId: { not: null } }] },
        { OR: [{ url: { startsWith: "https://" } }, { url: { startsWith: "http://" } }] },
      ],
    },
    orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
    // Only headlines with a catalog game's art make the wire: read enough to fill it.
    take: limit * 6,
    select: { ...headlineSelect, game: { select: { ...gameSelect, aliases: true } } },
  });
  const safe = rows
    .filter((row) => isSafeHttpUrl(row.url))
    .map(({ game, ...row }) => {
      // A one-word name is also an ordinary word: a link the old matcher made from one ("Attack!" in
      // "Attack on Titan") is not trusted unless the title names the game as written. No game name,
      // no art (and so no card).
      const oneWord = game !== null && !game.name.trim().includes(" ");
      const linked =
        game && (!oneWord || [game.name, ...game.aliases].some((name) => namesGame(row.title, name))) ? game : null;
      return {
        ...row,
        game: linked ? { slug: linked.slug, name: linked.name } : null,
        imageUrl: linked ? gameScene([linked], row.url) : null,
      };
    })
    .filter((row) => row.imageUrl);
  return pickWireHeadlines(safe, limit);
}

/** The latest headlines of every press area (Entretenimento, Tecnologia). */
export async function getPressHeadlines(limit: number): Promise<Record<PressArea, ExternalHeadline[]>> {
  const [ENTRETENIMENTO, TECNOLOGIA] = await Promise.all(PRESS_AREAS.map((area) => getAreaHeadlines(area, limit)));
  return { ENTRETENIMENTO, TECNOLOGIA };
}

/** Story card of an external headline: opens the source in a new tab and says where it is from. */
export function headlineStory(headline: ExternalHeadline, now: Date): StoryCard {
  return {
    id: `x:${headline.id}`,
    href: headline.url,
    external: true,
    kicker: headline.game ? `Imprensa · ${headline.game.name}` : "Imprensa",
    title: headline.title,
    excerpt: null,
    source: externalSource(headline.source),
    when: timeAgo(headline.publishedAt, now),
    imageUrl: null,
    seed: hashSeed(headline.url),
    hues: artHues(headline.game?.slug, headline.url),
  };
}

/**
 * Adds each press area's external headlines to its category tab, after the newsroom's own
 * stories (Tralked's articles lead; the press fills the tab). Unsafe links are dropped.
 */
export function withPressHeadlines(
  tabs: NewsTab[],
  press: Partial<Record<PressArea, ExternalHeadline[]>>,
  now: Date,
): NewsTab[] {
  return tabs.map((tab) => {
    const area = categoryFromSlug(tab.id);
    const headlines = area && isPressArea(area) ? (press[area] ?? []) : [];
    if (headlines.length === 0) return tab;
    const external = headlines.filter((h) => isSafeHttpUrl(h.url)).map((h) => headlineStory(h, now));
    return { ...tab, stories: [...tab.stories, ...external] };
  });
}

/** Label of a press area ("Entretenimento"), for headings. */
export const pressAreaLabel = (area: PressArea) => NEWS_FEED_AREA_LABEL[area];

/**
 * "Próxima matéria" at the end of an article: the story published right before it (reading on,
 * back in time), or the newest one when this is the oldest. Null with no other article.
 */
export async function getNextArticle(current: { id: string; publishedAt: Date }): Promise<ArticleCard | null> {
  const order = [{ publishedAt: "desc" as const }, { id: "asc" as const }];
  const older = await prisma.article.findFirst({
    where: { ...PUBLISHED, id: { not: current.id }, publishedAt: { lt: current.publishedAt } },
    orderBy: order,
    select: cardSelect,
  });
  const row =
    older ??
    (await prisma.article.findFirst({
      where: { ...PUBLISHED, id: { not: current.id } },
      orderBy: order,
      select: cardSelect,
    }));
  if (!row) return null;
  const [card] = await withCompanyArt([toCard(row)]);
  return card ?? null;
}
