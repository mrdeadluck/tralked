import type { PoliteFetch } from "./polite-fetch";

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

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Plain text from store HTML: tags dropped, entities decoded, whitespace collapsed. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
      if (code[0] === "#") {
        const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
        return Number.isFinite(n) ? String.fromCodePoint(n) : match;
      }
      return ENTITIES[code.toLowerCase()] ?? match;
    })
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
    headerUrl: data.header_image,
    screenshots: (data.screenshots ?? [])
      .flatMap((s) => (s.path_full ? [{ url: s.path_full, ...sizeFromUrl(s.path_full) }] : []))
      .slice(0, MAX_SCREENSHOTS),
    trailers: movies.slice(0, MAX_TRAILER_CANDIDATES).map((m) => ({
      id: m.id,
      name: m.name?.trim() || "Trailer",
      url: trailerUrl(m),
      thumbnailUrl: m.thumbnail,
    })),
  };
}

/** Store page in Brazilian Portuguese; null when the store does not know the app. */
export async function fetchStoreApp(politeFetch: PoliteFetch, appId: number): Promise<StoreApp | null> {
  const res = await politeFetch(`${STORE}/api/appdetails?appids=${appId}&l=brazilian&cc=br`);
  if (!res.ok) throw new Error(`Steam store appdetails ${appId} failed with HTTP ${res.status}`);
  return parseStoreApp(appId, await res.json());
}

/** Library art at its unhashed path: portrait cover, wide hero and transparent logo. */
export function libraryAssetUrls(appId: number) {
  return {
    cover: { url: `${ASSETS}/${appId}/library_600x900.jpg`, width: 600, height: 900 },
    hero: { url: `${ASSETS}/${appId}/library_hero.jpg`, width: 3840, height: 1240 },
    logo: { url: `${ASSETS}/${appId}/logo.png` },
  };
}
