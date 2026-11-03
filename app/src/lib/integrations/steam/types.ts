export type SteamPlayerSummary = {
  steamId: string;
  personaName: string;
  avatarUrl: string;
  profilePublic: boolean;
};

export type SteamOwnedGame = {
  appId: number;
  /** `playtime_forever` in minutes (0: never played, or playtime hidden by the player). */
  playtimeMin: number;
  /** Store name (`include_appinfo`); absent for adapters that do not list the library. */
  name?: string;
  /** `playtime_2weeks` in minutes. */
  playtime2WeeksMin?: number;
  /** `rtime_last_played`; null when Steam does not say (0). */
  lastPlayedAt?: Date | null;
};

export type SteamSchemaLang = "english" | "brazilian";

export type SteamSchemaAchievement = {
  apiName: string;
  name: string;
  description?: string;
  iconUrl?: string;
  hidden: boolean;
};

export type SteamPlayerAchievement = { apiName: string; unlockedAt: Date | null };

export type SteamWishlistItem = {
  appId: number;
  /** The player's order (0 = top); null when not set. */
  priority: number | null;
  addedAt: Date | null;
};

/** One app of the store's app list (IStoreService/GetAppList, games only). */
export type SteamListedApp = { appId: number; name: string; lastModified: number | null };

export type SteamAppListPage = {
  apps: SteamListedApp[];
  /** More apps after `lastAppId`. */
  haveMore: boolean;
  /** Pass as `lastAppId` to read the next page. */
  lastAppId: number;
};

export type SteamAppListOptions = {
  /** Continue after this appid (pagination). */
  lastAppId?: number;
  /** Only apps changed since this Unix time (seconds). */
  ifModifiedSince?: number;
  /** Page size (Steam's default 10k, maximum 50k). */
  maxResults?: number;
};

export interface SteamApi {
  getPlayerSummary(steamId: string): Promise<SteamPlayerSummary>;
  /**
   * `'private'` when the profile is public but its game details are not; `'unsupported'` when
   * the adapter cannot list games (keyless community access): the sync then probes the catalog.
   */
  getOwnedGames(steamId: string): Promise<SteamOwnedGame[] | "private" | "unsupported">;
  /** `lang`: Steam's schema language (`brazilian` brings the PT-BR names); default `english`. */
  getSchemaForGame(appId: number, lang?: SteamSchemaLang): Promise<SteamSchemaAchievement[]>;
  getGlobalAchievementPercentages(appId: number): Promise<Record<string, number>>;
  /** `'private'` when the player's game details are not public. */
  getPlayerAchievements(
    steamId: string,
    appId: number,
  ): Promise<SteamPlayerAchievement[] | "private">;
  /** The player's wishlist (IWishlistService/GetWishlist); `'private'` when it is not public. */
  getWishlist(steamId: string): Promise<SteamWishlistItem[] | "private">;
  /** One page of the store's game list; `'unsupported'` without an API key. */
  getAppList(options?: SteamAppListOptions): Promise<SteamAppListPage | "unsupported">;
}
