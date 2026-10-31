import { timeoutSignal } from "../http";
import { normalizeTitle } from "../title-match";
import type { IgdbApi, IgdbGame, IgdbMedia } from "./types";

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
}: IgdbClientConfig): IgdbApi {
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

  async function loadGame(igdbId: number): Promise<IgdbGame | null> {
    const [game] = await query<GameRecord>("games", `fields ${GAME_FIELDS}; where id = ${igdbId};`);
    if (!game) return null;

    const [ttb] = await query<{ completely?: number }>(
      "game_time_to_beats",
      `fields completely; where game_id = ${game.id};`,
    );

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
    };
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
      const term = name.replace(/["\\]/g, " ").trim();
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
  };
}
