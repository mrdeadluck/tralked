import { PNG_THUMB_HINT } from "@/lib/images/sized";
import { timeoutSignal } from "../http";
import type { SgdbApi, SgdbAsset } from "./types";

const BASE = "https://www.steamgriddb.com/api/v2";

export type SgdbClientConfig = {
  apiKey: string;
  fetch?: typeof fetch;
};

/**
 * The asset URL, with PNG_THUMB_HINT when SteamGridDB keeps its thumbnail only in PNG (a
 * transparent image: the API's `thumb` ends in .png), so pages ask for that thumbnail directly
 * instead of a JPEG one that 404s (lib/images/sized).
 */
export function assetUrl(item: { url?: string; thumb?: string } | undefined): string | undefined {
  if (!item?.url) return undefined;
  const pngThumb = /\.png$/i.test(item.url) && /\/(?:hero_thumb|thumb)\/[^/]+\.png$/i.test(item.thumb ?? "");
  return pngThumb ? `${item.url}${PNG_THUMB_HINT}` : item.url;
}

type Item = { url?: string; thumb?: string; width?: number; height?: number };

/** The first static, safe image of an answer, with its size. */
export function firstAsset(items: Item[] | undefined): SgdbAsset | undefined {
  const item = items?.find((i) => i.url);
  const url = assetUrl(item);
  if (!url || !item) return undefined;
  return { url, width: item.width ?? null, height: item.height ?? null };
}

/**
 * Each shape asked apart, so the cover is a real portrait and the capsule a real wide grid (the
 * first grid of an unfiltered list could be either): grids 600×900, grids 920×430 or 460×215,
 * heroes and logos. Static images only, no NSFW or humor entries.
 */
const QUERIES = {
  cover: "grids/steam/{id}?dimensions=600x900&types=static&nsfw=false&humor=false",
  capsule: "grids/steam/{id}?dimensions=920x430,460x215&types=static&nsfw=false&humor=false",
  hero: "heroes/steam/{id}?types=static&nsfw=false&humor=false",
  logo: "logos/steam/{id}?types=static&nsfw=false&humor=false",
} as const;

export function createSgdbClient({
  apiKey,
  fetch: fetchImpl = globalThis.fetch,
}: SgdbClientConfig): SgdbApi {
  async function first(kind: keyof typeof QUERIES, appId: number) {
    const res = await fetchImpl(`${BASE}/${QUERIES[kind].replace("{id}", String(appId))}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: timeoutSignal(),
    });
    if (res.status === 404) return undefined; // unknown game
    if (!res.ok) throw new Error(`SteamGridDB ${kind} failed with HTTP ${res.status}`);
    const body = (await res.json()) as { data?: Item[] };
    return firstAsset(body.data);
  }

  return {
    async getArt(appId) {
      const [cover, capsule, hero, logo] = await Promise.all([
        first("cover", appId),
        first("capsule", appId),
        first("hero", appId),
        first("logo", appId),
      ]);
      return { coverUrl: cover?.url, heroUrl: hero?.url, logoUrl: logo?.url, cover, capsule, hero, logo };
    },
  };
}
