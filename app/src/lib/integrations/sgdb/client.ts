import { PNG_THUMB_HINT } from "@/lib/images/sized";
import { timeoutSignal } from "../http";
import type { SgdbApi } from "./types";

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

export function createSgdbClient({
  apiKey,
  fetch: fetchImpl = globalThis.fetch,
}: SgdbClientConfig): SgdbApi {
  async function firstUrl(kind: "grids" | "heroes" | "logos", appId: number) {
    const res = await fetchImpl(`${BASE}/${kind}/steam/${appId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: timeoutSignal(),
    });
    if (res.status === 404) return undefined; // unknown game
    if (!res.ok) throw new Error(`SteamGridDB ${kind} failed with HTTP ${res.status}`);
    const body = (await res.json()) as { data?: { url?: string; thumb?: string }[] };
    return assetUrl(body.data?.[0]);
  }

  return {
    async getArt(appId) {
      const [coverUrl, heroUrl, logoUrl] = await Promise.all([
        firstUrl("grids", appId),
        firstUrl("heroes", appId),
        firstUrl("logos", appId),
      ]);
      return { coverUrl, heroUrl, logoUrl };
    },
  };
}
