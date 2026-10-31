export type RawgGame = {
  rawgId: number;
  metacritic?: number;
  playtimeHours?: number;
};

export interface RawgApi {
  /** Matches by exact (case-insensitive) name among Steam-store results; null if none. */
  findBySteamAppId(appId: number, name: string): Promise<RawgGame | null>;
}
