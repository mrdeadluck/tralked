import hollowKnight from "./__fixtures__/hollow-knight.json";
import type { IgdbApi } from "./types";

/** Offline IGDB adapter: only Hollow Knight (Steam appId 367520) is known. */
export function createIgdbFixture(): IgdbApi {
  return {
    async findBySteamAppId(appId) {
      if (appId !== hollowKnight.steamAppId) return null;
      return {
        igdbId: hollowKnight.igdbId,
        name: hollowKnight.name,
        summary: hollowKnight.summary,
        releaseDate: new Date(hollowKnight.firstReleaseDate * 1000),
        genres: [...hollowKnight.genres],
        themes: [...hollowKnight.themes],
        gameModes: [...hollowKnight.gameModes],
        perspectives: [...hollowKnight.perspectives],
        keywords: [...hollowKnight.keywords],
        aggregatedRating: hollowKnight.aggregatedRating,
        coverImageId: hollowKnight.coverImageId,
        timeToBeatCompleteSec: hollowKnight.timeToBeatCompleteSec,
      };
    },
  };
}
