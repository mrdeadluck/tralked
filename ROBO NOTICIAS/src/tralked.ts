/**
 * HTTP client for the Tralked bot API (`/api/v1/*`). The robot talks to the site only through here.
 * The types below mirror the site's shapes (app/src/lib/api/*); keep them in step with docs/robos.md.
 */

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

import { type ApiIssue, createCall, TralkedError } from "./tralked-http.js";

export { type ApiIssue, TralkedError };

export const ARTICLE_CATEGORIES = ["GAMES", "GUIAS", "COMUNIDADE", "MERCADO", "ENTRETENIMENTO", "TECNOLOGIA"] as const;
export const ARTICLE_PLATFORMS = ["PC", "PLAYSTATION", "XBOX", "NINTENDO"] as const;

export type ArticleCategory = (typeof ARTICLE_CATEGORIES)[number];
export type ArticlePlatform = (typeof ARTICLE_PLATFORMS)[number];
export type ArticleStatus = "review" | "published";
export type ArticlePatchStatus = ArticleStatus | "archived";

/** A game by exactly one of its ids. */
export type GameRef = { slug: string } | { steamAppId: number } | { igdbId: number };

/** The site's single content format (no HTML). Inline markup: **bold**, *italic*, [link](https://...). */
export type ContentBlock =
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; text: string; author?: string }
  | { type: "image"; url: string; alt: string; credit: string; creditUrl?: string }
  | { type: "video"; youtubeId: string; title?: string }
  | { type: "post"; network: "x"; url: string; authorName: string; authorHandle: string; text: string; postedAt?: string }
  | { type: "callout"; tone: "info" | "aviso" | "spoiler"; text: string }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "achievement"; apiName: string; platform?: "steam" | "psn" | "xbox" | "retro" }
  | { type: "divider" };

/** Body of `POST /api/v1/articles` (what the robot may send). */
export type ArticlePayload = {
  title: string;
  subtitle?: string;
  excerpt?: string;
  category: ArticleCategory;
  platforms?: ArticlePlatform[];
  games?: GameRef[];
  imageLabel?: string;
  blocks: ContentBlock[];
  status?: ArticleStatus;
  /** URL slug; the site generates it from the title when absent. */
  slug?: string;
  /** Backdated publication time: ISO 8601 with an offset, at most 120 days back (needs `publish`). */
  publishedAt?: string;
};

/** Body of `PATCH /api/v1/articles/{id}`: any subset of the fields (the slug cannot change). */
export type ArticlePatch = Partial<Omit<ArticlePayload, "slug" | "publishedAt" | "status">> & {
  status?: ArticlePatchStatus;
};

/** One item of `GET /api/v1/articles`. */
export type FeedArticle = {
  id: string;
  slug: string;
  title: string;
  category: string;
  publishedAt: string;
  source: "editorial" | "bot";
  /** Slugs of the games the article is about. */
  games: string[];
};

/** `GET /api/v1/games/{slug}/insights`. */
export type Insights = {
  game: {
    slug: string;
    name: string;
    releaseDate: string | null;
    platforms: string[];
    achievementCount: number;
    timeToBeatCompleteMin: number | null;
  };
  tralked: { players: number; avgPlaytimeMin: number | null };
  rarest: { platform: string; apiName: string; name: string; globalPct: number }[];
};

/** `GET /api/v1/games/{slug}/dossie`. */
export type Dossier = {
  game: {
    slug: string;
    name: string;
    steamAppId: number | null;
    summary: string | null;
    developer: string | null;
    publisher: string | null;
    releaseDate: string | null;
    platforms: string[];
    criticScore: number | null;
    timeToBeatCompleteMin: number | null;
    achievementCount: number;
  };
  tralked: { players: number; avgPlaytimeMin: number | null; completedPlayers: number };
  /** Every visible achievement, rarest first, unknown rarity last (at most 500). */
  achievements: { platform: string; apiName: string; name: string; description: string | null; globalPct: number | null }[];
};

/** `GET /api/v1/games/{slug}/media`: the catalog's wide images (https) and YouTube videos of a game. */
export type GameMedia = {
  game: { slug: string; name: string; developer: string | null; publisher: string | null };
  /** Hero first, then screenshots, then artworks. */
  images: { url: string; kind: "hero" | "screenshot" | "artwork"; width: number | null; height: number | null; source: string | null }[];
  /** The main trailer first. */
  videos: { youtubeId: string }[];
};

export type GameHit = { slug: string; name: string };

export type Tralked = {
  findGame(name: string): Promise<GameHit | null>;
  insights(slug: string): Promise<Insights | null>;
  dossier(slug: string): Promise<Dossier | null>;
  media(slug: string): Promise<GameMedia | null>;
  recentArticles(since: Date): Promise<FeedArticle[]>;
  createArticle(payload: ArticlePayload, idempotencyKey: string): Promise<{ id: string; url: string; slug: string }>;
  patchArticle(id: string, patch: ArticlePatch, idempotencyKey: string): Promise<void>;
  /** `POST /api/v1/media` (scope `media:write`): the site stores the image as WebP and returns its URL. */
  uploadImage(bytes: Uint8Array, contentType: "image/png" | "image/jpeg" | "image/webp", idempotencyKey: string): Promise<{ url: string }>;
};

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/** Same slugs as the site (`slugify` in app/src/lib/community/text.ts). */
export function slugify(title: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || "topico";
}

/** Idempotency key of an article's creation: one per story and mode. */
export const articleKey = (mode: string, storyId: string | number) => `robo-${mode}-story-${storyId}`;

/** Idempotency key of the n-th update of an article. */
export const updateKey = (articleId: string, n: number) => `robo-update-${articleId}-${n}`;

/** The site refuses `q` shorter than this. */
const MIN_QUERY_LENGTH = 2;
/** `GET /api/v1/articles` page size: a feed of exactly this many articles may be cut. */
export const FEED_LIMIT = 200;

/** Indexes of the games a 422 complains about, or null when any issue is about something else. */
function badGameIndexes(error: TralkedError): number[] | null {
  if (error.status !== 422 || error.issues.length === 0) return null;
  const indexes: number[] = [];
  for (const issue of error.issues) {
    const match = /^\/games\/(\d+)(?:\/|$)/.exec(issue.path);
    if (!match) return null;
    indexes.push(Number(match[1]));
  }
  return indexes;
}

/**
 * Indexes of the `image`/`video` blocks a 422 complains about, or null when any issue is about something
 * else. Media blocks are decoration added by code (catalog art, trailers): an article must never be lost
 * because the site refused one (a URL it does not take, a field an older site version does not know).
 */
function badMediaIndexes(error: TralkedError, blocks: ContentBlock[]): number[] | null {
  if (error.status !== 422 || error.issues.length === 0) return null;
  const indexes: number[] = [];
  for (const issue of error.issues) {
    const match = /^\/blocks\/(\d+)(?:\/|$)/.exec(issue.path);
    const index = match ? Number(match[1]) : -1;
    const type = blocks[index]?.type;
    if (type !== "image" && type !== "video") return null;
    indexes.push(index);
  }
  return indexes;
}

/**
 * The slug suffix out of a creation key: the story id of `robo-<mode>-story-<id>`, `pauta-<id>` for a
 * pauta (`robo-pauta-<mode>-<id>`), the whole key otherwise.
 */
function storyIdOf(idempotencyKey: string): string {
  const story = /-story-(.+)$/.exec(idempotencyKey)?.[1];
  if (story) return story;
  const pauta = /^robo-pauta-(?:live|backfill)-(.+)$/.exec(idempotencyKey)?.[1];
  return pauta ? `pauta-${pauta}` : idempotencyKey;
}

const ROMAN: Record<string, string> = { ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10" };

/** A game name compared loosely: accents, case, punctuation and roman numerals ("VI" = "6") do not count. */
export function gameNameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .map((w) => ROMAN[w] ?? w)
    .join(" ");
}

/**
 * The search hit that is exactly the game asked for: same name or alias, or the asked name without its
 * subtitle ("The Elder Scrolls VI: Sentinel" is "The Elder Scrolls VI"). Never the first hit by default:
 * another game of the series ("The Elder Scrolls III: Morrowind") is worse than no game.
 */
export function exactGame<G extends { name: string; aliases?: string[] }>(query: string, games: G[]): G | null {
  const full = gameNameKey(query);
  const colon = query.indexOf(":");
  const base = colon > 0 ? gameNameKey(query.slice(0, colon)) : "";
  const names = (g: G) => [g.name, ...(g.aliases ?? [])].map(gameNameKey);
  return games.find((g) => names(g).includes(full)) ?? (base ? games.find((g) => names(g).includes(base)) : undefined) ?? null;
}

function lastPathSegment(url: string): string {
  const path = url.split(/[?#]/)[0] ?? url;
  return path.replace(/\/+$/, "").split("/").pop() ?? "";
}

// ---------------------------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------------------------

export function createTralked(options: { baseUrl: string; key: string; fetchFn?: typeof fetch }): Tralked {
  const call = createCall(options);

  const json = async <T>(response: Response) => (await response.json()) as T;

  async function getOrNull<T>(path: string): Promise<T | null> {
    try {
      return await json<T>(await call("GET", path));
    } catch (error) {
      if (error instanceof TralkedError && error.status === 404) return null;
      throw error;
    }
  }

  /** POST once; on a repairable refusal, fix the payload and POST once more. */
  async function postArticle(payload: ArticlePayload, idempotencyKey: string): Promise<Response> {
    try {
      return await call("POST", "/api/v1/articles", { body: payload, idempotencyKey });
    } catch (error) {
      if (!(error instanceof TralkedError)) throw error;

      const badMedia = badMediaIndexes(error, payload.blocks);
      if (badMedia) {
        const blocks = payload.blocks.filter((_, index) => !badMedia.includes(index));
        return call("POST", "/api/v1/articles", { body: { ...payload, blocks }, idempotencyKey });
      }

      const bad = badGameIndexes(error);
      if (bad && payload.games) {
        const games = payload.games.filter((_, index) => !bad.includes(index));
        if (games.length < payload.games.length) {
          return call("POST", "/api/v1/articles", { body: { ...payload, games }, idempotencyKey });
        }
      }

      if (error.status === 409 && error.code === "slug_conflict") {
        const slug = `${slugify(payload.title)}-${storyIdOf(idempotencyKey)}`;
        return call("POST", "/api/v1/articles", { body: { ...payload, slug }, idempotencyKey });
      }
      throw error;
    }
  }

  return {
    async findGame(name) {
      const query = name.trim();
      if (query.length < MIN_QUERY_LENGTH) return null;
      const result = await json<{ games: { slug: string; name: string; aliases?: string[] }[] }>(
        await call("GET", `/api/v1/games?q=${encodeURIComponent(query)}`),
      );
      const hit = exactGame(query, result.games);
      return hit ? { slug: hit.slug, name: hit.name } : null;
    },

    insights: (slug) => getOrNull<Insights>(`/api/v1/games/${encodeURIComponent(slug)}/insights`),

    dossier: (slug) => getOrNull<Dossier>(`/api/v1/games/${encodeURIComponent(slug)}/dossie`),

    media: (slug) => getOrNull<GameMedia>(`/api/v1/games/${encodeURIComponent(slug)}/media`),

    async recentArticles(since) {
      // toISOString is always UTC with a Z: a "+hh:mm" offset would need %2B on the wire.
      const params = new URLSearchParams({ since: since.toISOString(), limit: String(FEED_LIMIT) });
      const result = await json<{ articles: FeedArticle[] }>(await call("GET", `/api/v1/articles?${params}`));
      return result.articles;
    },

    async createArticle(payload, idempotencyKey) {
      const created = await json<{ id: string; url: string }>(await postArticle(payload, idempotencyKey));
      return { id: created.id, url: created.url, slug: lastPathSegment(created.url) };
    },

    async patchArticle(id, patch, idempotencyKey) {
      await call("PATCH", `/api/v1/articles/${encodeURIComponent(id)}`, { body: patch, idempotencyKey });
    },

    async uploadImage(bytes, contentType, idempotencyKey) {
      return json<{ url: string }>(await call("POST", "/api/v1/media", { raw: { bytes, contentType }, idempotencyKey }));
    },
  };
}
