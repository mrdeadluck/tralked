import { timeoutSignal } from "../http";
import type { RawgApi } from "./types";

const BASE = "https://api.rawg.io/api/games";
const STEAM_STORE_ID = "1";

export type RawgClientConfig = {
  apiKey: string;
  fetch?: typeof fetch;
};

type SearchResponse = {
  results?: {
    id: number;
    name: string;
    metacritic?: number | null;
    playtime?: number | null;
  }[];
};

export function createRawgClient({
  apiKey,
  fetch: fetchImpl = globalThis.fetch,
}: RawgClientConfig): RawgApi {
  return {
    // RAWG has no Steam-appId lookup, so `appId` is unused and we match by name.
    async findBySteamAppId(_appId, name) {
      const url = new URL(BASE);
      url.searchParams.set("key", apiKey);
      url.searchParams.set("search", name);
      url.searchParams.set("stores", STEAM_STORE_ID);
      const res = await fetchImpl(url.toString(), { signal: timeoutSignal() });
      if (!res.ok) throw new Error(`RAWG search failed with HTTP ${res.status}`);
      const data = (await res.json()) as SearchResponse;
      const wanted = name.trim().toLowerCase();
      const match = (data.results ?? []).find((r) => r.name.trim().toLowerCase() === wanted);
      if (!match) return null;
      return {
        rawgId: match.id,
        metacritic: match.metacritic ?? undefined,
        playtimeHours: match.playtime ? match.playtime : undefined,
      };
    },
  };
}
