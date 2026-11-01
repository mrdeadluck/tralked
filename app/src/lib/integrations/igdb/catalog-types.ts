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

/**
 * How precise an IGDB release date is. Read from the deprecated `category` enum when present
 * (0 day, 1 month, 2 year, 3–6 quarter, 7 TBD), else from `date_format`, a reference to the
 * `/date_formats` table, by its `format` string ("YYYYMMMMDD", "YYYYMMMM", "YYYY", "YYYYQ1"…,
 * "TBD"). Anything unknown is "tbd": never shown as an exact day.
 */
export type IgdbDatePrecision = "day" | "month" | "year" | "q1" | "q2" | "q3" | "q4" | "tbd";

/** One release of a game on one platform and region (`release_dates`). */
export type IgdbReleaseDate = {
  id: number;
  platform: number;
  /** Unix seconds; absent for releases without a date ("TBD"). */
  date?: number;
  precision: IgdbDatePrecision;
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
  /** "desc" walks back from `to` (recent releases first), "asc" forward from `from`. */
  order: "asc" | "desc";
  /** Only games people follow or rated (IGDB hypes or total rating count above 0). */
  popularOnly: boolean;
  offset: number;
  limit: number;
};

/** A catalog page: the games, and what the raw page held (some rows may be unusable). */
export type IgdbCatalogPage = {
  games: IgdbCatalogGame[];
  /** Rows IGDB returned, usable or not: a full page means there may be more. */
  rawCount: number;
  /** Highest id IGDB returned (the next page starts after it); 0 when empty. */
  lastId: number;
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
  /** Releases on the platforms inside the window, in `order` of date. */
  getReleaseDates(query: IgdbReleaseQuery): Promise<IgdbReleaseDate[]>;
  /** Main games (and remakes, remasters, ports, standalone expansions) on the platforms, by id. */
  listGames(query: IgdbCatalogQuery): Promise<IgdbCatalogPage>;
  /** Details of up to 500 games at once (no time to beat). Unknown ids are left out. */
  getGames(ids: number[]): Promise<IgdbGame[]>;
  /** Platform ids by exact name (e.g. "Nintendo Switch 2"), for platforms newer than our table. */
  findPlatformIds(names: string[]): Promise<number[]>;
}
