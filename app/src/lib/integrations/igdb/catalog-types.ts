import type { IgdbGame } from "./types";

/**
 * IGDB reads of the releases job and the console catalog import (Plano 4, F10). Kept apart from
 * `IgdbApi` (per-game metadata) so its fakes stay small; the real client implements both.
 */

/** A game as the catalog import and the release dates list it (no details). */
export type IgdbCatalogGame = {
  igdbId: number;
  name: string;
  /** IGDB platform ids. */
  platforms: number[];
  /** First release (Unix seconds), when known. */
  firstReleaseDate?: number;
  /** Steam appids IGDB links to the game. */
  steamAppIds: number[];
  coverImageId?: string;
  /** IGDB hypes + total rating count: how much people care (higher first). */
  popularity: number;
};

/** One release of a game on one platform and region (`release_dates`). */
export type IgdbReleaseDate = {
  id: number;
  platform: number;
  /** Unix seconds; absent for releases without a date ("TBD"). */
  date?: number;
  /** 0 = exact day; 1 = month; 2 = year; 3–6 = quarter; 7 = TBD (IGDB `date_format`). */
  dateFormat: number;
  /** IGDB's own text ("Q4 2026", "2027", "Nov 14, 2026"). */
  human?: string;
  game: IgdbCatalogGame;
};

export type IgdbReleaseQuery = {
  platforms: number[];
  /** Unix seconds, inclusive. */
  from: number;
  /** Unix seconds, exclusive. */
  to: number;
  offset: number;
  limit: number;
};

export type IgdbCatalogQuery = {
  platforms: number[];
  /** Games with an id above this one (pages go by id). */
  afterId: number;
  /** Only games changed since (Unix seconds): passes after the first. */
  updatedSince?: number;
  limit: number;
};

export interface IgdbCatalogApi {
  /** Releases on the platforms inside the window, oldest first. */
  getReleaseDates(query: IgdbReleaseQuery): Promise<IgdbReleaseDate[]>;
  /** Main games (and remakes, remasters, ports, standalone expansions) on the platforms, by id. */
  listGames(query: IgdbCatalogQuery): Promise<IgdbCatalogGame[]>;
  /** Details of up to 500 games at once (no time to beat). Unknown ids are left out. */
  getGames(ids: number[]): Promise<IgdbGame[]>;
  /** Platform ids by exact name (e.g. "Nintendo Switch 2"), for platforms newer than our table. */
  findPlatformIds(names: string[]): Promise<number[]>;
}
