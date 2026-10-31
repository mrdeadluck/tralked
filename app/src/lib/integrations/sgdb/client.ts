import type { SgdbApi } from "./types";

const BASE = "https://www.steamgriddb.com/api/v2";

export type SgdbClientConfig = {
  apiKey: string;
  fetch?: typeof fetch;
};

export function createSgdbClient({
  apiKey,
  fetch: fetchImpl = globalThis.fetch,
}: SgdbClientConfig): SgdbApi {
  async function firstUrl(kind: "grids" | "heroes" | "logos", appId: number) {
    const res = await fetchImpl(`${BASE}/${kind}/steam/${appId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.status === 404) return undefined; // unknown game
    if (!res.ok) throw new Error(`SteamGridDB ${kind} failed with HTTP ${res.status}`);
    const body = (await res.json()) as { data?: { url?: string }[] };
    return body.data?.[0]?.url;
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
