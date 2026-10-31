import hollowKnight from "./__fixtures__/hollow-knight.json";
import type { SgdbApi } from "./types";

/** Offline SteamGridDB adapter: only Hollow Knight (Steam appId 367520) has art. */
export function createSgdbFixture(): SgdbApi {
  return {
    async getArt(appId) {
      if (appId !== hollowKnight.steamAppId) return {};
      return {
        coverUrl: hollowKnight.coverUrl,
        heroUrl: hollowKnight.heroUrl,
        logoUrl: hollowKnight.logoUrl,
      };
    },
  };
}
