import hollowKnight from "./__fixtures__/hollow-knight.json";
import type { RawgApi } from "./types";

/** Offline RAWG adapter: only Hollow Knight (Steam appId 367520) is known. */
export function createRawgFixture(): RawgApi {
  return {
    async findBySteamAppId(appId) {
      if (appId !== hollowKnight.steamAppId) return null;
      return {
        rawgId: hollowKnight.rawgId,
        metacritic: hollowKnight.metacritic,
        playtimeHours: hollowKnight.playtimeHours,
      };
    },
  };
}
