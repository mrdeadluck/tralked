import type { PoliteFetch } from "./polite-fetch";

const STEAMSPY = "https://steamspy.com/api.php";

export const TOP_LISTS = ["top100forever", "top100in2weeks", "top100owned"] as const;
export type TopList = (typeof TOP_LISTS)[number];

export type SpyApp = {
  appId: number;
  name: string;
  /** Lower bound of SteamSpy's owners range ("10,000,000 .. 20,000,000" → 10,000,000). */
  ownersMin: number;
  ccu: number;
  positive: number;
};

type SpyEntry = {
  appid?: number;
  name?: string;
  owners?: string;
  ccu?: number;
  positive?: number;
  tags?: Record<string, number> | unknown[];
};

export function parseOwners(owners: string | undefined): number {
  const first = owners?.split("..")[0]?.replace(/[^\d]/g, "");
  return first ? Number(first) : 0;
}

function toApp(entry: SpyEntry): SpyApp | null {
  if (!entry.appid || !entry.name) return null;
  return {
    appId: entry.appid,
    name: entry.name,
    ownersMin: parseOwners(entry.owners),
    ccu: entry.ccu ?? 0,
    positive: entry.positive ?? 0,
  };
}

export async function fetchTopList(politeFetch: PoliteFetch, list: TopList): Promise<SpyApp[]> {
  const res = await politeFetch(`${STEAMSPY}?request=${list}`);
  if (!res.ok) throw new Error(`SteamSpy ${list} failed with HTTP ${res.status}`);
  const data = (await res.json()) as Record<string, SpyEntry>;
  return Object.values(data).flatMap((entry) => toApp(entry) ?? []);
}

/**
 * One page (1,000 apps) of SteamSpy's full list, most owned first. The three top-100 lists now
 * answer the same 100 apps, so page 0 is what fills a catalog past 100. SteamSpy allows this
 * request once a minute; a bootstrap only needs page 0.
 */
export async function fetchMostOwnedPage(politeFetch: PoliteFetch, page = 0): Promise<SpyApp[]> {
  const res = await politeFetch(`${STEAMSPY}?request=all&page=${page}`);
  if (!res.ok) throw new Error(`SteamSpy all page ${page} failed with HTTP ${res.status}`);
  const data = (await res.json()) as Record<string, SpyEntry>;
  return Object.values(data).flatMap((entry) => toApp(entry) ?? []);
}

/** User tags with their votes; `{}` when SteamSpy has none (it then answers an empty array). */
export async function fetchTags(politeFetch: PoliteFetch, appId: number): Promise<Record<string, number>> {
  const res = await politeFetch(`${STEAMSPY}?request=appdetails&appid=${appId}`);
  if (!res.ok) throw new Error(`SteamSpy appdetails ${appId} failed with HTTP ${res.status}`);
  const tags = ((await res.json()) as SpyEntry).tags;
  return tags && !Array.isArray(tags) ? tags : {};
}

/**
 * Union of the top lists without duplicates, most owned first (ties: more concurrent players,
 * then more positive reviews, then the lower app id, so the order is stable).
 */
export function rankByOwners(lists: SpyApp[][]): SpyApp[] {
  const byId = new Map<number, SpyApp>();
  for (const app of lists.flat()) if (!byId.has(app.appId)) byId.set(app.appId, app);
  return [...byId.values()].sort(
    (a, b) => b.ownersMin - a.ownersMin || b.ccu - a.ccu || b.positive - a.positive || a.appId - b.appId,
  );
}
