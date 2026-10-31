import { timeoutSignal } from "../http";
import type { SteamApi } from "./types";

const BASE = "https://api.steampowered.com";

export type SteamClientConfig = {
  apiKey: string;
  fetch?: typeof fetch;
};

type PlayerSummariesResponse = {
  response?: {
    players?: {
      steamid: string;
      personaname: string;
      avatarfull: string;
      communityvisibilitystate: number;
    }[];
  };
};

type OwnedGamesResponse = {
  response?: {
    game_count?: number;
    games?: {
      appid: number;
      name?: string;
      playtime_forever?: number;
      playtime_2weeks?: number;
      rtime_last_played?: number;
    }[];
  };
};

type WishlistResponse = {
  response?: { items?: { appid?: number; priority?: number; date_added?: number }[] };
};

type AppListResponse = {
  response?: {
    apps?: { appid?: number; name?: string; last_modified?: number }[];
    have_more_results?: boolean;
    last_appid?: number;
  };
};

/** A Unix time from Steam (seconds; 0 = unknown) as a Date, or null. */
export const steamTime = (seconds: number | undefined): Date | null =>
  seconds && seconds > 0 ? new Date(seconds * 1000) : null;

/** Parses IWishlistService/GetWishlist (shared by the keyed and keyless adapters). */
export function parseWishlist(data: WishlistResponse) {
  return (data.response?.items ?? []).flatMap((item) =>
    Number.isInteger(item.appid) && item.appid! > 0
      ? [
          {
            appId: item.appid!,
            priority: Number.isInteger(item.priority) ? item.priority! : null,
            addedAt: steamTime(item.date_added),
          },
        ]
      : [],
  );
}

/** Parses one IStoreService/GetAppList page (apps without an id or a name are dropped). */
export function parseAppList(data: AppListResponse) {
  const raw = data.response?.apps ?? [];
  const apps = raw.flatMap((a) =>
    Number.isInteger(a.appid) && a.appid! > 0 && a.name?.trim()
      ? [{ appId: a.appid!, name: a.name.trim(), lastModified: a.last_modified ?? null }]
      : [],
  );
  const lastAppId = data.response?.last_appid ?? raw.at(-1)?.appid ?? 0;
  return { apps, haveMore: data.response?.have_more_results === true, lastAppId };
}

type SchemaResponse = {
  game?: {
    availableGameStats?: {
      achievements?: {
        name: string;
        displayName: string;
        hidden?: number;
        description?: string;
        icon?: string;
      }[];
    };
  };
};

type GlobalPercentagesResponse = {
  achievementpercentages?: {
    achievements?: { name: string; percent: number | string }[];
  };
};

type PlayerAchievementsResponse = {
  playerstats?: {
    success?: boolean;
    error?: string;
    achievements?: { apiname: string; achieved?: number; unlocktime?: number }[];
  };
};

export function createSteamClient({
  apiKey,
  fetch: fetchImpl = globalThis.fetch,
}: SteamClientConfig): SteamApi {
  async function request(
    path: string,
    params: Record<string, string | number>,
  ): Promise<Response> {
    const url = new URL(path, BASE);
    url.searchParams.set("key", apiKey);
    for (const [name, value] of Object.entries(params)) {
      url.searchParams.set(name, String(value));
    }
    return fetchImpl(url.toString(), { signal: timeoutSignal() });
  }

  async function getJson<T>(
    path: string,
    params: Record<string, string | number>,
  ): Promise<T> {
    const res = await request(path, params);
    if (!res.ok) throw new Error(`Steam API ${path} failed with HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  return {
    async getPlayerSummary(steamId) {
      const data = await getJson<PlayerSummariesResponse>(
        "/ISteamUser/GetPlayerSummaries/v2/",
        { steamids: steamId },
      );
      const player = data.response?.players?.[0];
      if (!player) throw new Error(`Steam player ${steamId} not found`);
      return {
        steamId: player.steamid,
        personaName: player.personaname,
        avatarUrl: player.avatarfull,
        profilePublic: player.communityvisibilitystate === 3,
      };
    },

    async getOwnedGames(steamId) {
      // Every game of the library, never-played and played free-to-play games included.
      const data = await getJson<OwnedGamesResponse>(
        "/IPlayerService/GetOwnedGames/v1/",
        { steamid: steamId, include_appinfo: 1, include_played_free_games: 1, format: "json" },
      );
      // A public profile with "Game details" private answers `{"response":{}}`: neither
      // `games` nor `game_count`. A real empty library still carries `game_count: 0`.
      if (!data.response?.games && data.response?.game_count === undefined) return "private";
      return (data.response?.games ?? []).map((g) => ({
        appId: g.appid,
        playtimeMin: g.playtime_forever ?? 0,
        name: g.name?.trim() || undefined,
        playtime2WeeksMin: g.playtime_2weeks ?? 0,
        lastPlayedAt: steamTime(g.rtime_last_played),
      }));
    },

    async getWishlist(steamId) {
      const path = "/IWishlistService/GetWishlist/v1/";
      const res = await request(path, { steamid: steamId });
      if (res.status === 401 || res.status === 403) return "private";
      if (!res.ok) throw new Error(`Steam API ${path} failed with HTTP ${res.status}`);
      // A private wishlist answers `{"response":{}}`, like an empty one: both import as empty.
      return parseWishlist((await res.json()) as WishlistResponse);
    },

    async getAppList({ lastAppId, ifModifiedSince, maxResults } = {}) {
      const data = await getJson<AppListResponse>("/IStoreService/GetAppList/v1/", {
        include_games: 1,
        max_results: maxResults ?? 10_000,
        ...(lastAppId && { last_appid: lastAppId }),
        ...(ifModifiedSince && { if_modified_since: ifModifiedSince }),
      });
      return parseAppList(data);
    },

    async getSchemaForGame(appId) {
      const data = await getJson<SchemaResponse>("/ISteamUserStats/GetSchemaForGame/v2/", {
        appid: appId,
      });
      return (data.game?.availableGameStats?.achievements ?? []).map((a) => ({
        apiName: a.name,
        name: a.displayName,
        description: a.description || undefined,
        iconUrl: a.icon || undefined,
        hidden: a.hidden === 1,
      }));
    },

    async getGlobalAchievementPercentages(appId) {
      const data = await getJson<GlobalPercentagesResponse>(
        "/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/",
        { gameid: appId },
      );
      const result: Record<string, number> = {};
      for (const a of data.achievementpercentages?.achievements ?? []) {
        result[a.name] = Number(a.percent);
      }
      return result;
    },

    async getPlayerAchievements(steamId, appId) {
      const path = "/ISteamUserStats/GetPlayerAchievements/v1/";
      const res = await request(path, { steamid: steamId, appid: appId, l: "english" });
      if (res.status === 403) return "private";
      // Steam answers 400 "Requested app has no stats" for games without achievements.
      if (res.status === 400) return [];
      if (!res.ok) throw new Error(`Steam API ${path} failed with HTTP ${res.status}`);
      const data = (await res.json()) as PlayerAchievementsResponse;
      if (data.playerstats?.success === false) {
        const error = data.playerstats.error ?? "";
        if (/no stats/i.test(error)) return [];
        if (!error || /not public/i.test(error)) return "private";
        throw new Error(`Steam API ${path} failed: ${error}`);
      }
      return (data.playerstats?.achievements ?? []).map((a) => ({
        apiName: a.apiname,
        unlockedAt: a.unlocktime ? new Date(a.unlocktime * 1000) : null,
      }));
    },
  };
}
