import hollowKnight from "./__fixtures__/hollow-knight.json";
import { normalizeTitle } from "../title-match";
import type { IgdbApi, IgdbGame } from "./types";

/**
 * Offline IGDB adapter: only Hollow Knight (Steam appId 367520) is known. It has no media:
 * offline, the seeded fixture media (generated art) stays in place.
 */
export function createIgdbFixture(): IgdbApi {
  const game = (): IgdbGame => ({
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
  });
  return {
    async findBySteamAppId(appId) {
      return appId === hollowKnight.steamAppId ? game() : null;
    },
    async findByName(name) {
      return normalizeTitle(name) === normalizeTitle(hollowKnight.name) ? game() : null;
    },
    async getMedia() {
      return { videos: [], screenshots: [], artworks: [] };
    },
  };
}
