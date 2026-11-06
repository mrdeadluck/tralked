import { timeoutSignal } from "../http";
import { normalizeTitle } from "../title-match";
import type {
  IgdbCatalogApi,
  IgdbPlatformsApi,
  IgdbCatalogGame,
  IgdbCatalogPage,
  IgdbDatePrecision,
  IgdbReleaseDate,
} from "./catalog-types";
import type { IgdbApi, IgdbGame, IgdbMedia, IgdbTimeToBeat } from "./types";

const API_BASE = "https://api.igdb.com/v4";
const TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const STEAM_SOURCE = 1;
/** IGDB allows 4 requests per second. */
const MIN_INTERVAL_MS = 250;
const TOKEN_EXPIRY_MARGIN_MS = 60_000;
/** Back-off before the single retry of a request IGDB answered with 429. */
const RATE_LIMIT_RETRY_MS = 1_000;

/**
 * IGDB still answered 429 after one retry. Callers must not treat it as "no data": the game
 * sync fails and is retried later (its `lastSyncAttemptAt` rotates it to the back of the queue).
 */
export class IgdbRateLimitError extends Error {
  constructor(endpoint: string) {
    super(`IGDB ${endpoint} is rate limited (HTTP 429)`);
    this.name = "IgdbRateLimitError";
  }
}

export type IgdbClientConfig = {
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
  /** Injectable for tests. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

type Named = { name: string }[];

type GameRecord = {
  id: number;
  name: string;
  summary?: string;
  first_release_date?: number;
  aggregated_rating?: number;
  cover?: { image_id?: string };
  genres?: Named;
  themes?: Named;
  game_modes?: Named;
  player_perspectives?: Named;
  keywords?: Named;
};

const GAME_FIELDS = [
  "name",
  "summary",
  "first_release_date",
  "aggregated_rating",
  "cover.image_id",
  "genres.name",
  "themes.name",
  "game_modes.name",
  "player_perspectives.name",
  "keywords.name",
].join(",");

const names = (list?: Named) => (list ?? []).map((item) => item.name);

const SEARCH_LIMIT = 10;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

type ImageRecord = { image_id?: string; width?: number; height?: number };
type MediaRecord = {
  videos?: { video_id?: string; name?: string }[];
  screenshots?: ImageRecord[];
  artworks?: ImageRecord[];
};

const MEDIA_FIELDS = [
  "videos.video_id",
  "videos.name",
  "screenshots.image_id",
  "screenshots.width",
  "screenshots.height",
  "artworks.image_id",
  "artworks.width",
  "artworks.height",
].join(",");

export function createIgdbClient({
  clientId,
  clientSecret,
  fetch: fetchImpl = globalThis.fetch,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: IgdbClientConfig): IgdbApi & IgdbCatalogApi & IgdbPlatformsApi {
  let token: { value: string; expiresAt: number } | null = null;
  let lastStart = Number.NEGATIVE_INFINITY;
  // Serializes calls so concurrent callers still respect the rate limit.
  let queue: Promise<unknown> = Promise.resolve();

  async function getToken(): Promise<string> {
    if (token && now() < token.expiresAt) return token.value;
    const url = new URL(TOKEN_URL);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("client_secret", clientSecret);
    url.searchParams.set("grant_type", "client_credentials");
    const res = await fetchImpl(url.toString(), { method: "POST", signal: timeoutSignal() });
    if (!res.ok) throw new Error(`Twitch token request failed with HTTP ${res.status}`);
    const data = (await res.json()) as { access_token: string; expires_in: number };
    token = {
      value: data.access_token,
      expiresAt: now() + data.expires_in * 1000 - TOKEN_EXPIRY_MARGIN_MS,
    };
    return token.value;
  }

  async function throttle(): Promise<void> {
    const wait = lastStart + MIN_INTERVAL_MS - now();
    if (wait > 0) await sleep(wait);
    lastStart = now();
  }

  function query<T>(endpoint: string, body: string): Promise<T[]> {
    const send = async () => {
      const accessToken = await getToken();
      await throttle();
      return fetchImpl(`${API_BASE}/${endpoint}`, {
        method: "POST",
        headers: {
          "Client-ID": clientId,
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
        body,
        signal: timeoutSignal(),
      });
    };
    const run = async () => {
      let res = await send();
      if (res.status === 429) {
        // Still inside the queue, so the back-off also holds back every other caller.
        await sleep(RATE_LIMIT_RETRY_MS);
        res = await send();
        if (res.status === 429) throw new IgdbRateLimitError(endpoint);
      }
      if (!res.ok) throw new Error(`IGDB ${endpoint} failed with HTTP ${res.status}`);
      return (await res.json()) as T[];
    };
    const result = queue.then(run, run);
    queue = result.catch(() => undefined);
    return result;
  }

  function toGame(game: GameRecord, ttb?: IgdbTimeToBeat): IgdbGame {
    return {
      igdbId: game.id,
      name: game.name,
      summary: game.summary,
      releaseDate:
        game.first_release_date !== undefined
          ? new Date(game.first_release_date * 1000)
          : undefined,
      genres: names(game.genres),
      themes: names(game.themes),
      gameModes: names(game.game_modes),
      perspectives: names(game.player_perspectives),
      keywords: names(game.keywords),
      aggregatedRating: game.aggregated_rating,
      coverImageId: game.cover?.image_id,
      timeToBeatCompleteSec: ttb?.completely,
      timeToBeatHastySec: ttb?.hastily,
      timeToBeatNormalSec: ttb?.normally,
    };
  }

  async function loadGame(igdbId: number): Promise<IgdbGame | null> {
    const [game] = await query<GameRecord>("games", `fields ${GAME_FIELDS}; where id = ${igdbId};`);
    if (!game) return null;

    const [ttb] = await query<IgdbTimeToBeat>(
      "game_time_to_beats",
      `fields hastily,normally,completely; where game_id = ${game.id};`,
    );
    return toGame(game, ttb);
  }

  const ids = (values: number[]) => values.filter((v) => Number.isInteger(v) && v > 0).join(",");

  // The /date_formats table (id → precision), read once per client.
  let formatTable: Promise<Map<number, IgdbDatePrecision>> | null = null;
  function dateFormats(): Promise<Map<number, IgdbDatePrecision>> {
    formatTable ??= query<{ id: number; format?: string }>("date_formats", "fields id,format; limit 50;")
      .then((rows) => new Map(rows.map((r) => [r.id, precisionFromFormat(r.format)])))
      .catch((error) => {
        formatTable = null;
        throw error;
      });
    return formatTable;
  }

  return {
    async findBySteamAppId(appId): Promise<IgdbGame | null> {
      const [external] = await query<{ game?: number }>(
        "external_games",
        `fields game; where uid = "${appId}" & external_game_source = ${STEAM_SOURCE}; limit 1;`,
      );
      if (!external?.game) return null;
      return loadGame(external.game);
    },

    async findByName(name): Promise<IgdbGame | null> {
      // Apicalypse strings cannot hold quotes or backslashes; they never matter for matching.
      // Typographic apostrophes (`Marvel’s`) as plain ones, which IGDB's search knows.
      const term = name.replace(/[’‘`´]/g, "'").replace(/[™®©]/g, "").replace(/["\\]/g, " ").trim();
      if (!term) return null;
      const hits = await query<{ id: number; name: string }>(
        "games",
        `search "${term}"; fields id,name; limit ${SEARCH_LIMIT};`,
      );
      // Only an exact (normalized) name match: a fuzzy hit would attach the wrong game.
      const wanted = normalizeTitle(name);
      const hit = hits.find((h) => normalizeTitle(h.name) === wanted);
      return hit ? loadGame(hit.id) : null;
    },

    async getMedia(igdbId): Promise<IgdbMedia> {
      const [game] = await query<MediaRecord>(
        "games",
        `fields ${MEDIA_FIELDS}; where id = ${igdbId};`,
      );
      const images = (list?: ImageRecord[]) =>
        (list ?? [])
          .filter((i) => i.image_id)
          .map((i) => ({ imageId: i.image_id!, width: i.width ?? null, height: i.height ?? null }));
      return {
        videos: (game?.videos ?? [])
          .filter((v) => v.video_id && YOUTUBE_ID.test(v.video_id))
          .map((v) => ({ youtubeId: v.video_id!, name: v.name ?? null })),
        screenshots: images(game?.screenshots),
        artworks: images(game?.artworks),
      };
    },

    async getReleaseDates({ platforms, from, to, order, popularOnly, offset, limit }): Promise<IgdbReleaseDate[]> {
      const gameFields = CATALOG_GAME_FIELDS.split(",").map((f) => `game.${f}`).join(",");
      const popular = popularOnly ? " & (game.hypes > 0 | game.total_rating_count > 0)" : "";
      const rows = await query<ReleaseRecord>(
        "release_dates",
        `fields date,date_format,category,human,platform,${gameFields}; ` +
          `where platform = (${ids(platforms)}) & date >= ${Math.floor(from)} & date < ${Math.floor(to)} ` +
          `& game.game_type = (${GAME_TYPES})${popular}; sort date ${order === "desc" ? "desc" : "asc"}; ` +
          `limit ${clampLimit(limit)}; offset ${Math.max(0, Math.floor(offset))};`,
      );
      // `date_format` is a reference into /date_formats: its ids are resolved once per client.
      // `category` is deprecated and no longer tracks the real precision (every console release came
      // back as a bare year): `date_format` wins, and a `human` text with a day ("Nov 05, 2026") is a day.
      const needsFormats = rows.some((r) => typeof r.date_format === "number");
      const formats = needsFormats ? await dateFormats() : new Map<number, IgdbDatePrecision>();
      return rows.flatMap((row) => {
        const game = row.game && typeof row.game === "object" ? toCatalogGame(row.game) : null;
        if (!game || typeof row.platform !== "number") return [];
        const fromFields =
          typeof row.date_format === "number"
            ? (formats.get(row.date_format) ?? "tbd")
            : typeof row.category === "number"
              ? precisionFromCategory(row.category)
              : "tbd";
        const precision: IgdbDatePrecision = HUMAN_DAY.test(row.human ?? "") ? "day" : fromFields;
        return [{ id: row.id, platform: row.platform, date: row.date, precision, human: row.human, game }];
      });
    },

    async listGames({ platforms, afterId, updatedSince, limit }): Promise<IgdbCatalogPage> {
      const since = updatedSince !== undefined ? ` & updated_at > ${Math.floor(updatedSince)}` : "";
      const rows = await query<CatalogGameRecord>(
        "games",
        `fields ${CATALOG_GAME_FIELDS}; where platforms = (${ids(platforms)}) & game_type = (${GAME_TYPES}) ` +
          `& id > ${Math.max(0, Math.floor(afterId))}${since}; sort id asc; limit ${clampLimit(limit)};`,
      );
      return {
        games: rows.flatMap((row) => {
          const game = toCatalogGame(row);
          return game ? [game] : [];
        }),
        rawCount: rows.length,
        lastId: rows.reduce((max, r) => (Number.isInteger(r.id) ? Math.max(max, r.id) : max), 0),
      };
    },

    async getGames(gameIds): Promise<IgdbGame[]> {
      const list = ids(gameIds.slice(0, MAX_LIMIT));
      if (!list) return [];
      const rows = await query<GameRecord>("games", `fields ${GAME_FIELDS}; where id = (${list}); limit ${MAX_LIMIT};`);
      return rows.filter((r) => typeof r.id === "number" && r.name).map((r) => toGame(r));
    },

    async getGamePlatforms(gameIds): Promise<Map<number, number[]>> {
      const list = ids(gameIds.slice(0, MAX_LIMIT));
      if (!list) return new Map();
      const rows = await query<{ id?: number; platforms?: number[] }>(
        "games",
        `fields id,platforms; where id = (${list}); limit ${MAX_LIMIT};`,
      );
      const out = new Map<number, number[]>();
      for (const row of rows) {
        if (typeof row.id === "number") out.set(row.id, (row.platforms ?? []).filter((p) => Number.isInteger(p)));
      }
      return out;
    },

    async getTimesToBeat(gameIds): Promise<Map<number, IgdbTimeToBeat>> {
      const list = ids(gameIds.slice(0, MAX_LIMIT));
      if (!list) return new Map();
      const rows = await query<IgdbTimeToBeat & { game_id?: number }>(
        "game_time_to_beats",
        `fields game_id,hastily,normally,completely; where game_id = (${list}); limit ${MAX_LIMIT};`,
      );
      const seconds = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined);
      const times = new Map<number, IgdbTimeToBeat>();
      for (const row of rows) {
        if (typeof row.game_id !== "number") continue;
        const time = { hastily: seconds(row.hastily), normally: seconds(row.normally), completely: seconds(row.completely) };
        if (time.hastily || time.normally || time.completely) times.set(row.game_id, time);
      }
      return times;
    },

    async findPlatformIds(platformNames): Promise<number[]> {
      const list = platformNames.map((n) => `"${n.replace(/["\\]/g, "")}"`).join(",");
      if (!list) return [];
      const rows = await query<{ id: number }>("platforms", `fields id; where name = (${list}); limit 50;`);
      return rows.map((r) => r.id).filter((id) => Number.isInteger(id));
    },
  };
}

const CATEGORY_PRECISION: IgdbDatePrecision[] = ["day", "month", "year", "q1", "q2", "q3", "q4", "tbd"];

/** Deprecated `category` enum of release dates (0 YYYYMMMMDD … 7 TBD). */
export function precisionFromCategory(category: number): IgdbDatePrecision {
  return CATEGORY_PRECISION[category] ?? "tbd";
}

/** `format` string of a /date_formats row ("YYYYMMMMDD", "YYYYMMMM", "YYYY", "YYYYQ1"…, "TBD"). */
export function precisionFromFormat(format: string | undefined): IgdbDatePrecision {
  const value = (format ?? "").trim().toUpperCase();
  if (value === "YYYYMMMMDD") return "day";
  if (value === "YYYYMMMM") return "month";
  if (value === "YYYY") return "year";
  const quarter = /^YYYYQ([1-4])$/.exec(value);
  if (quarter) return `q${quarter[1]}` as IgdbDatePrecision;
  return "tbd";
}

/** A `human` release date that names a day: "Nov 05, 2026" or "2026-11-05". */
const HUMAN_DAY = /^(?:[A-Z][a-z]{2} \d{1,2}, \d{4}|\d{4}-\d{2}-\d{2})$/;

/** Largest page IGDB serves. */
const MAX_LIMIT = 500;
const clampLimit = (limit: number) => Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));

/**
 * IGDB game types kept in the catalog: main game (0), standalone expansion (4), remake (8),
 * remaster (9), expanded game (10) and port (11). DLCs, bundles, mods, episodes and updates stay out.
 */
export const IGDB_CATALOG_GAME_TYPES = [0, 4, 8, 9, 10, 11] as const;
const GAME_TYPES = IGDB_CATALOG_GAME_TYPES.join(",");

const CATALOG_GAME_FIELDS = [
  "name",
  "platforms",
  "first_release_date",
  "cover.image_id",
  "hypes",
  "total_rating_count",
  "external_games.uid",
  "external_games.external_game_source",
  "external_games.category",
].join(",");

type CatalogGameRecord = {
  id: number;
  name?: string;
  platforms?: number[];
  first_release_date?: number;
  cover?: { image_id?: string };
  hypes?: number;
  total_rating_count?: number;
  external_games?: { uid?: string; external_game_source?: number; category?: number }[];
};

type ReleaseRecord = {
  id: number;
  date?: number;
  date_format?: number;
  /** Deprecated twin of `date_format`, read when the new field is missing. */
  category?: number;
  human?: string;
  platform?: number;
  game?: CatalogGameRecord | number;
};

/** IGDB's id for Steam among external game sources. */
const STEAM_EXTERNAL_SOURCE = 1;

export function toCatalogGame(row: CatalogGameRecord): IgdbCatalogGame | null {
  const name = row.name?.trim();
  if (!Number.isInteger(row.id) || !name) return null;
  const steamAppIds = (row.external_games ?? [])
    .filter((e) => (e.external_game_source ?? e.category) === STEAM_EXTERNAL_SOURCE)
    .map((e) => Number(e.uid))
    .filter((id) => Number.isInteger(id) && id > 0);
  return {
    igdbId: row.id,
    name,
    platforms: (row.platforms ?? []).filter((p) => Number.isInteger(p)),
    firstReleaseDate: row.first_release_date,
    steamAppIds: [...new Set(steamAppIds)],
    coverImageId: row.cover?.image_id,
    popularity: Math.max(0, Math.round((row.hypes ?? 0) + (row.total_rating_count ?? 0))),
  };
}
