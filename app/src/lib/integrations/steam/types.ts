export type SteamPlayerSummary = {
  steamId: string;
  personaName: string;
  avatarUrl: string;
  profilePublic: boolean;
};

export type SteamOwnedGame = { appId: number; playtimeMin: number };

export type SteamSchemaAchievement = {
  apiName: string;
  name: string;
  description?: string;
  iconUrl?: string;
  hidden: boolean;
};

export type SteamPlayerAchievement = { apiName: string; unlockedAt: Date | null };

export interface SteamApi {
  getPlayerSummary(steamId: string): Promise<SteamPlayerSummary>;
  /** `'private'` when the profile is public but its game details are not. */
  getOwnedGames(steamId: string): Promise<SteamOwnedGame[] | "private">;
  getSchemaForGame(appId: number): Promise<SteamSchemaAchievement[]>;
  getGlobalAchievementPercentages(appId: number): Promise<Record<string, number>>;
  /** `'private'` when the player's game details are not public. */
  getPlayerAchievements(
    steamId: string,
    appId: number,
  ): Promise<SteamPlayerAchievement[] | "private">;
}
