import { isSteamCdnUrl, readJson, type PoliteFetch } from "./polite-fetch";
import { decodeEntities } from "./text";

const STORE = "https://store.steampowered.com";
/** Unhashed library assets; they exist for most apps, so callers verify them before use. */
const ASSETS = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps";
const VIDEOS = "https://video.akamai.steamstatic.com/store_trailers";
const MAX_SCREENSHOTS = 8;
/** Newer trailers only exist as streams, so a few are offered for the caller to verify. */
const MAX_TRAILER_CANDIDATES = 4;

export type StoreTrailer = { id: number; name: string; url: string; thumbnailUrl?: string };
export type StoreScreenshot = { url: string; width?: number; height?: number };

/** The store page of an app, as read in Brazilian Portuguese. */
export type StoreApp = {
  appId: number;
  type: string;
  name: string;
  /** Short description as plain text. */
  summary?: string;
  developer?: string;
  publisher?: string;
  releaseDate?: Date;
  comingSoon: boolean;
  criticScore?: number;
  achievementCount: number;
  headerUrl?: string;
  screenshots: StoreScreenshot[];
  trailers: StoreTrailer[];
};

type StoreMovie = {
  id: number;
  name?: string;
  thumbnail?: string;
  mp4?: { max?: string; "480"?: string };
  webm?: { max?: string; "480"?: string };
};

type StoreAppDetails = {
  type?: string;
  name?: string;
  short_description?: string;
  developers?: string[];
  publishers?: string[];
  release_date?: { coming_soon?: boolean; date?: string };
  metacritic?: { score?: number };
  achievements?: { total?: number };
  header_image?: string;
  screenshots?: { path_full?: string }[];
  movies?: StoreMovie[];
};

/** Plain text from store HTML: tags dropped, entities decoded, whitespace collapsed. */
export function htmlToText(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

const PT_MONTHS: Record<string, number> = {
  jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11,
};

/** Store dates in Portuguese ("24/fev./2017", "24 de fev. de 2017", "24/02/2017"). */
export function parseStoreDate(text: string | undefined): Date | undefined {
  if (!text) return undefined;
  const value = text.trim().toLowerCase();
  const numeric = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (numeric) return utcDate(Number(numeric[3]), Number(numeric[2]) - 1, Number(numeric[1]));
  const named = /^(\d{1,2})[\s/]*(?:de\s+)?([a-zç]{3})[a-zç]*\.?[\s/]*(?:de\s+)?(\d{4})$/.exec(value);
  if (!named || PT_MONTHS[named[2]] === undefined) return undefined;
  return utcDate(Number(named[3]), PT_MONTHS[named[2]], Number(named[1]));
}

function utcDate(year: number, month: number, day: number): Date | undefined {
  const date = new Date(Date.UTC(year, month, day));
  return date.getUTCMonth() === month && date.getUTCDate() === day ? date : undefined;
}

/** `ss_<hash>.1920x1080.jpg` carries its size in the name. */
function sizeFromUrl(url: string): { width?: number; height?: number } {
  const match = /\.(\d{2,5})x(\d{2,5})\.\w+(?:\?|$)/.exec(url);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : {};
}

function trailerUrl(movie: StoreMovie): string {
  // Older store payloads list the mp4/webm files; newer ones only stream manifests, while the
  // progressive mp4 still lives at the legacy path (callers verify it).
  return movie.mp4?.max ?? movie.webm?.max ?? `${VIDEOS}/${movie.id}/movie_max.mp4`;
}

/** Store names carry trademark signs ("Apex Legends™"), which only get in the way (slugs, search). */
export function cleanName(name: string): string {
  return name.replace(/[™®©]/g, "").replace(/\s+/g, " ").trim();
}

export function parseStoreApp(appId: number, json: unknown): StoreApp | null {
  const entry = (json as Record<string, { success?: boolean; data?: StoreAppDetails }> | null)?.[
    String(appId)
  ];
  const data = entry?.success ? entry.data : undefined;
  if (!data?.name) return null;
  const movies = data.movies ?? [];
  return {
    appId,
    type: data.type ?? "game",
    name: cleanName(data.name),
    summary: data.short_description ? htmlToText(data.short_description) || undefined : undefined,
    developer: data.developers?.[0]?.trim() || undefined,
    publisher: data.publishers?.[0]?.trim() || undefined,
    releaseDate: parseStoreDate(data.release_date?.date),
    comingSoon: data.release_date?.coming_soon ?? false,
    criticScore: data.metacritic?.score,
    achievementCount: data.achievements?.total ?? 0,
    // Media is hotlinked, so only https URLs on Steam's CDN are kept.
    headerUrl: isSteamCdnUrl(data.header_image) ? data.header_image : undefined,
    screenshots: (data.screenshots ?? [])
      .flatMap((s) => (isSteamCdnUrl(s.path_full) ? [{ url: s.path_full, ...sizeFromUrl(s.path_full) }] : []))
      .slice(0, MAX_SCREENSHOTS),
    trailers: movies
      .filter((m) => Number.isInteger(m.id) && isSteamCdnUrl(trailerUrl(m)))
      .slice(0, MAX_TRAILER_CANDIDATES)
      .map((m) => ({
        id: m.id,
        name: m.name?.trim() || "Trailer",
        url: trailerUrl(m),
        thumbnailUrl: isSteamCdnUrl(m.thumbnail) ? m.thumbnail : undefined,
      })),
  };
}

/** Store page in Brazilian Portuguese; null when the store does not know the app. */
export async function fetchStoreApp(politeFetch: PoliteFetch, appId: number): Promise<StoreApp | null> {
  const res = await politeFetch(`${STORE}/api/appdetails?appids=${appId}&l=brazilian&cc=br`);
  if (!res.ok) throw new Error(`Steam store appdetails ${appId} failed with HTTP ${res.status}`);
  return parseStoreApp(appId, await readJson(res));
}

/** The store's item service (public, no key): one request answers many apps. */
const STORE_BROWSE = "https://api.steampowered.com/IStoreBrowseService/GetItems/v1/";
const ASSET_ROOT = "https://shared.akamai.steamstatic.com/store_item_assets/";

type SizedAsset = { url: string; width: number; height: number };
/** An app's library art at its real (often hashed) path: the plain path 404s for newer apps. */
export type StoreAssets = { cover?: SizedAsset; hero?: SizedAsset; capsule?: SizedAsset };

/**
 * The `assets` of an IStoreBrowseService/GetItems answer, by app id: the 600×900 portrait
 * (`library_capsule_2x`, else the 300×450 one) and the 3840×1240 hero, as Steam CDN URLs.
 */
export function parseStoreAssets(json: unknown): Map<number, StoreAssets> {
  type Item = { appid?: number; assets?: Record<string, string | undefined> };
  const items = (json as { response?: { store_items?: Item[] } } | null)?.response?.store_items ?? [];
  const out = new Map<number, StoreAssets>();
  for (const item of items) {
    const format = item.assets?.asset_url_format;
    if (!item.appid || !format?.includes("${FILENAME}")) continue;
    const url = (file: string | undefined) => {
      if (!file || !/^[\w./-]+$/.test(file)) return undefined;
      const full = ASSET_ROOT + format.replace("${FILENAME}", file);
      return isSteamCdnUrl(full) ? full : undefined;
    };
    const assets: StoreAssets = {};
    const big = url(item.assets?.library_capsule_2x);
    const small = url(item.assets?.library_capsule);
    if (big) assets.cover = { url: big, width: 600, height: 900 };
    else if (small) assets.cover = { url: small, width: 300, height: 450 };
    const hero = url(item.assets?.library_hero);
    if (hero) assets.hero = { url: hero, width: 3840, height: 1240 };
    const capsule = url(item.assets?.main_capsule);
    if (capsule) assets.capsule = { url: capsule, width: 616, height: 353 };
    if (assets.cover || assets.hero || assets.capsule) out.set(item.appid, assets);
  }
  return out;
}

/** Library art of up to 100 apps in one request (an app Steam has no art for is left out). */
export async function fetchStoreAssets(politeFetch: PoliteFetch, appIds: number[]): Promise<Map<number, StoreAssets>> {
  if (appIds.length === 0) return new Map();
  const input = {
    ids: appIds.slice(0, 100).map((appid) => ({ appid })),
    context: { language: "brazilian", country_code: "BR" },
    data_request: { include_assets: true },
  };
  const res = await politeFetch(`${STORE_BROWSE}?input_json=${encodeURIComponent(JSON.stringify(input))}`);
  if (!res.ok) throw new Error(`Steam GetItems failed with HTTP ${res.status}`);
  return parseStoreAssets(await readJson(res));
}

/** Steam user reviews of an app (all languages). */
export type StoreReviews = { positive: number; total: number };

/**
 * The review summaries of a GetItems answer, by app id: `summary_filtered` (all languages, the
 * store page's own figure). Steam gives a whole percentage, so `positive` is rounded from it.
 * An app without reviews (or unknown) is left out.
 */
export function parseStoreReviews(json: unknown): Map<number, StoreReviews> {
  type Summary = { review_count?: unknown; percent_positive?: unknown };
  type Item = { appid?: number; reviews?: { summary_filtered?: Summary } };
  const items = (json as { response?: { store_items?: Item[] } } | null)?.response?.store_items ?? [];
  const out = new Map<number, StoreReviews>();
  for (const item of items) {
    const summary = item.reviews?.summary_filtered;
    const total = Number(summary?.review_count);
    const percent = Number(summary?.percent_positive);
    if (!item.appid || !Number.isInteger(total) || total < 0 || !(percent >= 0 && percent <= 100)) continue;
    out.set(item.appid, { positive: Math.round((total * percent) / 100), total });
  }
  return out;
}

/**
 * Review totals of up to 100 apps in one request. The store's old `appreviews` address now
 * redirects to the home page (every read failed with HTML from 2026-11-02).
 */
export async function fetchStoreReviews(politeFetch: PoliteFetch, appIds: number[]): Promise<Map<number, StoreReviews>> {
  if (appIds.length === 0) return new Map();
  const input = {
    ids: appIds.slice(0, 100).map((appid) => ({ appid })),
    context: { language: "english", country_code: "US" },
    data_request: { include_reviews: true },
  };
  const res = await politeFetch(`${STORE_BROWSE}?input_json=${encodeURIComponent(JSON.stringify(input))}`);
  if (!res.ok) throw new Error(`Steam GetItems (reviews) failed with HTTP ${res.status}`);
  return parseStoreReviews(await readJson(res));
}

/** Library art at its unhashed path: portrait cover, wide hero and transparent logo. */
export function libraryAssetUrls(appId: number) {
  return {
    cover: { url: `${ASSETS}/${appId}/library_600x900.jpg`, width: 600, height: 900 },
    hero: { url: `${ASSETS}/${appId}/library_hero.jpg`, width: 3840, height: 1240 },
    logo: { url: `${ASSETS}/${appId}/logo.png` },
  };
}

