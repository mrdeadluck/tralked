import { isSteamCdnUrl, readJson, type PoliteFetch } from "./polite-fetch";
import { cleanName, parseStoreDate } from "./store";
import { decodeEntities } from "./text";

/**
 * Steam's lists of popular new and upcoming games (Plano 4, F10), read without a key from the
 * store search's JSON (`/search/results/?filter=popularnew|popularcomingsoon&infinite=1`, the
 * request behind the store's "Popular new releases" / "Popular upcoming" pages). Each row carries
 * the appid, name, release date text and capsule, sorted by popularity.
 *
 * `api/featuredcategories` (new_releases / coming_soon) was checked too (October 2026): its items
 * have no release date and are not ranked by popularity (obscure games first), so it would cost an
 * `appdetails` request per game and still show the wrong games.
 */

const STORE = "https://store.steampowered.com";
/** Store search category of full games (no DLC, soundtracks, software). */
const GAMES_CATEGORY = 998;
/** Content descriptors of sexual content (3 = adult only, 4 = frequent nudity): kept off the home. */
const ADULT_DESCRIPTORS = new Set([3, 4]);

export type SteamReleaseList = "popularnew" | "popularcomingsoon";

export type SteamReleaseItem = {
  appId: number;
  name: string;
  /** The store's day, when the text is a day ("28/out./2026"). */
  date?: Date;
  /** The store's text when it is not a day ("4º trimestre de 2026", "2027", "Em breve"). */
  dateLabel?: string;
  /** Wide capsule on the Steam CDN. */
  imageUrl?: string;
  /** Position in the list (0 = most popular). */
  position: number;
};

const attr = (block: string, name: string) => new RegExp(`${name}="([^"]*)"`).exec(block)?.[1];

/** Parses the `results_html` of a store search page. `start` is the position of its first row. */
export function parseSearchResults(html: string, start = 0): SteamReleaseItem[] {
  const items: SteamReleaseItem[] = [];
  const rows = html.match(/<a\b[^>]*\bdata-ds-appid="[^"]*"[\s\S]*?<\/a>/g) ?? [];
  rows.forEach((row, i) => {
    const appIdText = attr(row, "data-ds-appid") ?? "";
    // Packages list several appids ("1,2"); bundles have none. Only single apps are games.
    if (!/^\d+$/.test(appIdText)) return;
    const descriptors = (attr(row, "data-ds-descids") ?? "").match(/\d+/g)?.map(Number) ?? [];
    if (descriptors.some((d) => ADULT_DESCRIPTORS.has(d))) return;
    const title = /<span class="title">([\s\S]*?)<\/span>/.exec(row)?.[1];
    const name = title ? cleanName(decodeEntities(title.replace(/<[^>]*>/g, ""))) : "";
    if (!name) return;
    const released = /class="search_released[^"]*">([\s\S]*?)<\/div>/.exec(row)?.[1];
    const text = released ? decodeEntities(released.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim() : "";
    const date = parseStoreDate(text);
    const img = /<div class="search_capsule"><img[^>]*\bsrc="([^"]+)"/.exec(row)?.[1];
    const imageUrl = img ? decodeEntities(img) : undefined;
    items.push({
      appId: Number(appIdText),
      name,
      ...(date ? { date } : text ? { dateLabel: text.slice(0, 60) } : {}),
      ...(isSteamCdnUrl(imageUrl) ? { imageUrl } : {}),
      position: start + i,
    });
  });
  return items;
}

/** One page of a list (`count` ≤ 100 rows), most popular first. */
export async function fetchReleaseList(
  politeFetch: PoliteFetch,
  list: SteamReleaseList,
  start = 0,
  count = 50,
): Promise<SteamReleaseItem[]> {
  const url =
    `${STORE}/search/results/?query&start=${start}&count=${count}&filter=${list}` +
    `&category1=${GAMES_CATEGORY}&infinite=1&cc=br&l=brazilian`;
  const res = await politeFetch(url);
  if (!res.ok) throw new Error(`Steam store search (${list}) failed with HTTP ${res.status}`);
  const json = await readJson<{ success?: number; results_html?: string }>(res);
  if (json.success !== 1 || typeof json.results_html !== "string") {
    throw new Error(`Steam store search (${list}) answered without results`);
  }
  return parseSearchResults(json.results_html, start);
}
