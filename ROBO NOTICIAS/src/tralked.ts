/**
 * HTTP client for the Tralked bot API (`/api/v1/*`). The robot talks to the site only through here.
 * The types below mirror the site's shapes (app/src/lib/api/*); keep them in step with docs/robos.md.
 */

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

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
  | { type: "image"; url: string; alt: string; credit: string }
  | { type: "video"; youtubeId: string }
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

export type ApiIssue = { path: string; message: string };

export class TralkedError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues: ApiIssue[];

  constructor(status: number, code: string, message: string, issues: ApiIssue[] = []) {
    super(message);
    this.name = "TralkedError";
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

export type GameHit = { slug: string; name: string };

export type Tralked = {
  findGame(name: string): Promise<GameHit | null>;
  insights(slug: string): Promise<Insights | null>;
  dossier(slug: string): Promise<Dossier | null>;
  recentArticles(since: Date): Promise<FeedArticle[]>;
  createArticle(payload: ArticlePayload, idempotencyKey: string): Promise<{ id: string; url: string; slug: string }>;
  patchArticle(id: string, patch: ArticlePatch, idempotencyKey: string): Promise<void>;
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

const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1_000;
const RETRY_AFTER_CAP_MS = 120_000;
const REQUEST_TIMEOUT_MS = 30_000;
/** The site refuses `q` shorter than this. */
const MIN_QUERY_LENGTH = 2;
/** `GET /api/v1/articles` page size: a feed of exactly this many articles may be cut. */
export const FEED_LIMIT = 200;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** `Retry-After` as milliseconds (delta-seconds or HTTP date), or null when absent or unreadable. */
function retryAfterMs(header: string | null): number | null {
  if (header === null) return null;
  const value = header.trim();
  if (/^\d+(\.\d+)?$/.test(value)) return Math.min(Number(value) * 1000, RETRY_AFTER_CAP_MS);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.min(Math.max(date - Date.now(), 0), RETRY_AFTER_CAP_MS);
}

const isRetryableStatus = (status: number) => status === 429 || status >= 500;

async function errorFrom(response: Response): Promise<TralkedError> {
  let code = "unknown";
  let message = `HTTP ${response.status}`;
  let issues: ApiIssue[] = [];
  try {
    const parsed = (await response.json()) as { error?: { code?: string; message?: string; issues?: ApiIssue[] } };
    if (parsed.error) {
      code = parsed.error.code ?? code;
      message = parsed.error.message ?? message;
      issues = Array.isArray(parsed.error.issues) ? parsed.error.issues : [];
    }
  } catch {
    // Not a JSON error body (a proxy page, say): keep the status only.
  }
  return new TralkedError(response.status, code, message, issues);
}

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

/** The story id out of a creation key (`robo-<mode>-story-<id>`); the whole key when it differs. */
function storyIdOf(idempotencyKey: string): string {
  return /-story-(.+)$/.exec(idempotencyKey)?.[1] ?? idempotencyKey;
}

function lastPathSegment(url: string): string {
  const path = url.split(/[?#]/)[0] ?? url;
  return path.replace(/\/+$/, "").split("/").pop() ?? "";
}

// ---------------------------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------------------------

export function createTralked(options: { baseUrl: string; key: string; fetchFn?: typeof fetch }): Tralked {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const fetchFn = options.fetchFn ?? fetch;

  /** One logical request: 429, 5xx and network failures are retried; other failures throw. */
  async function call(method: string, path: string, init: { body?: unknown; idempotencyKey?: string } = {}) {
    const headers: Record<string, string> = { Authorization: `Bearer ${options.key}`, Accept: "application/json" };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    if (init.idempotencyKey !== undefined) headers["Idempotency-Key"] = init.idempotencyKey;

    for (let attempt = 0; ; attempt++) {
      let response: Response | null = null;
      let failure: unknown = null;
      try {
        response = await fetchFn(`${baseUrl}${path}`, {
          method,
          headers,
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        failure = error;
      }

      if (response?.ok) return response;
      const retryable = response === null || isRetryableStatus(response.status);
      if (!retryable || attempt >= MAX_RETRIES) {
        if (response === null) {
          const reason = failure instanceof Error ? failure.message : String(failure);
          throw new TralkedError(0, "network_error", `Falha de rede em ${method} ${path}: ${reason}`);
        }
        throw await errorFrom(response);
      }
      const wait = (response && retryAfterMs(response.headers.get("Retry-After"))) ?? BACKOFF_BASE_MS * 2 ** attempt;
      await sleep(wait);
    }
  }

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
      const wanted = query.toLowerCase();
      const hit =
        result.games.find(
          (game) => game.name.toLowerCase() === wanted || (game.aliases ?? []).some((a) => a.toLowerCase() === wanted),
        ) ?? result.games[0];
      return hit ? { slug: hit.slug, name: hit.name } : null;
    },

    insights: (slug) => getOrNull<Insights>(`/api/v1/games/${encodeURIComponent(slug)}/insights`),

    dossier: (slug) => getOrNull<Dossier>(`/api/v1/games/${encodeURIComponent(slug)}/dossie`),

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
  };
}
